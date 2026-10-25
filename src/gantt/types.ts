// ============================================================================
// Gantt chart types
//
// The tasks of a Gantt chart with their times resolved (as Mermaid's parser
// resolves them), and the chart positioned for drawing.
// ============================================================================

export interface GanttTask {
  id: string
  label: string
  /** Index into the chart's sections */
  section: number
  /** Start and end, in ms since the epoch */
  start: number
  end: number
  done?: boolean
  active?: boolean
  crit?: boolean
  milestone?: boolean
}

export interface GanttChart {
  title: string
  /** Section names in order; a chart with no sections has one unnamed section */
  sections: string[]
  /** Tasks in the order they are written, each on its own row unless the chart is compact */
  tasks: GanttTask[]
  /** Vertical markers across the chart (`vert`) */
  markers: Array<{ label: string; at: number }>
  /** d3 strftime format for the axis labels */
  axisFormat: string
  /** `1week`, `15minute` and the like: where the axis ticks fall */
  tickInterval?: string
  /** The day weeks start on, for weekly ticks */
  weekday: string
  /** Tasks share a row while they do not overlap (`displayMode: compact`) */
  compact?: boolean
  /** An axis above the tasks as well as below (`topAxis`) */
  topAxis?: boolean
  /** Days left out of the schedule (`excludes weekends`), shaded across the chart */
  excluded?: Array<{ start: number; end: number }>
  /** The moment the today marker marks, and its author's style */
  today?: { at: number; style?: Record<string, string> }
}

export interface PositionedGanttBar {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  /** Where the label is anchored, and whether it sits inside the bar */
  labelX: number
  labelAnchor: 'start' | 'middle' | 'end'
  inside: boolean
  done?: boolean
  active?: boolean
  crit?: boolean
  milestone?: boolean
}

export interface PositionedGantt {
  width: number
  height: number
  title?: { text: string; x: number; y: number }
  /** A section's rows, shaded alternately, and its name beside them */
  sections: Array<{ label: string; x: number; y: number; width: number; height: number; labelX: number; labelY: number; shaded: boolean }>
  /** The axis line and its ticks, below the tasks (and above them, for a top axis) */
  axes: Array<{ y: number; x1: number; x2: number; labelY: number }>
  ticks: Array<{ x: number; label: string }>
  /** Grid lines from the first row to the last */
  gridTop: number
  gridBottom: number
  excluded: Array<{ x: number; width: number }>
  bars: PositionedGanttBar[]
  markers: Array<{ x: number; label: string; labelY: number }>
  today?: { x: number; style?: Record<string, string> }
}
