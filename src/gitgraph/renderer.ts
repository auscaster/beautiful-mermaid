import type { PositionedGitCommit, PositionedGitGraph } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { categorical, categoricalInk } from '../palette.ts'
import { GIT, GIT_FONT } from './layout.ts'

// ============================================================================
// Git graph SVG renderer
//
// Each branch in its own colour of the fixed categorical order: a faint lane,
// its name at the lane's start, and the connections that run along it. A
// commit is a disc of its branch's colour, ringed in the page's colour where
// lines meet it; a merge is a ring, a reverse is crossed out, a highlight is
// a square and a cherry-pick carries its cherries. A commit's id keeps a halo
// of the page's colour, so it reads where a line passes under it. Hovering a
// commit shows its id, branch and message.
// ============================================================================

/** Render a positioned git graph as an SVG string. */
export function renderGitGraphSvg(
  graph: PositionedGitGraph,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  embedFonts: boolean = true
): string {
  const parts: string[] = []
  parts.push(svgOpenTag(graph.width, graph.height, colors, transparent))
  parts.push(buildStyleBlock(font, false, embedFonts))

  if (graph.title) {
    parts.push(renderMultilineText(graph.title.text, graph.title.x, graph.title.y, GIT_FONT.title.size, `font-size="${GIT_FONT.title.size}" font-weight="${GIT_FONT.title.weight}" text-anchor="middle" fill="var(--_text)"`))
  }
  for (const lane of graph.lanes) {
    parts.push(`<line class="git-lane" x1="${lane.x1}" y1="${lane.y1}" x2="${lane.x2}" y2="${lane.y2}" stroke="${categorical(lane.color)}" stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="2 4" stroke-linecap="round" />`)
  }
  for (const label of graph.branchLabels) {
    parts.push(
      `<g class="git-branch" data-branch="${escapeXml(label.name)}">` +
      `\n  <rect x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" rx="4" ry="4" fill="${categorical(label.color)}" />` +
      `\n  ${renderMultilineText(label.name, label.x + label.width / 2, label.y + label.height / 2, GIT_FONT.branch.size, `font-size="${GIT_FONT.branch.size}" font-weight="${GIT_FONT.branch.weight}" text-anchor="middle" fill="${categoricalInk(label.color)}"`)}` +
      `\n</g>`
    )
  }
  for (const arrow of graph.arrows) {
    parts.push(`<path class="git-connection" d="${arrow.d}" fill="none" stroke="${categorical(arrow.color)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`)
  }
  for (const commit of graph.commits) parts.push(renderCommit(commit))
  for (const tag of graph.tags) {
    const mid = tag.y + tag.height / 2
    parts.push(
      `<g class="git-tag">` +
      `\n  <polygon points="${tag.x - GIT.tagPoint},${mid} ${tag.x},${tag.y} ${tag.x + tag.width},${tag.y} ${tag.x + tag.width},${tag.y + tag.height} ${tag.x},${tag.y + tag.height}" fill="var(--_node-fill)" stroke="var(--_node-stroke)" stroke-width="1" stroke-linejoin="round" />` +
      `\n  <circle cx="${tag.x - GIT.tagPoint / 2 + 1}" cy="${mid}" r="1.5" fill="var(--_node-stroke)" />` +
      `\n  ${renderMultilineText(tag.text, tag.x + GIT.tagPadX, mid, GIT_FONT.tag.size, `font-size="${GIT_FONT.tag.size}" font-weight="${GIT_FONT.tag.weight}" fill="var(--_text)"`)}` +
      `\n</g>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

/** A commit's mark by its kind, its tooltip, and its id beside it. */
function renderCommit(commit: PositionedGitCommit): string {
  const { x, y } = commit
  const r = GIT.radius
  const fill = categorical(commit.color)
  // The page's colour around a mark parts it from the lines that meet it.
  const ring = `stroke="var(--bg)" stroke-width="2"`
  const marks: string[] = []
  if (commit.kind === 'highlight') {
    marks.push(`<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" rx="2" ry="2" fill="${fill}" ${ring} />`)
    marks.push(`<rect x="${x - r / 2}" y="${y - r / 2}" width="${r}" height="${r}" rx="1" ry="1" fill="var(--bg)" />`)
  } else {
    marks.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${ring} />`)
    if (commit.kind === 'merge') marks.push(`<circle cx="${x}" cy="${y}" r="${r * 0.45}" fill="var(--bg)" />`)
    if (commit.kind === 'reverse') {
      const c = r * 0.45
      marks.push(`<path d="M ${x - c} ${y - c} L ${x + c} ${y + c} M ${x - c} ${y + c} L ${x + c} ${y - c}" stroke="var(--bg)" stroke-width="1.75" stroke-linecap="round" />`)
    }
    if (commit.kind === 'cherry-pick') {
      marks.push(`<path d="M ${x - 2} ${y + 1.5} L ${x} ${y - 3.5} L ${x + 2} ${y + 1.5}" fill="none" stroke="var(--bg)" stroke-width="1" stroke-linecap="round" />`)
      marks.push(`<circle cx="${x - 2.25}" cy="${y + 2}" r="1.75" fill="var(--bg)" />`, `<circle cx="${x + 2.25}" cy="${y + 2}" r="1.75" fill="var(--bg)" />`)
    }
  }
  const tooltip = [`${commit.id} on ${commit.branch}`, commit.message].filter(Boolean).join(': ')
  const label = commit.label
    ? `\n  <text x="${commit.label.x}" y="${commit.label.y}"${commit.label.slant ? ` transform="rotate(-45 ${commit.label.x} ${commit.label.y})"` : ''} font-size="${GIT_FONT.commit.size}" font-weight="${GIT_FONT.commit.weight}" text-anchor="${commit.label.anchor}" dominant-baseline="${commit.label.slant ? 'hanging' : 'central'}" fill="var(--_text-muted)" stroke="var(--bg)" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(commit.id)}</text>`
    : ''
  return `<g class="git-commit git-commit-${commit.kind}" data-id="${escapeXml(commit.id)}">\n  <title>${escapeXml(tooltip)}</title>\n  ${marks.join('\n  ')}${label}\n</g>`
}
