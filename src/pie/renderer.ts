import type { PositionedPie, PositionedPieSlice } from './types.ts'
import type { DiagramColors } from '../theme.ts'
import { svgOpenTag, buildStyleBlock } from '../theme.ts'
import { renderMultilineText, escapeXml } from '../multiline-utils.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { categorical, categoricalInk } from '../palette.ts'
import { PIE, PIE_FONT } from './layout.ts'

// ============================================================================
// Pie chart SVG renderer
//
// Slices in the fixed categorical order, parted by a 2px gap in the page's
// colour; percentages inside the slices they fit; a legend naming each.
// Hovering a slice or its legend row shows its label, value and share.
// ============================================================================

/** Render a positioned pie chart as an SVG string. */
export function renderPieSvg(
  chart: PositionedPie,
  colors: DiagramColors,
  font: string = 'Inter',
  transparent: boolean = false,
  embedFonts: boolean = true
): string {
  const parts: string[] = []
  parts.push(svgOpenTag(chart.width, chart.height, colors, transparent))
  parts.push(buildStyleBlock(font, false, embedFonts))

  if (chart.title) {
    parts.push(renderMultilineText(chart.title.text, chart.title.x, chart.title.y, PIE_FONT.title.size, `font-size="${PIE_FONT.title.size}" font-weight="${PIE_FONT.title.weight}" text-anchor="middle" fill="var(--_text)"`))
  }
  for (const slice of chart.slices) parts.push(renderSlice(chart, slice))
  for (const row of chart.legend) {
    const slice = chart.slices[row.color]!
    const labelWidth = measureMultilineText(row.label, PIE_FONT.legend.size, PIE_FONT.legend.weight).width
    const textX = row.x + PIE.swatch + PIE.swatchGap
    parts.push(
      `<g class="legend-item">` +
      `\n  <title>${escapeXml(tooltip(slice))}</title>` +
      `\n  <rect x="${row.x}" y="${row.y - PIE.swatch / 2}" width="${PIE.swatch}" height="${PIE.swatch}" rx="2" ry="2" fill="${categorical(row.color)}" />` +
      `\n  ${renderMultilineText(row.label, textX, row.y, PIE_FONT.legend.size, `font-size="${PIE_FONT.legend.size}" font-weight="${PIE_FONT.legend.weight}" fill="var(--_text)"`)}` +
      `\n  ${renderMultilineText(row.detail, textX + labelWidth + PIE.detailGap, row.y, PIE_FONT.detail.size, `font-size="${PIE_FONT.detail.size}" font-weight="${PIE_FONT.detail.weight}" fill="var(--_text-muted)"`)}` +
      `\n</g>`
    )
  }

  parts.push('</svg>')
  return parts.join('\n')
}

function tooltip(slice: PositionedPieSlice): string {
  return `${slice.label}: ${slice.value} (${slice.percent}%)`
}

/** A slice as a wedge (or the whole disc), with its percentage where it fits. */
function renderSlice(chart: PositionedPie, slice: PositionedPieSlice): string {
  const { cx, cy, radius: r } = chart
  const point = (angle: number) => `${cx + r * Math.sin(angle)} ${cy - r * Math.cos(angle)}`
  const span = slice.end - slice.start
  const fill = categorical(slice.color)
  // The page's colour between slices keeps neighbours apart.
  const gap = `stroke="var(--bg)" stroke-width="2" stroke-linejoin="round"`
  const shape = span >= Math.PI * 2 - 1e-9
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" />`
    : span > 0
      ? `<path d="M ${cx} ${cy} L ${point(slice.start)} A ${r} ${r} 0 ${span > Math.PI ? 1 : 0} 1 ${point(slice.end)} Z" fill="${fill}" ${gap} />`
      : ''
  const label = slice.labelX !== undefined && slice.labelY !== undefined
    ? `\n  ${renderMultilineText(`${slice.percent}%`, slice.labelX, slice.labelY, PIE_FONT.slice.size, `font-size="${PIE_FONT.slice.size}" font-weight="${PIE_FONT.slice.weight}" text-anchor="middle" fill="${categoricalInk(slice.color)}"`)}`
    : ''
  return `<g class="slice" data-label="${escapeXml(slice.label)}">\n  <title>${escapeXml(tooltip(slice))}</title>\n  ${shape}${label}\n</g>`
}
