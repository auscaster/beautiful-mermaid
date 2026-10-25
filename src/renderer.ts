import type { PositionedGraph, PositionedNode, PositionedEdge, PositionedGroup, Point } from './types.ts'
import type { DiagramColors } from './theme.ts'
import { svgOpenTag, buildStyleBlock } from './theme.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, ARROW_HEAD, estimateTextWidth, TEXT_BASELINE_SHIFT } from './styles.ts'
import { measureMultilineText } from './text-metrics.ts'
import { renderMultilineText, renderMultilineTextWithBackground, escapeXml } from './multiline-utils.ts'
import { DESCRIPTION_GAP, groupHeaderHeight } from './node-size.ts'

// ============================================================================
// SVG renderer — converts a PositionedGraph into an SVG string.
//
// Pure string concatenation, no DOM manipulation.
// Renders back-to-front: groups → edges → arrow heads → edge labels → nodes → node labels.
//
// All colors are referenced via CSS custom properties (var(--_xxx)) defined
// in the <style> block. The caller provides bg/fg (+ optional enrichment
// colors) via DiagramColors, which are set as inline CSS variables on the
// <svg> tag. See src/theme.ts for the full variable system.
//
// Style spec:
// - All corners rx=0 ry=0 (sharp)
// - Stroke widths: outer box 1px, inner box 0.75px, connectors 0.75px
// - Arrow heads: filled triangles, 8px wide × 4.8px tall
// - Dashed edges: stroke-dasharray="4 4"
// - Font: Inter with weight per element type
// ============================================================================

/**
 * Render a positioned graph as an SVG string.
 *
 * @param colors - DiagramColors with bg/fg and optional enrichment variables.
 *                 These are set as CSS custom properties on the <svg> tag.
 *                 All element colors reference derived --_xxx variables.
 * @param transparent - If true, renders with transparent background.
 */
export function renderSvg(
  graph: PositionedGraph,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  embedFonts: boolean = true
): string {
  const parts: string[] = []

  // SVG root with CSS variables + style block + defs
  parts.push(svgOpenTag(graph.width, graph.height, colors, transparent))
  parts.push(buildStyleBlock(font, false, embedFonts))
  parts.push('<defs>')
  parts.push(arrowMarkerDefs())
  const usesEndKinds = graph.edges.some(edge => edge.arrowStartKind || edge.arrowEndKind)
  if (usesEndKinds) parts.push(endKindMarkerDefs('var(--_arrow)', ''))
  // Per-color arrow markers for edges with custom stroke via linkStyle
  const customStrokeColors = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.inlineStyle?.stroke) {
      customStrokeColors.add(edge.inlineStyle.stroke)
    }
  }
  for (const color of customStrokeColors) {
    parts.push(arrowMarkerDefsForColor(color))
    if (usesEndKinds) parts.push(endKindMarkerDefs(escapeAttr(color), `-${markerSuffix(color)}`))
  }
  parts.push('</defs>')

  // 1. Subgraph backgrounds (group rectangles with header bands)
  for (const group of graph.groups) {
    parts.push(renderGroup(group, font))
  }

  // 2. Edges (polylines — rendered behind nodes)
  // Each edge is a <polyline> with semantic data-* attributes
  for (const edge of graph.edges) {
    parts.push(renderEdge(edge))
  }

  // 3. Edge labels (positioned at midpoint of edge)
  // Each label is wrapped in <g class="edge-label">
  for (const edge of graph.edges) {
    if (edge.label) {
      parts.push(renderEdgeLabel(edge, font))
    }
  }

  // 4. Nodes (shape + label wrapped in <g class="node">)
  for (const node of graph.nodes) {
    parts.push(renderNode(node, font))
  }

  parts.push('</svg>')

  return parts.join('\n')
}

// ============================================================================
// Arrow marker definitions
// ============================================================================

/**
 * Reusable arrow head markers — both forward (end) and reverse (start) variants.
 * The reverse marker uses orient="auto-start-reverse" to flip automatically.
 * Arrow color uses var(--_arrow) CSS variable.
 */
function arrowMarkerDefs(): string {
  const w = ARROW_HEAD.width
  const h = ARROW_HEAD.height
  // Arrow polygons have both fill and a thin stroke for better definition at small sizes
  const arrowStyle = 'fill="var(--_arrow)" stroke="var(--_arrow)" stroke-width="0.75" stroke-linejoin="round"'
  // Pull arrowhead back slightly (refX = w - 1) to prevent clipping at node boundaries
  const refX = w - 1
  return (
    // Forward arrow (marker-end) — orient="auto" ensures arrow points along line direction
    `  <marker id="arrowhead" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />` +
    `\n  </marker>` +
    // Reverse arrow (marker-start) — refX=1 so it sits at the line start with slight offset, auto-start-reverse flips it
    `\n  <marker id="arrowhead-start" markerWidth="${w}" markerHeight="${h}" refX="1" refY="${h / 2}" orient="auto-start-reverse">` +
    `\n    <polygon points="${w} 0, 0 ${h / 2}, ${w} ${h}" ${arrowStyle} />` +
    `\n  </marker>`
  )
}

/**
 * Generate arrow markers tinted to a specific color (for linkStyle stroke overrides).
 * IDs are suffixed with a sanitized color string to avoid collisions.
 */
function arrowMarkerDefsForColor(color: string): string {
  const w = ARROW_HEAD.width
  const h = ARROW_HEAD.height
  const escaped = escapeAttr(color)
  const arrowStyle = `fill="${escaped}" stroke="${escaped}" stroke-width="0.75" stroke-linejoin="round"`
  const refX = w - 1
  const suffix = markerSuffix(color)
  return (
    `  <marker id="arrowhead-${suffix}" markerWidth="${w}" markerHeight="${h}" refX="${refX}" refY="${h / 2}" orient="auto">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" ${arrowStyle} />` +
    `\n  </marker>` +
    `\n  <marker id="arrowhead-start-${suffix}" markerWidth="${w}" markerHeight="${h}" refX="1" refY="${h / 2}" orient="auto-start-reverse">` +
    `\n    <polygon points="${w} 0, 0 ${h / 2}, ${w} ${h}" ${arrowStyle} />` +
    `\n  </marker>`
  )
}

/**
 * Circle (`--o`) and cross (`--x`) end markers, drawn as Mermaid draws them at
 * the end of the line: a hollow ring and an x the line's own width.
 */
function endKindMarkerDefs(color: string, suffix: string): string {
  const size = 10
  const half = size / 2
  return (
    `  <marker id="circle-end${suffix}" markerWidth="${size}" markerHeight="${size}" refX="${size - 1}" refY="${half}" orient="auto" markerUnits="userSpaceOnUse">` +
    `\n    <circle cx="${half}" cy="${half}" r="${half - 1.5}" fill="var(--bg)" stroke="${color}" stroke-width="1.25" />` +
    `\n  </marker>` +
    `\n  <marker id="circle-start${suffix}" markerWidth="${size}" markerHeight="${size}" refX="1" refY="${half}" orient="auto" markerUnits="userSpaceOnUse">` +
    `\n    <circle cx="${half}" cy="${half}" r="${half - 1.5}" fill="var(--bg)" stroke="${color}" stroke-width="1.25" />` +
    `\n  </marker>` +
    `\n  <marker id="cross-end${suffix}" markerWidth="${size}" markerHeight="${size}" refX="${half}" refY="${half}" orient="auto" markerUnits="userSpaceOnUse">` +
    `\n    <path d="M 2 2 L ${size - 2} ${size - 2} M ${size - 2} 2 L 2 ${size - 2}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" />` +
    `\n  </marker>` +
    `\n  <marker id="cross-start${suffix}" markerWidth="${size}" markerHeight="${size}" refX="${half}" refY="${half}" orient="auto" markerUnits="userSpaceOnUse">` +
    `\n    <path d="M 2 2 L ${size - 2} ${size - 2} M ${size - 2} 2 L 2 ${size - 2}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" />` +
    `\n  </marker>`
  )
}

/** Sanitize a color value into a collision-free SVG ID suffix.
 *  Non-alphanumeric chars are hex-encoded so distinct inputs never collapse
 *  (e.g. "var(--line-1)" → "var28--line2d129", "var(--line1)" → "var28--line129"). */
function markerSuffix(color: string): string {
  return color.replace(/[^a-zA-Z0-9]/g, (ch) => ch.charCodeAt(0).toString(16))
}

// ============================================================================
// Group rendering (subgraph backgrounds)
// ============================================================================

export function renderGroup(group: PositionedGroup, font: string): string {
  // A box that only keeps its contents together draws only them.
  if (group.variant === 'hidden') return group.children.map(child => renderGroup(child, font)).join('\n')
  if (group.variant === 'region') {
    return [
      `<g class="subgraph region" data-id="${escapeAttr(group.id)}">`,
      `  <rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="0" ry="0" fill="none" stroke="var(--_node-stroke)" stroke-width="${STROKE_WIDTHS.innerBox}" stroke-dasharray="4 4" />`,
      ...group.children.map(child => renderGroup(child, font)),
      '</g>',
    ].join('\n')
  }
  const headerHeight = groupHeaderHeight(group.label)
  const parts: string[] = []

  // Opening <g> with semantic attributes for subgraph identification
  // data-id: original Mermaid subgraph ID
  // data-label: display label (may differ from ID)
  parts.push(
    `<g class="subgraph" data-id="${escapeAttr(group.id)}" data-label="${escapeAttr(group.label)}">`
  )

  // The author's subgraph styles (classDef or `style`) over the theme's
  const style = group.inlineStyle
  const fill = escapeAttr(style?.fill ?? 'var(--_group-fill)')
  const stroke = escapeAttr(style?.stroke ?? 'var(--_node-stroke)')
  const strokeWidth = escapeAttr(style?.['stroke-width'] ?? String(STROKE_WIDTHS.outerBox))
  const dash = style?.['stroke-dasharray'] ? ` stroke-dasharray="${escapeAttr(style['stroke-dasharray'])}"` : ''
  const radius = escapeAttr(style?.rx ?? '0')
  const headerFill = style?.fill ? `color-mix(in srgb, ${escapeAttr(style.fill)} 88%, var(--_text))` : 'var(--_group-hdr)'

  // Outer rectangle
  parts.push(
    `  <rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" ` +
    `rx="${radius}" ry="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} />`
  )

  // Header band and title, for a subgraph that has a title
  if (group.label.trim()) {
    parts.push(
      `  <rect x="${group.x}" y="${group.y}" width="${group.width}" height="${headerHeight}" ` +
      `rx="${radius}" ry="${radius}" fill="${headerFill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash} />`
    )
    parts.push(
      '  ' + renderMultilineText(
        group.label,
        group.x + 12,
        group.y + headerHeight / 2,
        FONT_SIZES.groupHeader,
        `font-size="${FONT_SIZES.groupHeader}" font-weight="${FONT_WEIGHTS.groupHeader}" fill="${escapeAttr(style?.color ?? 'var(--_text-sec)')}"`
      )
    )
  }

  // Render nested groups recursively (inside this group)
  for (const child of group.children) {
    parts.push(renderGroup(child, font))
  }

  parts.push('</g>')

  return parts.join('\n')
}

// ============================================================================
// Edge rendering
// ============================================================================

function renderEdge(edge: PositionedEdge): string {
  if (edge.points.length < 2) return ''

  const dashArray = edge.style === 'dotted' ? ' stroke-dasharray="4 4"' : ''
  const baseStrokeWidth = edge.style === 'thick' ? STROKE_WIDTHS.connector * 2 : STROKE_WIDTHS.connector
  const strokeColor = escapeAttr(edge.inlineStyle?.stroke ?? 'var(--_line)')
  const strokeWidth = escapeAttr(edge.inlineStyle?.['stroke-width'] ?? String(baseStrokeWidth))

  // Build marker attributes based on arrow direction flags
  // Use color-specific markers when edge has a custom stroke from linkStyle
  const suffix = edge.inlineStyle?.stroke ? `-${markerSuffix(edge.inlineStyle.stroke)}` : ''
  let markers = ''
  if (edge.hasArrowEnd) markers += ` marker-end="url(#${edge.arrowEndKind ? `${edge.arrowEndKind}-end` : 'arrowhead'}${suffix})"`
  if (edge.hasArrowStart) markers += ` marker-start="url(#${edge.arrowStartKind ? `${edge.arrowStartKind}-start` : 'arrowhead-start'}${suffix})"`

  // Semantic data attributes for edge identification and inspection:
  // - class="edge": CSS targeting and type identification
  // - data-from/data-to: source and target node IDs
  // - data-style: edge style (solid, dotted, thick)
  // - data-arrow-start/end: arrow presence flags
  // - data-label: edge label if present (for quick lookup without traversing DOM)
  const dataAttrs = [
    'class="edge"',
    `data-from="${escapeAttr(edge.source)}"`,
    `data-to="${escapeAttr(edge.target)}"`,
    `data-style="${edge.style}"`,
    `data-arrow-start="${edge.hasArrowStart}"`,
    `data-arrow-end="${edge.hasArrowEnd}"`,
  ]
  if (edge.label) {
    dataAttrs.push(`data-label="${escapeAttr(edge.label)}"`)
  }

  if (edge.curved) {
    return (
      `<path ${dataAttrs.join(' ')} d="${basisPath(edge.points)}" fill="none" stroke="${strokeColor}" ` +
      `stroke-width="${strokeWidth}" stroke-linecap="round"${dashArray}${markers} />`
    )
  }
  return (
    `<polyline ${dataAttrs.join(' ')} points="${pointsToPolylinePath(edge.points)}" fill="none" stroke="${strokeColor}" ` +
    `stroke-width="${strokeWidth}"${dashArray}${markers} />`
  )
}

/**
 * A path through the points as a uniform cubic B-spline that starts and ends
 * on the end points, as d3's curveBasis draws Mermaid's edges.
 */
export function basisPath(points: Point[]): string {
  const r = (value: number) => Math.round(value * 100) / 100
  if (points.length < 3) return `M ${points.map(p => `${r(p.x)} ${r(p.y)}`).join(' L ')}`
  const parts: string[] = []
  let x0 = points[0]!.x, y0 = points[0]!.y, x1 = x0, y1 = y0
  const bezier = (x: number, y: number) => {
    parts.push(`C ${r((2 * x0 + x1) / 3)} ${r((2 * y0 + y1) / 3)} ${r((x0 + 2 * x1) / 3)} ${r((y0 + 2 * y1) / 3)} ${r((x0 + 4 * x1 + x) / 6)} ${r((y0 + 4 * y1 + y) / 6)}`)
  }
  parts.push(`M ${r(x0)} ${r(y0)}`)
  for (let i = 1; i < points.length; i++) {
    const { x, y } = points[i]!
    if (i === 1) {
      parts.push(`L ${r((5 * x0 + x) / 6)} ${r((5 * y0 + y) / 6)}`)
    } else {
      bezier(x, y)
    }
    x0 = x1; x1 = x; y0 = y1; y1 = y
    if (i === 1) { x0 = points[0]!.x; y0 = points[0]!.y }
  }
  bezier(x1, y1)
  parts.push(`L ${r(x1)} ${r(y1)}`)
  return parts.join(' ')
}

/** Convert points to SVG polyline points attribute: "x1,y1 x2,y2 ..." */
function pointsToPolylinePath(points: Point[]): string {
  return points.map(p => `${p.x},${p.y}`).join(' ')
}

function renderEdgeLabel(edge: PositionedEdge, font: string): string {
  // Use layout-computed label position when available (layout-aware, avoids collisions).
  // Fall back to geometric midpoint of the edge polyline.
  const mid = edge.labelPosition ?? edgeMidpoint(edge.points)
  const label = edge.label!
  const padding = 8

  // Measure text (works for both single and multi-line)
  const metrics = measureMultilineText(label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)

  // Wrap in <g class="edge-label"> with reference to the edge it belongs to
  const content = renderMultilineTextWithBackground(
    label,
    mid.x,
    mid.y,
    metrics.width,
    metrics.height,
    FONT_SIZES.edgeLabel,
    padding,
    // Use --_text-sec for better contrast (was --_text-muted)
    `text-anchor="middle" font-size="${FONT_SIZES.edgeLabel}" font-weight="${FONT_WEIGHTS.edgeLabel}" fill="var(--_text-sec)"`,
    // Increased stroke width from 0.5 to 1 for better label separation from edges
    `rx="2" ry="2" fill="var(--bg)" stroke="var(--_inner-stroke)" stroke-width="1"`
  )

  // Semantic wrapper: links label to its edge via data-from/data-to
  return (
    `<g class="edge-label" data-from="${escapeAttr(edge.source)}" data-to="${escapeAttr(edge.target)}" data-label="${escapeAttr(label)}">\n` +
    `  ${content.replace(/\n/g, '\n  ')}\n` +
    `</g>`
  )
}

/** Get the midpoint of a polyline (by walking segments) */
function edgeMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]!

  // Calculate total length
  let totalLength = 0
  for (let i = 1; i < points.length; i++) {
    totalLength += dist(points[i - 1]!, points[i]!)
  }

  // Walk to the halfway point
  let remaining = totalLength / 2
  for (let i = 1; i < points.length; i++) {
    const segLen = dist(points[i - 1]!, points[i]!)
    if (remaining <= segLen) {
      const t = remaining / segLen
      return {
        x: points[i - 1]!.x + t * (points[i]!.x - points[i - 1]!.x),
        y: points[i - 1]!.y + t * (points[i]!.y - points[i - 1]!.y),
      }
    }
    remaining -= segLen
  }

  return points[points.length - 1]!
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

// ============================================================================
// Node rendering
// ============================================================================

/**
 * Render a complete node: shape + label wrapped in a semantic <g> element.
 *
 * The group includes data attributes for:
 * - data-id: original Mermaid node ID (for edge matching)
 * - data-label: display label text
 * - data-shape: shape type (rectangle, diamond, circle, etc.)
 */
function renderNode(node: PositionedNode, font: string): string {
  const shape = renderNodeShape(node)
  const label = renderNodeLabel(node, font)

  // Combine shape and label inside a semantic group
  // This enables reliable node identification without heuristics
  const parts: string[] = []
  parts.push(
    `<g class="node" data-id="${escapeAttr(node.id)}" data-label="${escapeAttr(node.label)}" data-shape="${node.shape}">`
  )
  parts.push(`  ${shape.replace(/\n/g, '\n  ')}`)
  if (label) {
    parts.push(`  ${label.replace(/\n/g, '\n  ')}`)
  }
  parts.push('</g>')

  return parts.join('\n')
}

function renderNodeShape(node: PositionedNode): string {
  const { x, y, width, height, shape, inlineStyle } = node

  // Resolve fill and stroke — inline styles (from mermaid `style` directives)
  // override the CSS variable defaults. When no inline style is present, the
  // CSS variable handles theming automatically via color-mix() derivation.
  const fill = escapeAttr(inlineStyle?.fill ?? 'var(--_node-fill)')
  const stroke = escapeAttr(inlineStyle?.stroke ?? 'var(--_node-stroke)')
  const dash = inlineStyle?.['stroke-dasharray'] ? `" stroke-dasharray="${escapeAttr(inlineStyle['stroke-dasharray'])}` : ''
  const sw = escapeAttr(inlineStyle?.['stroke-width'] ?? String(STROKE_WIDTHS.innerBox)) + dash

  // An author's corner radius (classDef rx/ry) on a box shape
  if ((shape === 'rectangle' || shape === 'rounded') && inlineStyle?.rx) {
    const rx = escapeAttr(inlineStyle.rx)
    const ry = escapeAttr(inlineStyle.ry ?? inlineStyle.rx)
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  }

  switch (shape) {
    case 'diamond':
      return renderDiamond(x, y, width, height, fill, stroke, sw)
    case 'rounded':
      return renderRoundedRect(x, y, width, height, fill, stroke, sw)
    case 'stadium':
      return renderStadium(x, y, width, height, fill, stroke, sw)
    case 'circle':
      return renderCircle(x, y, width, height, fill, stroke, sw)
    case 'subroutine':
      return renderSubroutine(x, y, width, height, fill, stroke, sw)
    case 'doublecircle':
      return renderDoubleCircle(x, y, width, height, fill, stroke, sw)
    case 'hexagon':
      return renderHexagon(x, y, width, height, fill, stroke, sw)
    case 'cylinder':
      return renderCylinder(x, y, width, height, fill, stroke, sw)
    case 'asymmetric':
      return renderAsymmetric(x, y, width, height, fill, stroke, sw)
    case 'trapezoid':
      return renderTrapezoid(x, y, width, height, fill, stroke, sw)
    case 'trapezoid-alt':
      return renderTrapezoidAlt(x, y, width, height, fill, stroke, sw)
    case 'state-start':
      return renderStateStart(x, y, width, height)
    case 'state-end':
      return renderStateEnd(x, y, width, height)
    case 'lean-right':
      return renderLean(x, y, width, height, fill, stroke, sw, true)
    case 'lean-left':
      return renderLean(x, y, width, height, fill, stroke, sw, false)
    case 'document':
      return renderDocument(x, y, width, height, fill, stroke, sw)
    case 'state-bar':
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="2" ry="2" fill="${inlineStyle?.fill ? fill : 'var(--_text)'}" stroke="none" />`
    case 'state-choice':
      return renderDiamond(x, y, width, height, fill, stroke, sw)
    case 'note':
      return renderNote(x, y, width, height, inlineStyle?.fill ? fill : NOTE_FILL, inlineStyle?.stroke ? stroke : NOTE_STROKE, sw)
    case 'rectangle':
    default:
      return renderRect(x, y, width, height, fill, stroke, sw)
  }
}

// --- Basic shapes ---

function renderRect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `rx="0" ry="0" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderRoundedRect(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `rx="6" ry="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderStadium(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const r = h / 2
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `rx="${r}" ry="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderCircle(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) / 2
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

function renderDiamond(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const hw = w / 2
  const hh = h / 2
  const points = [
    `${cx},${cy - hh}`,   // top
    `${cx + hw},${cy}`,   // right
    `${cx},${cy + hh}`,   // bottom
    `${cx - hw},${cy}`,   // left
  ].join(' ')

  return (
    `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

// --- Batch 1 shapes ---

/** Subroutine: rectangle with double vertical borders on left and right */
function renderSubroutine(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = 8 // distance from edge to inner vertical line
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
    `rx="0" ry="0" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<line x1="${x + inset}" y1="${y}" x2="${x + inset}" y2="${y + h}" ` +
    `stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<line x1="${x + w - inset}" y1="${y}" x2="${x + w - inset}" y2="${y + h}" ` +
    `stroke="${stroke}" stroke-width="${sw}" />`
  )
}

/** Double circle: two concentric circles with a gap between them */
function renderDoubleCircle(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const outerR = Math.min(w, h) / 2
  const innerR = outerR - 5 // 5px gap between rings
  return (
    `<circle cx="${cx}" cy="${cy}" r="${outerR}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<circle cx="${cx}" cy="${cy}" r="${innerR}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

/** Hexagon: 6-point polygon with flat top/bottom and angled sides */
function renderHexagon(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = h / 4 // horizontal inset for the angled sides
  const points = [
    `${x + inset},${y}`,           // top-left
    `${x + w - inset},${y}`,       // top-right
    `${x + w},${y + h / 2}`,       // mid-right
    `${x + w - inset},${y + h}`,   // bottom-right
    `${x + inset},${y + h}`,       // bottom-left
    `${x},${y + h / 2}`,           // mid-left
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

// --- Batch 2 shapes ---

/** Cylinder / database: top ellipse cap + body rect + bottom ellipse */
function renderCylinder(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const ry = 7 // ellipse vertical radius for the cap
  const cx = x + w / 2
  const bodyTop = y + ry
  const bodyH = h - 2 * ry

  return (
    // Body rectangle (no top border — covered by top ellipse)
    `<rect x="${x}" y="${bodyTop}" width="${w}" height="${bodyH}" ` +
    `fill="${fill}" stroke="none" />` +
    // Left and right body borders
    `\n<line x1="${x}" y1="${bodyTop}" x2="${x}" y2="${bodyTop + bodyH}" stroke="${stroke}" stroke-width="${sw}" />` +
    `\n<line x1="${x + w}" y1="${bodyTop}" x2="${x + w}" y2="${bodyTop + bodyH}" stroke="${stroke}" stroke-width="${sw}" />` +
    // Bottom ellipse (half visible)
    `\n<ellipse cx="${cx}" cy="${y + h - ry}" rx="${w / 2}" ry="${ry}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
    // Top ellipse (full, on top)
    `\n<ellipse cx="${cx}" cy="${bodyTop}" rx="${w / 2}" ry="${ry}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
  )
}

/** Asymmetric / flag: rectangle with a pointed left edge */
function renderAsymmetric(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const indent = 12 // how far the point indents
  const points = [
    `${x + indent},${y}`,       // top-left (indented)
    `${x + w},${y}`,            // top-right
    `${x + w},${y + h}`,        // bottom-right
    `${x + indent},${y + h}`,   // bottom-left (indented)
    `${x},${y + h / 2}`,        // left point
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

/** Trapezoid [/text\]: wider bottom, narrower top */
function renderTrapezoid(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = w * 0.15 // top edge is narrower by this amount on each side
  const points = [
    `${x + inset},${y}`,         // top-left (indented)
    `${x + w - inset},${y}`,     // top-right (indented)
    `${x + w},${y + h}`,         // bottom-right (full width)
    `${x},${y + h}`,             // bottom-left (full width)
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

/** Trapezoid-alt [\text/]: wider top, narrower bottom */
function renderTrapezoidAlt(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const inset = w * 0.15 // bottom edge is narrower
  const points = [
    `${x},${y}`,                     // top-left (full width)
    `${x + w},${y}`,                 // top-right (full width)
    `${x + w - inset},${y + h}`,     // bottom-right (indented)
    `${x + inset},${y + h}`,         // bottom-left (indented)
  ].join(' ')

  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

/** Parallelogram [/text/] or [\\text\\]: top and bottom offset against each other */
function renderLean(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string, right: boolean): string {
  const inset = w * 0.15
  const points = right
    ? [`${x + inset},${y}`, `${x + w},${y}`, `${x + w - inset},${y + h}`, `${x},${y + h}`]
    : [`${x},${y}`, `${x + w - inset},${y}`, `${x + w},${y + h}`, `${x + inset},${y + h}`]
  return `<polygon points="${points.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

/** A note's warm tint, mixed into the page's own background so it reads in light and dark themes. */
const NOTE_FILL = 'color-mix(in srgb, #f2c94c 18%, var(--bg))'
const NOTE_STROKE = 'color-mix(in srgb, #c9a227 55%, var(--bg))'

/** Note: a box with its top-right corner folded */
export function renderNote(x: number, y: number, w: number, h: number, fill: string = NOTE_FILL, stroke: string = NOTE_STROKE, sw: string = String(STROKE_WIDTHS.innerBox)): string {
  const fold = Math.min(10, h / 3)
  const outline = `${x},${y} ${x + w - fold},${y} ${x + w},${y + fold} ${x + w},${y + h} ${x},${y + h}`
  const corner = `${x + w - fold},${y} ${x + w - fold},${y + fold} ${x + w},${y + fold}`
  return (
    `<polygon points="${outline}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />` +
    `\n<polyline points="${corner}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`
  )
}

/** Document: a rectangle whose bottom edge is a single wave */
function renderDocument(x: number, y: number, w: number, h: number, fill: string, stroke: string, sw: string): string {
  const wave = Math.min(10, h * 0.2)
  const base = y + h - wave / 2
  const d = `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${base} ` +
    `C ${x + w * 0.75} ${base - wave} ${x + w * 0.5} ${base - wave} ${x + w * 0.5} ${base} ` +
    `C ${x + w * 0.5} ${base + wave} ${x + w * 0.25} ${base + wave} ${x} ${base} Z`
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
}

// --- Batch 3: State diagram pseudostates ---

/** State start: small filled circle using primary text color */
function renderStateStart(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const r = Math.min(w, h) / 2 - 2
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--_text)" stroke="none" />`
}

/** State end: bullseye — outer ring + inner filled circle using primary text color */
function renderStateEnd(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const outerR = Math.min(w, h) / 2 - 2
  const innerR = outerR - 4
  return (
    `<circle cx="${cx}" cy="${cy}" r="${outerR}" ` +
    `fill="none" stroke="var(--_text)" stroke-width="${STROKE_WIDTHS.innerBox * 2}" />` +
    `\n<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="var(--_text)" stroke="none" />`
  )
}

// ============================================================================
// Node label rendering
// ============================================================================

/** Shapes that are a mark, not a box: they show no label (a fork's bar, a choice's diamond). */
const UNLABELED: ReadonlySet<string> = new Set(['state-bar', 'state-choice'])

function renderNodeLabel(node: PositionedNode, font: string): string {
  // State pseudostates have no label
  if (node.shape === 'state-start' || node.shape === 'state-end') {
    if (!node.label) return ''
  }
  if (UNLABELED.has(node.shape)) return ''

  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2

  // Resolve text color — inline styles can override the CSS variable default
  const textColor = escapeAttr(node.inlineStyle?.color ?? 'var(--_text)')
  const fontSize = Number(node.inlineStyle?.['font-size']?.match(/^(\d+(?:\.\d+)?)(?:px)?$/)?.[1] ?? FONT_SIZES.nodeLabel)
  const attrs = (weight: number) => `text-anchor="middle" font-size="${fontSize}" font-weight="${weight}" fill="${textColor}"`

  if (!node.description) return renderMultilineText(node.label, cx, cy, fontSize, attrs(FONT_WEIGHTS.nodeLabel))

  // A label over a divider over the description, as a state with several descriptions is drawn.
  const title = measureMultilineText(node.label, fontSize, FONT_WEIGHTS.nodeLabel)
  const body = measureMultilineText(node.description, fontSize, FONT_WEIGHTS.nodeLabel - 100)
  const top = cy - (title.height + body.height + DESCRIPTION_GAP * 2) / 2
  const divider = top + title.height + DESCRIPTION_GAP
  const stroke = escapeAttr(node.inlineStyle?.stroke ?? 'var(--_node-stroke)')
  return [
    renderMultilineText(node.label, cx, top + title.height / 2, fontSize, attrs(FONT_WEIGHTS.nodeLabel + 100)),
    `<line x1="${node.x}" y1="${divider}" x2="${node.x + node.width}" y2="${divider}" stroke="${stroke}" stroke-width="${STROKE_WIDTHS.innerBox}" />`,
    renderMultilineText(node.description, cx, divider + DESCRIPTION_GAP + body.height / 2, fontSize, attrs(FONT_WEIGHTS.nodeLabel - 100)),
  ].join('\n')
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape a string for use as an XML/HTML attribute value.
 * Escapes quotes and ampersands to prevent attribute injection.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
