import type { PositionedSequenceDiagram, PositionedActor, Lifeline, PositionedMessage, Activation, PositionedBlock, PositionedNote } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { FONT_SIZES, FONT_WEIGHTS, STROKE_WIDTHS, ARROW_HEAD } from '../styles.ts'
import { renderMultilineText } from '../multiline-utils.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { renderNote as renderNoteShape } from '../renderer.ts'
import { inkOn } from '../ink.ts'
import { SEQ, SYMBOL_ACTORS, actorDepth, blockTab, dividerLabel, messageLabelY } from './layout.ts'

// ============================================================================
// Sequence diagram SVG renderer
//
// Renders a positioned sequence diagram to SVG string.
// All colors use CSS custom properties (var(--_xxx)) from the theme system.
//
// Render order (back to front):
//   1. Participant boxes
//   2. Block frames (rect colours, loop/alt/opt outlines), outermost first
//   3. Lifelines (dashed vertical lines)
//   4. Activation boxes
//   5. Block label tabs and dividers
//   6. Messages (arrows with labels)
//   7. Notes
//   8. Actor boxes, at the top and repeated at the bottom
// ============================================================================

/**
 * Render a positioned sequence diagram as an SVG string.
 *
 * @param colors - DiagramColors with bg/fg and optional enrichment variables.
 * @param transparent - If true, renders with transparent background.
 */
export function renderSequenceSvg(
  diagram: PositionedSequenceDiagram,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  embedFonts: boolean = true
): string {
  const parts: string[] = []

  // SVG root with CSS variables + style block + defs
  parts.push(svgOpenTag(diagram.width, diagram.height, colors, transparent))
  parts.push(buildStyleBlock(font, false, embedFonts))
  parts.push('<defs>')
  parts.push(arrowMarkerDefs())
  parts.push('</defs>')

  // A block holds the blocks inside it, so the larger is drawn first.
  const blocks = [...diagram.blocks].sort((a, b) => b.width * b.height - a.width * a.height)
  const behind = backdrop(diagram, blocks)
  for (const box of diagram.boxes ?? []) parts.push(renderBox(box))
  for (const block of blocks) parts.push(renderBlockFrame(block))
  for (const lifeline of diagram.lifelines) parts.push(renderLifeline(lifeline))
  for (const activation of diagram.activations) parts.push(renderActivation(activation))
  for (const block of blocks) if (block.type !== 'rect') parts.push(renderBlockLabels(block, behind))
  for (const message of diagram.messages) parts.push(renderMessage(message, behind))
  for (const note of diagram.notes) parts.push(renderNote(note))
  for (const actor of [...diagram.actors, ...(diagram.footerActors ?? [])]) parts.push(renderActor(actor, behind))

  parts.push('</svg>')
  return parts.join('\n')
}

// ============================================================================
// Arrow marker definitions
// ============================================================================

function arrowMarkerDefs(): string {
  const w = ARROW_HEAD.width
  const h = ARROW_HEAD.height
  const cross = 9
  return (
    `  <marker id="seq-arrow" markerWidth="${w}" markerHeight="${h}" refX="${w}" refY="${h / 2}" orient="auto-start-reverse">` +
    `\n    <polygon points="0 0, ${w} ${h / 2}, 0 ${h}" fill="var(--_arrow)" />` +
    `\n  </marker>` +
    // Open arrow head (just lines, no fill)
    `\n  <marker id="seq-arrow-open" markerWidth="${w}" markerHeight="${h}" refX="${w}" refY="${h / 2}" orient="auto-start-reverse">` +
    `\n    <polyline points="0 0, ${w} ${h / 2}, 0 ${h}" fill="none" stroke="var(--_arrow)" stroke-width="1" />` +
    `\n  </marker>` +
    // A lost message (`-x`): an x where the line ends
    `\n  <marker id="seq-cross" markerWidth="${cross}" markerHeight="${cross}" refX="${cross / 2}" refY="${cross / 2}" orient="auto" markerUnits="userSpaceOnUse">` +
    `\n    <path d="M 1.5 1.5 L ${cross - 1.5} ${cross - 1.5} M ${cross - 1.5} 1.5 L 1.5 ${cross - 1.5}" fill="none" stroke="var(--_arrow)" stroke-width="1.5" stroke-linecap="round" />` +
    `\n  </marker>`
  )
}

const MARKERS: Record<PositionedMessage['arrowHead'], string | undefined> = {
  filled: 'seq-arrow',
  open: 'seq-arrow-open',
  cross: 'seq-cross',
  none: undefined,
}

// ============================================================================
// Component renderers
// ============================================================================

/**
 * Render an actor: a participant's box (a cylinder for a database or queue, a
 * stack for collections), or an actor's, boundary's, control's or entity's
 * symbol with its label under it. Wrapped in <g class="actor"> with semantic data attributes.
 */
function renderActor(actor: PositionedActor, behind: Backdrop): string {
  const { id, x, y, width, height, label, type } = actor
  const parts: string[] = []
  const fill = 'var(--_node-fill)'
  const stroke = 'var(--_node-stroke)'
  const sw = STROKE_WIDTHS.outerBox
  const labelAttrs = (ink = 'var(--_text)') => `font-size="${FONT_SIZES.nodeLabel}" text-anchor="middle" font-weight="${FONT_WEIGHTS.nodeLabel}" fill="${ink}"`

  // Semantic wrapper with actor metadata
  parts.push(
    `<g class="actor" data-id="${escapeAttr(id)}" data-label="${escapeAttr(label)}" data-type="${type}">`
  )

  if (SYMBOL_ACTORS.has(type)) {
    parts.push(renderSymbol(type, x, y, height))
    // Label below the symbol, centred in the room the layout gave it (supports multi-line)
    const labelY = (y + height + SEQ.actorLabelGap + y + actorDepth(actor)) / 2
    // It sits on whatever is behind the actor, which may be a participant box in its author's colour.
    parts.push('  ' + renderMultilineText(label, x, labelY, FONT_SIZES.nodeLabel, labelAttrs(inkOn(behind(x, labelY)))))
  } else {
    const left = x - width / 2
    const right = x + width / 2
    const bottom = y + height
    let labelY = y + height / 2
    if (type === 'database') {
      // A cylinder: its top an ellipse, its label in the body below it
      const ry = Math.min(6, height / 6)
      parts.push(
        `  <path d="M ${left} ${y + ry} A ${width / 2} ${ry} 0 0 1 ${right} ${y + ry} L ${right} ${bottom - ry} A ${width / 2} ${ry} 0 0 1 ${left} ${bottom - ry} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
        `\n  <path d="M ${left} ${y + ry} A ${width / 2} ${ry} 0 0 0 ${right} ${y + ry}" fill="none" stroke="${stroke}" stroke-width="${sw}" />`
      )
      labelY = y + ry + (height - ry) / 2
    } else if (type === 'queue') {
      // A cylinder on its side: its far end an ellipse
      const rx = Math.min(8, width / 8)
      parts.push(
        `  <path d="M ${left + rx} ${y} L ${right - rx} ${y} A ${rx} ${height / 2} 0 0 1 ${right - rx} ${bottom} L ${left + rx} ${bottom} A ${rx} ${height / 2} 0 0 1 ${left + rx} ${y} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
        `\n  <path d="M ${right - rx} ${y} A ${rx} ${height / 2} 0 0 0 ${right - rx} ${bottom}" fill="none" stroke="${stroke}" stroke-width="${sw}" />`
      )
    } else if (type === 'collections') {
      // A stack: a second box behind, up and to the right
      const offset = 4
      parts.push(
        `  <rect x="${left + offset}" y="${y - offset}" width="${width - offset}" height="${height - offset}" rx="4" ry="4" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />` +
        `\n  <rect x="${left}" y="${y}" width="${width - offset}" height="${height}" rx="4" ry="4" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`
      )
    } else {
      // Participant: rectangle box with label (supports multi-line)
      parts.push(`  <rect x="${left}" y="${y}" width="${width}" height="${height}" rx="4" ry="4" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`)
    }
    parts.push('  ' + renderMultilineText(label, type === 'collections' ? x - 2 : x, labelY, FONT_SIZES.nodeLabel, labelAttrs()))
  }

  parts.push('</g>')
  return parts.join('\n')
}

/**
 * An actor's symbol, in a 24×24 space scaled to 90% of the actor height and
 * centred on its lifeline. Stroke width is inverse-scaled so the visual
 * thickness matches STROKE_WIDTHS.outerBox.
 */
function renderSymbol(type: PositionedActor['type'], x: number, y: number, height: number): string {
  const s = (height / 24) * 0.9
  const tx = x - 12 * s
  const ty = y + (height - 24 * s) / 2
  const sw = STROKE_WIDTHS.outerBox / s
  const line = `fill="none" stroke="var(--_line)" stroke-width="${sw}"`
  const body =
    type === 'boundary'
      // A line to a circle from a bar on its left
      ? `<path d="M 2 5 L 2 19 M 2 12 L 7 12" ${line} /><circle cx="14.5" cy="12" r="7.5" ${line} />`
      : type === 'control'
        // A circle with an arrowhead on its top
        ? `<circle cx="12" cy="13" r="8" ${line} /><path d="M 14 2 L 10.5 5 L 14 8" ${line} stroke-linejoin="round" />`
        : type === 'entity'
          // A circle on a line
          ? `<circle cx="12" cy="10" r="8" ${line} /><path d="M 4 21 L 20 21" ${line} />`
          // Circle-person icon: outer circle + head circle + shoulders arc
          : `<path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" ${line} />` +
            `<path d="M15 10C15 11.6569 13.6569 13 12 13C10.3431 13 9 11.6569 9 10C9 8.34315 10.3431 7 12 7C13.6569 7 15 8.34315 15 10Z" ${line} />` +
            `<path d="M5.62842 18.3563C7.08963 17.0398 9.39997 16 12 16C14.6 16 16.9104 17.0398 18.3716 18.3563" ${line} />`
  return `  <g transform="translate(${tx},${ty}) scale(${s})">${body}</g>`
}

/**
 * Render a lifeline (dashed vertical line from actor to bottom).
 * Includes data-actor to link to its actor.
 */
function renderLifeline(lifeline: Lifeline): string {
  return (
    `<line class="lifeline" data-actor="${escapeAttr(lifeline.actorId)}" ` +
    `x1="${lifeline.x}" y1="${lifeline.topY}" x2="${lifeline.x}" y2="${lifeline.bottomY}" ` +
    `stroke="var(--_node-stroke)" stroke-width="1" stroke-dasharray="6 4" />`
  )
}

/**
 * Render an activation box (narrow filled rectangle on lifeline).
 * Includes data-actor to link to its actor.
 */
function renderActivation(activation: Activation): string {
  return (
    `<rect class="activation" data-actor="${escapeAttr(activation.actorId)}" ` +
    `x="${activation.x}" y="${activation.topY}" width="${activation.width}" height="${activation.bottomY - activation.topY}" ` +
    `fill="var(--_node-fill)" stroke="var(--_node-stroke)" stroke-width="${STROKE_WIDTHS.innerBox}" />`
  )
}

/**
 * Render a message arrow with label.
 * Wrapped in <g class="message"> with semantic data attributes.
 */
function renderMessage(msg: PositionedMessage, behind: Backdrop): string {
  const parts: string[] = []
  const dashArray = msg.lineStyle === 'dashed' ? ' stroke-dasharray="6 4"' : ''
  const marker = MARKERS[msg.arrowHead]
  const markers = (marker ? ` marker-end="url(#${marker})"` : '') + (marker && msg.bidirectional ? ` marker-start="url(#${marker})"` : '')
  const labelX = msg.isSelf ? msg.x1 + SEQ.selfLoopWidth / 2 : (msg.x1 + msg.x2) / 2
  const labelY = messageLabelY(msg.y, msg.label)
  const backing = behind(labelX, labelY)
  const labelAttrs = `font-size="${FONT_SIZES.edgeLabel}" font-weight="${FONT_WEIGHTS.edgeLabel}" fill="${escapeAttr(inkOn(backing) ?? 'var(--_text-sec)')}" ${halo(backing)}`

  // Semantic wrapper with message metadata
  parts.push(
    `<g class="message" data-from="${escapeAttr(msg.from)}" data-to="${escapeAttr(msg.to)}" ` +
    `data-label="${escapeAttr(msg.label)}" data-line-style="${msg.lineStyle}" ` +
    `data-arrow-head="${msg.arrowHead}" data-self="${msg.isSelf}">`
  )

  if (msg.isSelf) {
    // Self-message: a loop out to the right and back, its label centred above it
    const loopW = SEQ.selfLoopWidth
    const loopH = SEQ.selfLoopHeight
    parts.push(
      `  <polyline points="${msg.x1},${msg.y} ${msg.x1 + loopW},${msg.y} ${msg.x1 + loopW},${msg.y + loopH} ${msg.x2},${msg.y + loopH}" ` +
      `fill="none" stroke="var(--_line)" stroke-width="${STROKE_WIDTHS.connector}"${dashArray}${markers} />`
    )
    if (msg.label) parts.push('  ' + renderMultilineText(msg.label, labelX, labelY, FONT_SIZES.edgeLabel, `text-anchor="middle" ${labelAttrs}`))
  } else {
    // Normal message: horizontal arrow, its label's last line just above it
    parts.push(
      `  <line x1="${msg.x1}" y1="${msg.y}" x2="${msg.x2}" y2="${msg.y}" ` +
      `stroke="var(--_line)" stroke-width="${STROKE_WIDTHS.connector}"${dashArray}${markers} />`
    )
    if (msg.label) parts.push('  ' + renderMultilineText(msg.label, labelX, labelY, FONT_SIZES.edgeLabel, `text-anchor="middle" ${labelAttrs}`))
  }

  // Autonumber: the message's number in a disc where it leaves its lifeline
  if (msg.number !== undefined) {
    parts.push(
      `  <circle cx="${msg.x1}" cy="${msg.y}" r="7" fill="var(--_line)" />` +
      `\n  <text x="${msg.x1}" y="${msg.y}" dy="${FONT_SIZES.edgeLabel * 0.3}" font-size="9" font-weight="600" text-anchor="middle" fill="var(--bg)">${msg.number}</text>`
    )
  }

  parts.push('</g>')
  return parts.join('\n')
}

/**
 * A block's frame: a rect block's background in its author's colour, or the
 * outline of a loop, alt, opt and the like.
 */
function renderBlockFrame(block: PositionedBlock): string {
  const labelAttr = block.label ? ` data-label="${escapeAttr(block.label)}"` : ''
  const paint = block.type === 'rect'
    ? `fill="${escapeAttr(block.fill ?? 'var(--_group-hdr)')}" stroke="none"`
    : `fill="none" stroke="var(--_node-stroke)" stroke-width="${STROKE_WIDTHS.outerBox}"`
  return (
    `<g class="block" data-type="${escapeAttr(block.type)}"${labelAttr}>` +
    `\n  <rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" ${paint} />` +
    `\n</g>`
  )
}

/**
 * A block's label tab and its else/and dividers, drawn over the lifelines
 * that pass through the block.
 */
function renderBlockLabels(block: PositionedBlock, behind: Backdrop): string {
  const parts: string[] = []
  const tab = blockTab(block.type, block.label)
  parts.push(`<g class="block-labels" data-type="${escapeAttr(block.type)}">`)

  // Type label tab (top-left corner), as tall and wide as its lines
  parts.push(
    `  <rect x="${block.x}" y="${block.y}" width="${tab.width}" height="${tab.height}" ` +
    `fill="var(--_group-hdr)" stroke="var(--_node-stroke)" stroke-width="${STROKE_WIDTHS.outerBox}" />`
  )
  parts.push(
    '  ' + renderMultilineText(tab.text, block.x + SEQ.blockTabPadX, block.y + tab.height / 2, FONT_SIZES.edgeLabel,
      `font-size="${FONT_SIZES.edgeLabel}" font-weight="${FONT_WEIGHTS.groupHeader}" fill="var(--_text-sec)"`)
  )

  // Divider lines (for alt/else, par/and), each label under its line
  for (const divider of block.dividers) {
    parts.push(
      `  <line x1="${block.x}" y1="${divider.y}" x2="${block.x + block.width}" y2="${divider.y}" ` +
      `stroke="var(--_line)" stroke-width="0.75" stroke-dasharray="6 4" />`
    )
    const label = dividerLabel(divider.label)
    if (label.text) {
      const x = block.x + SEQ.blockTabPadX
      const y = divider.y + SEQ.dividerGap + label.height / 2
      const backing = behind(x + label.width / 2, y)
      parts.push(
        '  ' + renderMultilineText(label.text, x, y, FONT_SIZES.edgeLabel,
          `font-size="${FONT_SIZES.edgeLabel}" text-anchor="start" font-weight="${FONT_WEIGHTS.edgeLabel}" fill="${escapeAttr(inkOn(backing) ?? 'var(--_text-muted)')}" ${halo(backing)}`)
      )
    }
  }

  parts.push('</g>')
  return parts.join('\n')
}

/**
 * Render a note box.
 * Wrapped in <g class="note"> with semantic data attributes.
 */
function renderNote(note: PositionedNote): string {
  const { x, y, width: w, height: h } = note

  // Build actor reference attribute if present
  const actorsAttr = note.actors && note.actors.length > 0
    ? ` data-actors="${note.actors.map(escapeAttr).join(',')}"`
    : ''
  const positionAttr = note.position ? ` data-position="${escapeAttr(note.position)}"` : ''

  return (
    `<g class="note"${positionAttr}${actorsAttr}>` +
    `\n${renderNoteShape(x, y, w, h)}` +
    `\n  ${renderMultilineText(note.text, x + w / 2, y + h / 2, FONT_SIZES.edgeLabel,
      `font-size="${FONT_SIZES.edgeLabel}" text-anchor="middle" font-weight="${FONT_WEIGHTS.edgeLabel}" fill="var(--_text)"`)}` +
    `\n</g>`
  )
}

/** A participant box's colour when its author gives it none. */
const BOX_FILL = 'color-mix(in srgb, var(--fg) 3%, var(--bg))'

/** A box grouping participants (`box Label ... end`), its label at its top. */
function renderBox(box: NonNullable<PositionedSequenceDiagram['boxes']>[number]): string {
  const fill = box.fill ? escapeAttr(box.fill) : BOX_FILL
  // The label sits midway between the box's top and its actors.
  const height = box.label ? measureMultilineText(box.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.groupHeader).height : 0
  const label = box.label
    ? '\n  ' + renderMultilineText(box.label, box.x + box.width / 2, box.y + (SEQ.boxPad + height + SEQ.boxLabelGap) / 2, FONT_SIZES.edgeLabel,
      `font-size="${FONT_SIZES.edgeLabel}" text-anchor="middle" font-weight="${FONT_WEIGHTS.groupHeader}" fill="${escapeAttr(inkOn(box.fill) ?? 'var(--_text-sec)')}"`)
    : ''
  return (
    `<g class="box"${box.label ? ` data-label="${escapeAttr(box.label)}"` : ''}>` +
    `\n  <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${fill}" stroke="var(--_inner-stroke)" stroke-width="${STROKE_WIDTHS.innerBox}" />` +
    label +
    `\n</g>`
  )
}

// ============================================================================
// Utilities
// ============================================================================

/** The colour behind a point: the innermost rect block or participant box over it, or the page. */
type Backdrop = (x: number, y: number) => string

function backdrop(diagram: PositionedSequenceDiagram, outermostFirst: PositionedBlock[]): Backdrop {
  const within = (item: { x: number; y: number; width: number; height: number }, x: number, y: number) =>
    x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height
  return (x, y) => {
    const rect = [...outermostFirst].reverse().find((block) => block.type === 'rect' && within(block, x, y))
    if (rect) return rect.fill ?? 'var(--_group-hdr)'
    const box = diagram.boxes?.find((item) => within(item, x, y))
    if (box) return box.fill ?? BOX_FILL
    return 'var(--bg)'
  }
}

/** A halo in the colour behind a label keeps the lifelines it crosses from striking through it. */
function halo(color: string): string {
  return `stroke="${escapeAttr(color)}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`
}

/**
 * Escape a string for use as an XML/HTML attribute value.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
