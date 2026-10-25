import type { PieChart, PositionedPie, PositionedPieSlice } from './types.ts'
import { measureMultilineText } from '../text-metrics.ts'

// ============================================================================
// Pie chart layout
//
// As Mermaid lays one out: slices largest first, clockwise from twelve
// o'clock, each labelled with its share where the label fits, and a legend
// beside the pie naming every slice.
// ============================================================================

export const PIE = {
  padding: 16,
  radius: 96,
  /** Between the title and the pie */
  titleGap: 16,
  /** Between the pie and its legend */
  legendGap: 32,
  swatch: 10,
  swatchGap: 8,
  /** Between a legend label and its share */
  detailGap: 8,
  legendRow: 22,
  /** How far out from the centre a slice's percentage sits, as Mermaid's textPosition */
  labelRadius: 0.7,
} as const

export const PIE_FONT = {
  title: { size: 14, weight: 600 },
  slice: { size: 11, weight: 600 },
  legend: { size: 12, weight: 500 },
  detail: { size: 12, weight: 400 },
} as const

const size = (text: string, font: { size: number; weight: number }) => measureMultilineText(text, font.size, font.weight)

/** Lay out a pie chart. Returns it fully positioned, ready for SVG rendering. */
export function layoutPie(chart: PieChart): PositionedPie {
  const total = chart.slices.reduce((sum, slice) => sum + slice.value, 0)
  // Mermaid draws the largest slice first; a sort that keeps ties in written order.
  const ordered = chart.slices.map((slice, i) => ({ ...slice, i })).sort((a, b) => b.value - a.value || a.i - b.i)
  const r = PIE.radius
  const titleHeight = chart.title ? size(chart.title, PIE_FONT.title).height : 0
  const top = PIE.padding + (chart.title ? titleHeight + PIE.titleGap : 0)
  const legendHeight = ordered.length * PIE.legendRow
  const bodyHeight = Math.max(r * 2, legendHeight)
  const cx = PIE.padding + r
  const cy = top + bodyHeight / 2

  let angle = 0
  const slices: PositionedPieSlice[] = ordered.map((slice, color) => {
    const share = total > 0 ? slice.value / total : 0
    const start = angle
    const end = angle + share * Math.PI * 2
    angle = end
    const percent = Number((share * 100).toFixed(0))
    // A percentage sits inside its slice when the arc there is long enough to hold it.
    const label = `${percent}%`
    const at = r * PIE.labelRadius
    const fits = percent > 0 && (end - start) * at >= size(label, PIE_FONT.slice).width + 6 && end - start >= 0.3
    const middle = (start + end) / 2
    return {
      label: slice.label,
      value: slice.value,
      percent,
      color,
      start,
      end,
      ...(fits ? { labelX: cx + at * Math.sin(middle), labelY: cy - at * Math.cos(middle) } : {}),
    }
  })

  const legendX = cx + r + PIE.legendGap
  const legendTop = cy - legendHeight / 2
  const legend = slices.map((slice, i) => ({
    label: slice.label,
    detail: chart.showData ? `${formatValue(slice.value)} · ${slice.percent}%` : `${slice.percent}%`,
    color: slice.color,
    x: legendX,
    y: legendTop + i * PIE.legendRow + PIE.legendRow / 2,
  }))
  const legendWidth = Math.max(0, ...legend.map((row) => PIE.swatch + PIE.swatchGap + size(row.label, PIE_FONT.legend).width + PIE.detailGap + size(row.detail, PIE_FONT.detail).width))
  const bodyWidth = r * 2 + (legend.length ? PIE.legendGap + legendWidth : 0)
  const titleWidth = chart.title ? size(chart.title, PIE_FONT.title).width : 0
  // A title wider than the pie and its legend centres them under it.
  const shift = Math.max(0, (titleWidth - bodyWidth) / 2)
  const width = Math.max(bodyWidth, titleWidth) + PIE.padding * 2
  return {
    width,
    height: top + bodyHeight + PIE.padding,
    ...(chart.title ? { title: { text: chart.title, x: width / 2, y: PIE.padding + titleHeight / 2 } } : {}),
    cx: cx + shift,
    cy,
    radius: r,
    slices: slices.map((slice) => slice.labelX === undefined ? slice : { ...slice, labelX: slice.labelX + shift }),
    legend: legend.map((row) => ({ ...row, x: row.x + shift })),
  }
}

/** A value as written: whole numbers bare, others to at most two places. */
function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}
