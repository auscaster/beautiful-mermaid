import type { GitGraph, PositionedGitCommit, PositionedGitGraph, PositionedGitTag } from './types.ts'
import { measureMultilineText } from '../text-metrics.ts'

// ============================================================================
// Git graph layout
//
// As Mermaid lays one out: a lane for each branch in order, commits a step
// apart along the time axis in the order made (or a step after their latest
// parent, with parallelCommits), a branch's first commit joined to its parent
// by a curve into its lane, and a merge joined from the merged branch's
// lane. A connection that would cross a commit between its ends runs along a
// lane of its own between the two. Positions are worked out along time (t)
// and across lanes (l), then turned to the graph's direction.
// ============================================================================

export const GIT = {
  padding: 16,
  /** Between commits along the time axis */
  step: 44,
  /** Between branches' lanes */
  lane: 44,
  radius: 7,
  /** A connection's corner */
  curve: 14,
  /** Between a lane's start and its branch's label */
  labelGap: 8,
  /** Around a branch label's name */
  labelPadX: 8,
  labelPadY: 4,
  /** Between a commit and its id */
  commitLabelGap: 8,
  /** Around a tag's text, and between stacked tags */
  tagPadX: 5,
  tagPadY: 3,
  tagGap: 4,
  /** A tag's point, toward its commit */
  tagPoint: 6,
  titleGap: 16,
} as const

export const GIT_FONT = {
  title: { size: 14, weight: 600 },
  branch: { size: 12, weight: 600 },
  commit: { size: 11, weight: 400 },
  tag: { size: 11, weight: 500 },
} as const

const size = (text: string, font: { size: number; weight: number }) => measureMultilineText(text, font.size, font.weight)
const SLANT = Math.SQRT1_2

interface Box { x0: number; y0: number; x1: number; y1: number }

/** Lay out a git graph. Returns it fully positioned, ready for SVG rendering. */
export function layoutGitGraph(graph: GitGraph): PositionedGitGraph {
  const laneOf = new Map(graph.branches.map((name, index) => [name, index]))
  const vertical = graph.direction !== 'LR'
  const labelSize = graph.branches.map((name) => {
    const text = size(name, GIT_FONT.branch)
    return { width: text.width + GIT.labelPadX * 2, height: text.height + GIT.labelPadY * 2 }
  })
  // Side by side, as in a vertical graph, lanes stand far enough apart for their names, as Mermaid's do.
  const lanePositions = graph.branches.reduce<number[]>((positions, _, index) => {
    const gap = vertical && graph.showBranches && index > 0 ? Math.max(GIT.lane, (labelSize[index - 1]!.width + labelSize[index]!.width) / 2 + GIT.labelGap) : GIT.lane
    return [...positions, index === 0 ? 0 : positions[index - 1]! + gap]
  }, [])
  const lane = (branch: string) => lanePositions[laneOf.get(branch) ?? 0] ?? 0
  const order = new Map(graph.commits.map((commit, index) => [commit.id, index]))

  // Along time: the order made, or a step after the latest parent.
  const time = new Map<string, number>()
  for (const [index, commit] of graph.commits.entries()) {
    const parents = commit.parents.map((parent) => time.get(parent)).filter((t): t is number => t !== undefined)
    time.set(commit.id, graph.parallelCommits ? (parents.length ? Math.max(...parents) + GIT.step : 0) : index * GIT.step)
  }
  const end = Math.max(0, ...time.values())
  // Time runs along x left to right, along y downwards, or along y upwards.
  const place = (t: number, l: number) => graph.direction === 'LR' ? { x: t, y: l } : { x: l, y: graph.direction === 'BT' ? -t : t }
  const at = (id: string) => { const commit = graph.commits[order.get(id)!]!; return { t: time.get(id)!, l: lane(commit.branch) } }

  const bounds: Box[] = []
  const add = (box: Box) => bounds.push(box)

  const lanes = graph.branches.map((name, index) => {
    const from = place(-GIT.step / 2, lanePositions[index]!)
    const to = place(end + GIT.step / 2, lanePositions[index]!)
    add({ x0: Math.min(from.x, to.x), y0: Math.min(from.y, to.y), x1: Math.max(from.x, to.x), y1: Math.max(from.y, to.y) })
    return { x1: from.x, y1: from.y, x2: to.x, y2: to.y, color: index }
  })

  const branchLabels = graph.showBranches ? graph.branches.map((name, index) => {
    const { width, height } = labelSize[index]!
    const start = place(-GIT.step / 2, lanePositions[index]!)
    // Before its lane: to its left, above it, or below it where time runs upwards.
    const box = graph.direction === 'LR'
      ? { x: start.x - GIT.labelGap - width, y: start.y - height / 2 }
      : { x: start.x - width / 2, y: graph.direction === 'TB' ? start.y - GIT.labelGap - height : start.y + GIT.labelGap }
    add({ x0: box.x, y0: box.y, x1: box.x + width, y1: box.y + height })
    return { name, ...box, width, height, color: index }
  }) : []

  // A connection that runs along a lane of its own keeps clear of the lanes and of each other.
  const taken = [...lanePositions]
  const findLane = (l1: number, l2: number, depth = 0): number => {
    const candidate = l1 + Math.abs(l1 - l2) / 2
    if (depth > 5 || taken.every((other) => Math.abs(other - candidate) >= 10)) { taken.push(candidate); return candidate }
    return findLane(l1, l2 - Math.abs(l1 - l2) / 5, depth + 1)
  }
  const arrows = graph.commits.flatMap((child) => child.parents.flatMap((parentId) => {
    const parent = graph.commits[order.get(parentId) ?? -1]
    if (!parent) return []
    const a = at(parent.id), b = at(child.id)
    const fromMerged = child.kind === 'merge' && parent.id !== child.parents[0]
    let color = laneOf.get(fromMerged ? parent.branch : child.branch) ?? 0
    let route: Array<{ t: number; l: number }>
    if (a.l === b.l) route = [a, b]
    else {
      // Mermaid reroutes where a commit made between the two stands on the lane the curve would run along.
      const curveLane = b.l > a.l ? child.branch : parent.branch
      const between = graph.commits.some((other, index) => index > order.get(parent.id)! && index < order.get(child.id)! && other.branch === curveLane)
      if (between) {
        const mid = findLane(Math.min(a.l, b.l), Math.max(a.l, b.l))
        route = [a, { t: a.t, l: mid }, { t: b.t, l: mid }, b]
        if (a.l > b.l) color = laneOf.get(parent.branch) ?? 0
      } else route = fromMerged ? [a, { t: b.t, l: a.l }, b] : [a, { t: a.t, l: b.l }, b]
    }
    return [{ points: route.map((point) => place(point.t, point.l)), color }]
  }))

  const tags: PositionedGitTag[] = []
  const commits: PositionedGitCommit[] = graph.commits.map((commit) => {
    const { x, y } = place(time.get(commit.id)!, lane(commit.branch))
    const color = laneOf.get(commit.branch) ?? 0
    add({ x0: x - GIT.radius, y0: y - GIT.radius, x1: x + GIT.radius, y1: y + GIT.radius })
    let label: PositionedGitCommit['label']
    if (graph.showCommitLabel && commit.labelled) {
      const text = size(commit.id, GIT_FONT.commit)
      if (vertical) {
        // Beside its commit, to the left of a vertical lane.
        label = { x: x - GIT.radius - GIT.commitLabelGap, y, anchor: 'end', slant: false }
        add({ x0: label.x - text.width, y0: y - text.height / 2, x1: label.x, y1: y + text.height / 2 })
      } else if (graph.rotateCommitLabel) {
        // Under its commit, slanting down to the left as Mermaid turns it.
        label = { x: x + GIT.radius / 2, y: y + GIT.radius + GIT.commitLabelGap, anchor: 'end', slant: true }
        add({ x0: label.x - text.width * SLANT - text.height, y0: label.y - text.height, x1: label.x + text.height, y1: label.y + text.width * SLANT + text.height })
      } else {
        label = { x, y: y + GIT.radius + GIT.commitLabelGap + text.height / 2, anchor: 'middle', slant: false }
        add({ x0: x - text.width / 2, y0: label.y - text.height / 2, x1: x + text.width / 2, y1: label.y + text.height / 2 })
      }
    }
    // Tags stack away from the commit, the last written nearest it: above it, or to the right of a vertical lane.
    const widest = Math.max(0, ...commit.tags.map((tag) => size(tag, GIT_FONT.tag).width))
    const tagHeight = GIT_FONT.tag.size + GIT.tagPadY * 2
    const tagWidth = widest + GIT.tagPadX * 2
    for (const [k, text] of [...commit.tags].reverse().entries()) {
      const box = vertical
        ? { x: x + GIT.radius + GIT.tagPoint + 4, y: y - tagHeight / 2 + k * (tagHeight + GIT.tagGap) }
        : { x: x - tagWidth / 2 + GIT.tagPoint / 2, y: y - GIT.radius - 6 - tagHeight - k * (tagHeight + GIT.tagGap) }
      tags.push({ text, ...box, width: tagWidth, height: tagHeight })
      add({ x0: box.x - GIT.tagPoint, y0: box.y, x1: box.x + tagWidth, y1: box.y + tagHeight })
    }
    return { ...commit, x, y, color, ...(label ? { label } : {}) }
  })

  const titleSize = graph.title ? size(graph.title, GIT_FONT.title) : undefined
  const x0 = Math.min(...bounds.map((box) => box.x0)), x1 = Math.max(...bounds.map((box) => box.x1))
  const y0 = Math.min(...bounds.map((box) => box.y0)), y1 = Math.max(...bounds.map((box) => box.y1))
  const top = GIT.padding + (titleSize ? titleSize.height + GIT.titleGap : 0)
  const width = Math.max(x1 - x0, titleSize?.width ?? 0) + GIT.padding * 2
  // The graph centres under a wider title.
  const dx = GIT.padding - x0 + Math.max(0, ((titleSize?.width ?? 0) - (x1 - x0)) / 2)
  const dy = top - y0
  const move = <T extends { x: number; y: number }>(item: T): T => ({ ...item, x: item.x + dx, y: item.y + dy })
  return {
    width,
    height: top + (y1 - y0) + GIT.padding,
    ...(titleSize ? { title: { text: graph.title, x: width / 2, y: GIT.padding + titleSize.height / 2 } } : {}),
    lanes: lanes.map((line) => ({ ...line, x1: line.x1 + dx, y1: line.y1 + dy, x2: line.x2 + dx, y2: line.y2 + dy })),
    branchLabels: branchLabels.map(move),
    arrows: arrows.map(({ points, color }) => ({ d: roundedPath(points.map(move)), color })),
    commits: commits.map((commit) => ({ ...move(commit), ...(commit.label ? { label: move(commit.label) } : {}) })),
    tags: tags.map(move),
  }
}

/** A path through the points, each corner rounded. */
function roundedPath(points: Array<{ x: number; y: number }>): string {
  const parts = [`M ${points[0]!.x} ${points[0]!.y}`]
  for (let i = 1; i < points.length - 1; i++) {
    const [p, c, n] = [points[i - 1]!, points[i]!, points[i + 1]!]
    const into = Math.hypot(c.x - p.x, c.y - p.y), out = Math.hypot(n.x - c.x, n.y - c.y)
    const r = Math.min(GIT.curve, into / 2, out / 2)
    if (r === 0) continue
    parts.push(`L ${c.x + (p.x - c.x) / into * r} ${c.y + (p.y - c.y) / into * r}`, `Q ${c.x} ${c.y} ${c.x + (n.x - c.x) / out * r} ${c.y + (n.y - c.y) / out * r}`)
  }
  const last = points[points.length - 1]!
  parts.push(`L ${last.x} ${last.y}`)
  return parts.join(' ')
}
