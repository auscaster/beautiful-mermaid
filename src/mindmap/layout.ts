import type { MindmapNode, MindmapShape, PositionedMindmap, PositionedMindmapEdge, PositionedMindmapNode } from './types.ts'
import { measureMultilineText, measureTextWidth } from '../text-metrics.ts'

// ============================================================================
// Mindmap layout
//
// The root in the middle and its branches either side of it, each a tidy
// tree growing outward: the first branches down the right, the rest back up
// the left, so they read clockwise in the order written, as Mermaid places
// them, and split so each side holds about as many leaves.
// ============================================================================

export const MINDMAP = {
  padding: 16,
  /** Mermaid wraps a node's label past this width */
  maxTextWidth: 200,
  /** Between a node and its children, from the root and further out */
  rootGap: 56,
  branchGap: 36,
  /** Between neighbouring subtrees */
  siblingGap: 10,
} as const

export const MINDMAP_FONT = {
  root: { size: 15, weight: 600 },
  node: { size: 13, weight: 500 },
} as const

/** A label's lines, wrapped as Mermaid wraps them past its width. */
export function wrapLabel(label: string, font: { size: number; weight: number }): string {
  return label.split('\n').map((line) => {
    const words = line.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (current && measureTextWidth(next, font.size, font.weight) > MINDMAP.maxTextWidth) {
        lines.push(current)
        current = word
      } else current = next
    }
    if (current) lines.push(current)
    return lines.join('\n')
  }).join('\n')
}

/** A node's box for its shape around its label. */
function boxSize(shape: MindmapShape, label: string, root: boolean): { width: number; height: number } {
  const text = measureMultilineText(label, root ? MINDMAP_FONT.root.size : MINDMAP_FONT.node.size, root ? MINDMAP_FONT.root.weight : MINDMAP_FONT.node.weight)
  switch (shape) {
    case 'default': return { width: text.width + 4, height: text.height + 8 }
    case 'circle': {
      const d = Math.max(text.width + 28, text.height + 28)
      return { width: d, height: d }
    }
    case 'hexagon': {
      const height = text.height + 16
      return { width: text.width + 28 + height / 2, height }
    }
    // A cloud's lobes and a bang's points sit outside the text's own room.
    case 'cloud': return { width: text.width + 44, height: text.height + 30 }
    case 'bang': return { width: text.width * 1.6 + 28, height: text.height * 1.6 + 28 }
    default: return { width: text.width + 28, height: text.height + 16 }
  }
}

interface Sized { node: MindmapNode; label: string; width: number; height: number; children: Sized[]; span: number; leaves: number }

function sized(node: MindmapNode, root: boolean): Sized {
  const label = wrapLabel(node.label, root ? MINDMAP_FONT.root : MINDMAP_FONT.node)
  const children = node.children.map((child) => sized(child, false))
  const { width, height } = boxSize(node.shape, label, root)
  // The height a subtree takes: its node's, or its children's stacked, whichever is more.
  const stacked = children.reduce((sum, child) => sum + child.span, 0) + MINDMAP.siblingGap * Math.max(0, children.length - 1)
  return { node, label, width, height, children, span: Math.max(height, stacked), leaves: children.length ? children.reduce((sum, child) => sum + child.leaves, 0) : 1 }
}

/**
 * The number of branches that go down the right: the split that best evens
 * the leaves either side, and of those the one that best evens the branches.
 */
function rightCount(branches: Sized[]): number {
  if (branches.length <= 1) return branches.length
  const total = branches.reduce((sum, branch) => sum + branch.leaves, 0)
  const half = branches.length / 2
  let best = 1
  let bestDiff = Infinity
  let running = 0
  for (let k = 1; k < branches.length; k++) {
    running += branches[k - 1]!.leaves
    const diff = Math.abs(total - 2 * running)
    if (diff < bestDiff || (diff === bestDiff && Math.abs(k - half) < Math.abs(best - half))) { best = k; bestDiff = diff }
  }
  return best
}

/** Lay out a mindmap. Returns it fully positioned, ready for SVG rendering. */
export function layoutMindmap(root: MindmapNode): PositionedMindmap {
  const tree = sized(root, true)
  const nodes: PositionedMindmapNode[] = []
  const edges: PositionedMindmapEdge[] = []
  nodes.push({ id: root.id, label: tree.label, shape: root.shape, x: -tree.width / 2, y: -tree.height / 2, width: tree.width, height: tree.height, depth: 0 })

  /** Where an edge meets a node: an underlined node at its underline, any other at its middle. */
  const anchorY = (item: PositionedMindmapNode) => item.shape === 'default' && item.depth > 0 ? item.y + item.height : item.y + item.height / 2

  /** Place a subtree whose near edge is at `edgeX`, centred in the band starting at `top`. */
  const place = (item: Sized, side: 1 | -1, edgeX: number, top: number, depth: number, branch: number, parent: PositionedMindmapNode) => {
    const x = side === 1 ? edgeX : edgeX - item.width
    const y = top + item.span / 2 - item.height / 2
    const positioned: PositionedMindmapNode = { id: item.node.id, label: item.label, shape: item.node.shape, x, y, width: item.width, height: item.height, depth, branch }
    nodes.push(positioned)
    const from: [number, number] = [side === 1 ? parent.x + parent.width : parent.x, depth === 1 ? parent.y + parent.height / 2 : anchorY(parent)]
    const to: [number, number] = [side === 1 ? x : x + item.width, anchorY(positioned)]
    const mid = (from[0] + to[0]) / 2
    edges.push({ from: parent.id, to: item.node.id, points: [from, [mid, from[1]], [mid, to[1]], to], depth, branch })
    const stacked = item.children.reduce((sum, child) => sum + child.span, 0) + MINDMAP.siblingGap * Math.max(0, item.children.length - 1)
    let childTop = top + (item.span - stacked) / 2
    const childEdge = side === 1 ? x + item.width + MINDMAP.branchGap : x - MINDMAP.branchGap
    for (const child of item.children) {
      place(child, side, childEdge, childTop, depth + 1, branch, positioned)
      childTop += child.span + MINDMAP.siblingGap
    }
  }

  const centre = nodes[0]!
  const split = rightCount(tree.children)
  const sides: Array<{ side: 1 | -1; branches: Array<{ item: Sized; branch: number }> }> = [
    { side: 1, branches: tree.children.slice(0, split).map((item, i) => ({ item, branch: i })) },
    // The left side reads on round the clock: from the bottom up.
    { side: -1, branches: tree.children.slice(split).map((item, i) => ({ item, branch: split + i })).reverse() },
  ]
  for (const { side, branches } of sides) {
    const total = branches.reduce((sum, { item }) => sum + item.span, 0) + MINDMAP.siblingGap * Math.max(0, branches.length - 1)
    let top = -total / 2
    const edgeX = side === 1 ? centre.x + centre.width + MINDMAP.rootGap : centre.x - MINDMAP.rootGap
    for (const { item, branch } of branches) {
      place(item, side, edgeX, top, 1, branch, centre)
      top += item.span + MINDMAP.siblingGap
    }
  }

  // The canvas: every node, the same padding on every side. Cloud lobes and bang points stay inside their boxes.
  const x0 = Math.min(...nodes.map((n) => n.x))
  const y0 = Math.min(...nodes.map((n) => n.y))
  const x1 = Math.max(...nodes.map((n) => n.x + n.width))
  const y1 = Math.max(...nodes.map((n) => n.y + n.height))
  const dx = MINDMAP.padding - x0
  const dy = MINDMAP.padding - y0
  return {
    width: x1 - x0 + MINDMAP.padding * 2,
    height: y1 - y0 + MINDMAP.padding * 2,
    nodes: nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
    edges: edges.map((edge) => ({ ...edge, points: edge.points.map(([px, py]) => [px + dx, py + dy] as [number, number]) })),
  }
}
