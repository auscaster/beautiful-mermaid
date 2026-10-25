import type { GanttChart, GanttTask, PositionedGantt, PositionedGanttBar } from './types.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { formatTime, timeTicks } from './time.ts'

// ============================================================================
// Gantt chart layout
//
// As Mermaid lays one out: a row per task (or tasks sharing rows while they do
// not overlap, in a compact chart), sections down the side, time across, each
// bar's label inside it where it fits and beside it where it does not.
// ============================================================================

export const GANTT = {
  padding: 16,
  /** The width the time axis spans */
  chartWidth: 640,
  barHeight: 20,
  rowGap: 6,
  /** Between the title and the chart */
  titleGap: 14,
  /** Between the section names and the time axis */
  sectionGap: 16,
  /** A label inside its bar keeps this far from the bar's ends */
  textPad: 6,
  /** A label beside its bar keeps this far from it */
  outsideGap: 6,
  /** How far past the axis's end a label beside its bar may reach before it goes before the bar */
  overhang: 40,
  /** Between the axis line and its labels */
  axisGap: 6,
  /** Half a milestone diamond's width */
  milestone: 11,
} as const

export const GANTT_FONT = {
  title: { size: 14, weight: 600 },
  section: { size: 12, weight: 500 },
  task: { size: 11, weight: 400 },
  axis: { size: 11, weight: 400 },
} as const

const size = (text: string, font: { size: number; weight: number }) => measureMultilineText(text, font.size, font.weight)

/**
 * Each task's row: its place in the chart, or in a compact chart the first
 * row of its section it fits on, as Mermaid packs them.
 */
function rows(chart: GanttChart): { rowOf: Map<GanttTask, number>; sectionRows: Array<[number, number]> } {
  const rowOf = new Map<GanttTask, number>()
  const sectionRows: Array<[number, number]> = []
  let next = 0
  chart.sections.forEach((_, section) => {
    const tasks = chart.tasks.filter((task) => task.section === section)
    const first = next
    if (chart.compact) {
      const ends: number[] = []
      for (const task of [...tasks].sort((a, b) => a.start - b.start)) {
        let row = ends.findIndex((end) => end <= task.start)
        if (row === -1) row = ends.push(task.end) - 1
        else ends[row] = task.end
        rowOf.set(task, first + row)
      }
      next += Math.max(ends.length, tasks.length ? 1 : 0)
    } else {
      for (const task of tasks) rowOf.set(task, next++)
    }
    sectionRows.push([first, next])
  })
  return { rowOf, sectionRows }
}

/** Lay out a Gantt chart. Returns it fully positioned, ready for SVG rendering. */
export function layoutGantt(chart: GanttChart): PositionedGantt {
  const { rowOf, sectionRows } = rows(chart)
  const rowHeight = GANTT.barHeight + GANTT.rowGap
  const named = chart.sections.some((name) => name)
  const labelColumn = named ? Math.max(...chart.sections.map((name) => size(name, GANTT_FONT.section).width)) + GANTT.sectionGap : 0
  const chartLeft = labelColumn
  const chartRight = chartLeft + GANTT.chartWidth

  // Time across: the span from the first start to the last end.
  const times = [...chart.tasks.flatMap((task) => [task.start, task.end]), ...chart.markers.map((marker) => marker.at)]
  const min = times.length ? Math.min(...times) : 0
  const max = times.length ? Math.max(...times) : 0
  const x = (at: number) => max > min ? chartLeft + ((at - min) / (max - min)) * GANTT.chartWidth : (chartLeft + chartRight) / 2

  // Down the page: title, top axis, marker labels, the rows, the bottom axis.
  const axisLabels = timeTicks(min, max, chart.tickInterval, chart.weekday).map((at) => ({ x: x(+at), label: formatTime(chart.axisFormat, at) }))
  const labelled = axisLabels.some((tick) => tick.label.trim())
  const axisLabelHeight = labelled ? size('0', GANTT_FONT.axis).height : 0
  let y = 0
  // The title is centred over the whole chart, as Mermaid centres it.
  const title = chart.title ? { text: chart.title, x: chartRight / 2, y: size(chart.title, GANTT_FONT.title).height / 2 } : undefined
  if (title) y += size(chart.title, GANTT_FONT.title).height + GANTT.titleGap
  const axes: PositionedGantt['axes'] = []
  if (chart.topAxis) {
    axes.push({ y: y + axisLabelHeight + GANTT.axisGap, x1: chartLeft, x2: chartRight, labelY: y + axisLabelHeight / 2 })
    y += axisLabelHeight + GANTT.axisGap
  }
  const markerLabelHeight = chart.markers.some((marker) => marker.label) ? size('0', GANTT_FONT.task).height + GANTT.axisGap : 0
  const markerLabelY = y + (markerLabelHeight - GANTT.axisGap) / 2
  y += markerLabelHeight
  const rowsTop = y
  const rowCount = sectionRows.length ? sectionRows[sectionRows.length - 1]![1] : 0
  const rowsBottom = rowsTop + rowCount * rowHeight
  axes.push({ y: rowsBottom, x1: chartLeft, x2: chartRight, labelY: rowsBottom + GANTT.axisGap + axisLabelHeight / 2 })

  const sections = chart.sections.map((label, i) => {
    const [first, last] = sectionRows[i]!
    const top = rowsTop + first * rowHeight
    const height = (last - first) * rowHeight
    return { label, x: 0, y: top, width: chartRight, height, labelX: 0, labelY: top + height / 2, shaded: i % 2 === 0 }
  }).filter((section) => section.height > 0)

  const bars: PositionedGanttBar[] = chart.tasks.map((task) => {
    const top = rowsTop + rowOf.get(task)! * rowHeight + GANTT.rowGap / 2
    let x1 = x(task.start)
    let x2 = x(task.end)
    if (task.milestone) {
      const middle = (x1 + x2) / 2
      x1 = middle - GANTT.milestone
      x2 = middle + GANTT.milestone
    }
    const text = size(task.label, GANTT_FONT.task).width
    const inside = !task.milestone && text + GANTT.textPad * 2 <= x2 - x1
    const right = x2 + GANTT.outsideGap + text <= chartRight + GANTT.overhang
    return {
      id: task.id,
      label: task.label,
      x: x1,
      y: top,
      width: x2 - x1,
      height: GANTT.barHeight,
      labelX: inside ? (x1 + x2) / 2 : right ? x2 + GANTT.outsideGap : x1 - GANTT.outsideGap,
      labelAnchor: inside ? 'middle' : right ? 'start' : 'end',
      inside,
      ...(task.done ? { done: true } : {}),
      ...(task.active ? { active: true } : {}),
      ...(task.crit ? { crit: true } : {}),
      ...(task.milestone ? { milestone: true } : {}),
    }
  })

  const positioned: PositionedGantt = {
    width: 0,
    height: 0,
    ...(title ? { title } : {}),
    sections,
    axes,
    ticks: axisLabels.filter((tick) => tick.x >= chartLeft - 0.5 && tick.x <= chartRight + 0.5),
    gridTop: rowsTop,
    gridBottom: rowsBottom,
    excluded: (chart.excluded ?? []).map((day) => ({ x: x(Math.max(day.start, min)), width: x(Math.min(day.end, max)) - x(Math.max(day.start, min)) })).filter((day) => day.width > 0),
    bars,
    markers: chart.markers.map((marker) => ({ x: x(marker.at), label: marker.label, labelY: markerLabelY })),
    ...(chart.today && chart.today.at >= min && chart.today.at <= max ? { today: { x: x(chart.today.at), ...(chart.today.style ? { style: chart.today.style } : {}) } } : {}),
  }
  return framed(positioned, labelled)
}

/** Shift everything drawn so the same padding falls on every side. */
function framed(chart: PositionedGantt, labelled: boolean): PositionedGantt {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const take = (left: number, top: number, right: number, bottom: number) => {
    x0 = Math.min(x0, left); y0 = Math.min(y0, top); x1 = Math.max(x1, right); y1 = Math.max(y1, bottom)
  }
  const text = (label: string, font: { size: number; weight: number }, cx: number, cy: number, anchor: 'start' | 'middle' | 'end') => {
    const { width, height } = size(label, font)
    const left = anchor === 'start' ? cx : anchor === 'end' ? cx - width : cx - width / 2
    take(left, cy - height / 2, left + width, cy + height / 2)
  }
  if (chart.title) text(chart.title.text, GANTT_FONT.title, chart.title.x, chart.title.y, 'middle')
  for (const section of chart.sections) {
    take(section.x, section.y, section.x + section.width, section.y + section.height)
    if (section.label) text(section.label, GANTT_FONT.section, section.labelX, section.labelY, 'start')
  }
  for (const axis of chart.axes) {
    take(axis.x1, axis.y, axis.x2, axis.y)
    if (labelled) for (const tick of chart.ticks) text(tick.label, GANTT_FONT.axis, tick.x, axis.labelY, 'middle')
  }
  for (const bar of chart.bars) {
    take(bar.x, bar.y, bar.x + bar.width, bar.y + bar.height)
    text(bar.label, GANTT_FONT.task, bar.labelX, bar.y + bar.height / 2, bar.labelAnchor)
  }
  for (const marker of chart.markers) if (marker.label) text(marker.label, GANTT_FONT.task, marker.x, marker.labelY, 'middle')
  const dx = GANTT.padding - x0
  const dy = GANTT.padding - y0
  return {
    ...chart,
    width: x1 - x0 + GANTT.padding * 2,
    height: y1 - y0 + GANTT.padding * 2,
    ...(chart.title ? { title: { ...chart.title, x: chart.title.x + dx, y: chart.title.y + dy } } : {}),
    sections: chart.sections.map((section) => ({ ...section, x: section.x + dx, y: section.y + dy, labelX: section.labelX + dx, labelY: section.labelY + dy })),
    axes: chart.axes.map((axis) => ({ y: axis.y + dy, x1: axis.x1 + dx, x2: axis.x2 + dx, labelY: axis.labelY + dy })),
    ticks: chart.ticks.map((tick) => ({ ...tick, x: tick.x + dx })),
    gridTop: chart.gridTop + dy,
    gridBottom: chart.gridBottom + dy,
    excluded: chart.excluded.map((day) => ({ ...day, x: day.x + dx })),
    bars: chart.bars.map((bar) => ({ ...bar, x: bar.x + dx, y: bar.y + dy, labelX: bar.labelX + dx })),
    markers: chart.markers.map((marker) => ({ ...marker, x: marker.x + dx, labelY: marker.labelY + dy })),
    ...(chart.today ? { today: { ...chart.today, x: chart.today.x + dx } } : {}),
  }
}
