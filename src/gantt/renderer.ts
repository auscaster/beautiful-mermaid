import type { PositionedGantt, PositionedGanttBar } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { CHART_ACCENT_FALLBACK } from '../xychart/colors.ts'
import { GANTT_FONT } from './layout.ts'

// ============================================================================
// Gantt chart SVG renderer
//
// Bars in the chart accent (as the XY chart's are), red for critical tasks,
// grey once done; sections shaded in turn; a hairline grid at the ticks.
// All colors use CSS custom properties from the theme system.
//
// Render order (back to front):
//   1. Section bands and excluded days
//   2. Grid lines and the axes
//   3. Bars and their labels
//   4. Markers, the today line, section names and the title
// ============================================================================

const ACCENT = `var(--accent, ${CHART_ACCENT_FALLBACK})`
/** Critical tasks, in every theme */
const CRIT = '#e5484d'
const mix = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, var(--bg))`

/** A bar's fill and stroke by its state: active stronger, done greyed, critical red. */
function barPaint(bar: PositionedGanttBar): { fill: string; stroke: string } {
  const hue = bar.crit ? CRIT : ACCENT
  if (bar.milestone) return { fill: bar.done ? mix('var(--fg)', 40) : hue, stroke: 'none' }
  if (bar.done) return { fill: mix('var(--fg)', 10), stroke: bar.crit ? mix(CRIT, 75) : mix('var(--fg)', 30) }
  if (bar.active) return { fill: mix(hue, 45), stroke: hue }
  return { fill: mix(hue, 22), stroke: mix(hue, 70) }
}

/** Render a positioned Gantt chart as an SVG string. */
export function renderGanttSvg(
  chart: PositionedGantt,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  embedFonts: boolean = true
): string {
  const parts: string[] = []
  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false, embedFonts))

  for (const section of chart.sections) {
    if (section.shaded) parts.push(`<rect class="section" x="${section.x}" y="${section.y}" width="${section.width}" height="${section.height}" fill="var(--_node-fill)" />`)
  }
  for (const day of chart.excluded) {
    parts.push(`<rect class="excluded" x="${day.x}" y="${chart.gridTop}" width="${day.width}" height="${chart.gridBottom - chart.gridTop}" fill="${mix('var(--fg)', 6)}" />`)
  }

  const axis = (size: number, weight: number) => `font-size="${size}" font-weight="${weight}"`
  parts.push('<g class="grid">')
  for (const tick of chart.ticks) {
    parts.push(`  <line x1="${tick.x}" y1="${chart.gridTop}" x2="${tick.x}" y2="${chart.gridBottom}" stroke="var(--_inner-stroke)" stroke-width="1" />`)
  }
  for (const line of chart.axes) {
    parts.push(`  <line x1="${line.x1}" y1="${line.y}" x2="${line.x2}" y2="${line.y}" stroke="var(--_node-stroke)" stroke-width="1" />`)
    for (const tick of chart.ticks) {
      if (tick.label.trim()) parts.push('  ' + renderMultilineText(tick.label, tick.x, line.labelY, GANTT_FONT.axis.size, `${axis(GANTT_FONT.axis.size, GANTT_FONT.axis.weight)} text-anchor="middle" fill="var(--_text-muted)"`))
    }
  }
  parts.push('</g>')

  for (const bar of chart.bars) parts.push(renderBar(bar))

  for (const marker of chart.markers) {
    parts.push(
      `<g class="marker">` +
      `\n  <line x1="${marker.x}" y1="${chart.gridTop}" x2="${marker.x}" y2="${chart.gridBottom}" stroke="var(--_text-sec)" stroke-width="1" stroke-dasharray="4 3" />` +
      (marker.label ? '\n  ' + renderMultilineText(marker.label, marker.x, marker.labelY, GANTT_FONT.task.size, `${axis(GANTT_FONT.task.size, GANTT_FONT.task.weight)} text-anchor="middle" fill="var(--_text-sec)"`) : '') +
      `\n</g>`
    )
  }
  if (chart.today) {
    const style = chart.today.style ?? {}
    parts.push(
      `<line class="today" x1="${chart.today.x}" y1="${chart.gridTop}" x2="${chart.today.x}" y2="${chart.gridBottom}" ` +
      `stroke="${escapeXml(style.stroke ?? CRIT)}" stroke-width="${escapeXml(style['stroke-width']?.replace(/px$/, '') ?? '2')}"${style.opacity ? ` opacity="${escapeXml(style.opacity)}"` : ''} />`
    )
  }

  for (const section of chart.sections) {
    if (section.label) parts.push(renderMultilineText(section.label, section.labelX, section.labelY, GANTT_FONT.section.size, `${axis(GANTT_FONT.section.size, GANTT_FONT.section.weight)} text-anchor="start" fill="var(--_text-sec)"`))
  }
  if (chart.title) {
    parts.push(renderMultilineText(chart.title.text, chart.title.x, chart.title.y, GANTT_FONT.title.size, `${axis(GANTT_FONT.title.size, GANTT_FONT.title.weight)} text-anchor="middle" fill="var(--_text)"`))
  }

  parts.push('</svg>')
  return parts.join('\n')
}

/** A task's bar (a diamond for a milestone) with its label inside it or beside it. */
function renderBar(bar: PositionedGanttBar): string {
  const { fill, stroke } = barPaint(bar)
  const cy = bar.y + bar.height / 2
  const shape = bar.milestone
    ? `<polygon points="${bar.x + bar.width / 2},${bar.y - 1} ${bar.x + bar.width},${cy} ${bar.x + bar.width / 2},${bar.y + bar.height + 1} ${bar.x},${cy}" fill="${fill}" />`
    : `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${bar.height}" rx="3" ry="3" fill="${fill}" stroke="${stroke}" stroke-width="1" />`
  const states = (['done', 'active', 'crit', 'milestone'] as const).filter((state) => bar[state]).join(' ')
  return (
    `<g class="task" data-id="${escapeXml(bar.id)}"${states ? ` data-state="${states}"` : ''}>` +
    `\n  ${shape}` +
    `\n  ${renderMultilineText(bar.label, bar.labelX, cy, GANTT_FONT.task.size, `font-size="${GANTT_FONT.task.size}" font-weight="${GANTT_FONT.task.weight}" text-anchor="${bar.labelAnchor}" fill="var(--_text)"`)}` +
    `\n</g>`
  )
}
