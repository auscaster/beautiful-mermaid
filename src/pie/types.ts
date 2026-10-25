// ============================================================================
// Pie chart types
// ============================================================================

export interface PieChart {
  title: string
  /** Slices in the order they are written */
  slices: Array<{ label: string; value: number }>
  /** Show each slice's value beside its label in the legend (`showData`) */
  showData?: boolean
}

export interface PositionedPieSlice {
  label: string
  value: number
  /** Its share, rounded to a whole percent as Mermaid shows it */
  percent: number
  /** Its place in the fixed colour order: the largest slice first */
  color: number
  /** Angles clockwise from twelve o'clock, in radians */
  start: number
  end: number
  /** Where its percentage sits inside it, when it fits */
  labelX?: number
  labelY?: number
}

export interface PositionedPie {
  width: number
  height: number
  title?: { text: string; x: number; y: number }
  cx: number
  cy: number
  radius: number
  slices: PositionedPieSlice[]
  /** The legend: a swatch, label and share per slice, largest first */
  legend: Array<{ label: string; detail: string; color: number; x: number; y: number }>
}
