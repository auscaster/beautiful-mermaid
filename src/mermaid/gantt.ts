// ============================================================================
// Gantt charts as Mermaid's parser reads them, in the Gantt layout's terms:
// each task's start and end as Mermaid resolves them (after other tasks,
// skipping excluded days), its state, and the chart's axis settings.
// ============================================================================

import type { GanttChart, GanttTask } from '../gantt/types.ts'
import { WEEKDAYS } from '../gantt/time.ts'
import { mermaidLabel } from './labels.ts'

interface MermaidGanttTask {
  id: string
  task: string
  section: string
  startTime: Date
  endTime: Date
  renderEndTime?: Date | null
  done?: boolean
  active?: boolean
  crit?: boolean
  milestone?: boolean
  vert?: boolean
}

/** The Gantt database Mermaid's parser fills (`getDiagramFromText(text).db`). */
export interface MermaidGanttDb {
  getTasks(): MermaidGanttTask[]
  getDiagramTitle?(): string
  getAxisFormat?(): string
  getTickInterval?(): string | undefined
  getTodayMarker?(): string
  getDateFormat?(): string
  getExcludes?(): string[]
  getIncludes?(): string[]
  getWeekday?(): string
  getDisplayMode?(): string
  topAxisEnabled?(): boolean
}

/** Mermaid's Gantt settings (`config.gantt`), from its configuration, frontmatter and directives. */
export interface MermaidGanttConfig {
  axisFormat?: string
  tickInterval?: string
  topAxis?: boolean
  displayMode?: string
  weekday?: string
}

/**
 * A Mermaid Gantt database as the Gantt layout reads it. `today` is the
 * moment the today marker marks: a drawing made ahead of time cannot know
 * when it is read, so without one no marker is drawn.
 */
export function mermaidGantt(db: MermaidGanttDb, config: MermaidGanttConfig = {}, today?: number): GanttChart {
  const all = db.getTasks()
  const sections: string[] = []
  const tasks: GanttTask[] = []
  const markers: GanttChart['markers'] = []
  for (const task of all) {
    const label = mermaidLabel(task.task)
    if (task.vert) {
      markers.push({ label, at: +task.startTime })
      continue
    }
    if (!sections.includes(task.section ?? '')) sections.push(task.section ?? '')
    tasks.push({
      id: task.id,
      label,
      section: sections.indexOf(task.section ?? ''),
      start: +task.startTime,
      // A bar ends where Mermaid draws it to, short of excluded days it runs into.
      end: +(task.renderEndTime ?? task.endTime),
      ...(task.done ? { done: true } : {}),
      ...(task.active ? { active: true } : {}),
      ...(task.crit ? { crit: true } : {}),
      ...(task.milestone ? { milestone: true } : {}),
    })
  }

  const marker = db.getTodayMarker?.() ?? ''
  const excluded = excludedDays(all, db.getExcludes?.() ?? [], db.getIncludes?.() ?? [], db.getDateFormat?.() ?? 'YYYY-MM-DD')
  return {
    title: mermaidLabel(db.getDiagramTitle?.()),
    sections: sections.map((name) => mermaidLabel(name)),
    tasks,
    markers,
    axisFormat: db.getAxisFormat?.() || config.axisFormat || '%Y-%m-%d',
    ...(db.getTickInterval?.() || config.tickInterval ? { tickInterval: db.getTickInterval?.() || config.tickInterval } : {}),
    weekday: db.getWeekday?.() || config.weekday || 'sunday',
    ...(db.getDisplayMode?.() === 'compact' || config.displayMode === 'compact' ? { compact: true } : {}),
    ...(db.topAxisEnabled?.() || config.topAxis ? { topAxis: true } : {}),
    ...(excluded.length ? { excluded } : {}),
    ...(today !== undefined && marker !== 'off' ? { today: { at: today, ...(marker ? { style: todayStyle(marker) } : {}) } } : {}),
  }
}

/** `stroke-width:5px,stroke:#0f0` as style properties. */
function todayStyle(marker: string): Record<string, string> {
  return Object.fromEntries(marker.split(/[,;]/).map((part) => part.split(':').map((side) => side.trim())).filter((pair): pair is [string, string] => pair.length === 2 && !!pair[0] && !!pair[1]))
}

/**
 * The runs of days the chart leaves out, each a day long from the first
 * task's time of day, as Mermaid shades them: weekends, named weekdays and
 * dates written in the chart's date format, unless an `includes` puts them back.
 */
function excludedDays(tasks: MermaidGanttTask[], excludes: string[], includes: string[], dateFormat: string): Array<{ start: number; end: number }> {
  if (!excludes.length || !tasks.length) return []
  const min = Math.min(...tasks.map((task) => +task.startTime))
  const max = Math.max(...tasks.map((task) => +task.endTime))
  // Mermaid shades nothing across more than five years.
  if (max - min > 5 * 365.25 * 24 * 3600 * 1000) return []
  const format = dateFormat.trim()
  const left = (day: Date) => {
    if (includes.includes(formatDay(format, day))) return false
    if (excludes.includes('weekends') && (day.getDay() === 6 || day.getDay() === 0)) return true
    return excludes.includes(WEEKDAYS[day.getDay()]!) || excludes.includes(formatDay(format, day))
  }
  const runs: Array<{ start: number; end: number }> = []
  let run: { start: number; end: number } | undefined
  for (const day = new Date(min); +day <= max; day.setDate(day.getDate() + 1)) {
    if (left(day)) {
      const end = new Date(+day)
      end.setDate(end.getDate() + 1)
      if (run) run.end = +end
      else runs.push(run = { start: +day, end: +end })
    } else run = undefined
  }
  return runs
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const two = (value: number) => String(value).padStart(2, '0')

/** A date in a dayjs format such as `YYYY-MM-DD`, as Mermaid compares excluded dates. */
function formatDay(format: string, d: Date): string {
  const tokens: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()), YY: () => two(d.getFullYear() % 100),
    MMMM: () => MONTHS[d.getMonth()]!, MMM: () => MONTHS[d.getMonth()]!.slice(0, 3), MM: () => two(d.getMonth() + 1), M: () => String(d.getMonth() + 1),
    DD: () => two(d.getDate()), D: () => String(d.getDate()),
    dddd: () => DAYS[d.getDay()]!, ddd: () => DAYS[d.getDay()]!.slice(0, 3),
    HH: () => two(d.getHours()), H: () => String(d.getHours()), hh: () => two(d.getHours() % 12 || 12), h: () => String(d.getHours() % 12 || 12),
    mm: () => two(d.getMinutes()), m: () => String(d.getMinutes()), ss: () => two(d.getSeconds()), s: () => String(d.getSeconds()),
    A: () => (d.getHours() < 12 ? 'AM' : 'PM'), a: () => (d.getHours() < 12 ? 'am' : 'pm'),
  }
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g, (token, literal: string | undefined) => literal ?? tokens[token]!())
}
