// ============================================================================
// Pie charts as Mermaid's parser reads them: each slice's label and value in
// the order written, the title, and whether the legend shows the values.
// ============================================================================

import type { PieChart } from '../pie/types.ts'
import { mermaidLabel } from './labels.ts'

/** The pie database Mermaid's parser fills (`getDiagramFromText(text).db`). */
export interface MermaidPieDb {
  getSections(): Map<string, number>
  getShowData?(): boolean
  getDiagramTitle?(): string
}

/** A Mermaid pie database as the pie layout reads it. */
export function mermaidPie(db: MermaidPieDb): PieChart {
  return {
    title: mermaidLabel(db.getDiagramTitle?.()),
    slices: [...db.getSections()].map(([label, value]) => ({ label: mermaidLabel(label), value })),
    ...(db.getShowData?.() ? { showData: true } : {}),
  }
}
