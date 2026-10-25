import type { PositionedMindmap, PositionedMindmapNode } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { categorical } from '../palette.ts'
import { MINDMAP_FONT } from './layout.ts'

// ============================================================================
// Mindmap SVG renderer
//
// Each top-level branch in its own colour from the fixed categorical order,
// as Mermaid colours its sections: its curves tapering outward, its nodes
// tinted with it, an unshaped node standing on a line of it. The root is
// drawn in the text colour, so it reads as the centre in either theme.
// ============================================================================

const tint = (color: string) => `color-mix(in srgb, ${color} 14%, var(--bg))`
/** Curves thin out from the root: 3px, then 2px, then 1.5px. */
const edgeWidth = (depth: number) => (depth === 1 ? 3 : depth === 2 ? 2 : 1.5)

/** Render a positioned mindmap as an SVG string. */
export function renderMindmapSvg(
  map: PositionedMindmap,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  embedFonts: boolean = true
): string {
  const parts: string[] = []
  parts.push(svgOpenTag(map.width, map.height, colors, transparent))
  parts.push(buildStyleBlock(font, false, embedFonts))

  for (const edge of map.edges) {
    const [[x1, y1], [c1x, c1y], [c2x, c2y], [x2, y2]] = edge.points as [[number, number], [number, number], [number, number], [number, number]]
    parts.push(
      `<path class="mindmap-edge" data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}" d="M ${x1} ${y1} C ${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}" ` +
      `fill="none" stroke="${categorical(edge.branch)}" stroke-width="${edgeWidth(edge.depth)}" stroke-linecap="round" />`
    )
  }
  for (const node of map.nodes) parts.push(renderNode(node))

  parts.push('</svg>')
  return parts.join('\n')
}

function renderNode(node: PositionedMindmapNode): string {
  const root = node.depth === 0
  const color = node.branch === undefined ? 'var(--_text)' : categorical(node.branch)
  const fill = root ? 'var(--_text)' : tint(color)
  const paint = `fill="${fill}" stroke="${color}" stroke-width="1.25"`
  const { x, y, width: w, height: h } = node
  const cx = x + w / 2
  const cy = y + h / 2
  // The root's default shape is a rounded box, as Mermaid draws it.
  const shape = root && node.shape === 'default' ? 'rounded' : node.shape
  let body: string
  switch (shape) {
    case 'default':
      // An unshaped node stands on a line in its branch's colour, which its curves run into.
      body = `<line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y + h}" stroke="${color}" stroke-width="${node.depth === 1 ? 3 : node.depth === 2 ? 2 : 1.5}" stroke-linecap="round" />`
      break
    case 'circle':
      body = `<circle cx="${cx}" cy="${cy}" r="${w / 2}" ${paint} />`
      break
    case 'hexagon': {
      const inset = h / 4
      body = `<polygon points="${x + inset},${y} ${x + w - inset},${y} ${x + w},${cy} ${x + w - inset},${y + h} ${x + inset},${y + h} ${x},${cy}" ${paint} />`
      break
    }
    case 'cloud':
      body = `<path d="${cloudPath(x, y, w, h)}" ${paint} />`
      break
    case 'bang':
      body = `<polygon points="${bangPoints(cx, cy, w / 2, h / 2)}" ${paint} stroke-linejoin="round" />`
      break
    case 'rect':
      body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${paint} />`
      break
    default:
      body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(10, h / 2)}" ry="${Math.min(10, h / 2)}" ${paint} />`
  }
  const font = root ? MINDMAP_FONT.root : MINDMAP_FONT.node
  const textY = shape === 'default' ? y + (h - 3) / 2 : cy
  const text = renderMultilineText(node.label, cx, textY, font.size, `font-size="${font.size}" font-weight="${font.weight}" text-anchor="middle" fill="${root ? 'var(--bg)' : 'var(--_text)'}"`)
  return `<g class="mindmap-node" data-id="${escapeXml(node.id)}" data-shape="${node.shape}">\n  ${body}\n  ${text}\n</g>`
}

/** A cloud: lobes along each side of a box inset from its edges, bulging out to them. */
function cloudPath(x: number, y: number, w: number, h: number): string {
  const bulge = 7
  const left = x + bulge, top = y + bulge, right = x + w - bulge, bottom = y + h - bulge
  const across = Math.max(2, Math.round((right - left) / 28))
  const down = Math.max(1, Math.round((bottom - top) / 28))
  const step = (right - left) / across
  const drop = (bottom - top) / down
  let d = `M ${left} ${top}`
  for (let i = 1; i <= across; i++) d += ` A ${step / 2} ${bulge} 0 0 1 ${left + step * i} ${top}`
  for (let i = 1; i <= down; i++) d += ` A ${bulge} ${drop / 2} 0 0 1 ${right} ${top + drop * i}`
  for (let i = 1; i <= across; i++) d += ` A ${step / 2} ${bulge} 0 0 1 ${right - step * i} ${bottom}`
  for (let i = 1; i <= down; i++) d += ` A ${bulge} ${drop / 2} 0 0 1 ${left} ${bottom - drop * i}`
  return `${d} Z`
}

/** A bang: points around an ellipse, reaching its edge and falling back inside it. */
function bangPoints(cx: number, cy: number, rx: number, ry: number): string {
  const spikes = 14
  const points: string[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (Math.PI * i) / spikes - Math.PI / 2
    const reach = i % 2 === 0 ? 1 : 0.8
    points.push(`${cx + rx * reach * Math.cos(angle)},${cy + ry * reach * Math.sin(angle)}`)
  }
  return points.join(' ')
}
