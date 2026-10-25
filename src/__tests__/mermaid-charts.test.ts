/**
 * Gantt charts, pie charts and mindmaps as Mermaid's parser reads them,
 * written the way Mermaid 11 hands them over, so these run without Mermaid.
 * Dates are local, as Mermaid reads a chart's dates.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidDiagram } from '../index.ts'
import { mermaidGantt, type MermaidGanttDb } from '../mermaid/gantt.ts'
import { mermaidPie } from '../mermaid/pie.ts'
import { mermaidMindmap } from '../mermaid/mindmap.ts'
import { layoutGantt } from '../gantt/layout.ts'
import { layoutPie } from '../pie/layout.ts'
import { layoutMindmap } from '../mindmap/layout.ts'
import { formatTime, timeTicks } from '../gantt/time.ts'

const day = (d: number, h = 0, m = 0) => new Date(2024, 0, d, h, m)

describe('Gantt time axis', () => {
  it('ticks where d3 puts about ten, or at the chart\'s own interval from its weekday', () => {
    expect(timeTicks(+day(1, 9), +day(1, 9, 50)).map((t) => formatTime('%H:%M', t))).toEqual(['09:00', '09:05', '09:10', '09:15', '09:20', '09:25', '09:30', '09:35', '09:40', '09:45', '09:50'])
    expect(timeTicks(+day(1), +day(21)).map((t) => t.getDate())).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21])
    // 3 January 2024 is a Wednesday: weekly ticks fall on Sundays, or on the chart's weekday.
    expect(timeTicks(+day(3), +day(24), '1week').map((t) => t.getDate())).toEqual([7, 14, 21])
    expect(timeTicks(+day(3), +day(24), '1week', 'monday').map((t) => t.getDate())).toEqual([8, 15, 22])
  })

  it('formats as d3\'s strftime does, padding and all', () => {
    const at = new Date(2024, 2, 5, 14, 7, 9)
    expect(formatTime('%Y-%m-%d', at)).toBe('2024-03-05')
    expect(formatTime('%b %e, %a %I:%M %p', at)).toBe('Mar  5, Tue 02:07 PM')
    expect(formatTime('%-d/%-m %H:%M:%S %j %%', at)).toBe('5/3 14:07:09 065 %')
    expect(formatTime('%x', at)).toBe('3/5/2024')
  })
})

describe('Mermaid Gantt charts', () => {
  const task = (id: string, section: string, start: Date, end: Date, extra: object = {}) => ({ id, task: `${id} `, section, startTime: start, endTime: end, ...extra })
  const db = (tasks: object[], extra: Partial<Record<keyof MermaidGanttDb, () => unknown>> = {}) => ({
    getTasks: () => tasks,
    getDiagramTitle: () => 'Plan',
    getAxisFormat: () => '%m-%d',
    getTodayMarker: () => '',
    getExcludes: () => [],
    getIncludes: () => [],
    getDateFormat: () => 'YYYY-MM-DD',
    ...extra,
  }) as unknown as MermaidGanttDb

  it('reads sections, states, markers and excluded weekends, and labels each bar inside it where it fits', () => {
    const chart = mermaidGantt(db([
      task('Design', 'Build', day(1), day(4), { done: true }),
      task('A rather long task name', 'Build', day(4), day(5), { crit: true }),
      task('Freeze', 'Build', day(5), day(5), { vert: true }),
      task('Ship', 'Launch', day(10), day(10), { milestone: true }),
    ], { getExcludes: () => ['weekends'] }))
    expect(chart.sections).toEqual(['Build', 'Launch'])
    expect(chart.markers).toEqual([{ label: 'Freeze', at: +day(5) }])
    expect(chart.tasks.map((t) => [t.label, t.section, t.done ?? false, t.crit ?? false, t.milestone ?? false])).toEqual([
      ['Design', 0, true, false, false], ['A rather long task name', 0, false, true, false], ['Ship', 1, false, false, true],
    ])
    // 6 and 7 January 2024 are the weekend in the span.
    expect(chart.excluded).toEqual([{ start: +day(6), end: +day(8) }])
    const laid = layoutGantt(chart)
    const [design, long, ship] = laid.bars
    expect(design).toMatchObject({ inside: true, labelAnchor: 'middle' })
    expect(long).toMatchObject({ inside: false, labelAnchor: 'start' })
    expect(long!.labelX).toBeGreaterThan(long!.x + long!.width)
    expect(ship!.width).toBeCloseTo(22)
    expect(laid.ticks.map((t) => t.label)).toContain('01-05')
    expect(laid.excluded).toHaveLength(1)
  })

  it('packs a compact chart\'s tasks onto shared rows while they do not overlap, as Mermaid does', () => {
    const chart = mermaidGantt(db([
      task('a', 'S', day(1), day(3)),
      task('b', 'S', day(2), day(4)),
      task('c', 'S', day(3), day(5)),
    ]), { displayMode: 'compact' })
    const rows = layoutGantt(chart).bars.map((bar) => bar.y)
    expect(rows[0]).toBe(rows[2])
    expect(rows[1]).toBeGreaterThan(rows[0]!)
  })

  it('draws a today marker only for a moment it is given, and not when the chart turns it off', () => {
    const tasks = [task('a', 'S', day(1), day(10))]
    expect(mermaidGantt(db(tasks)).today).toBeUndefined()
    expect(mermaidGantt(db(tasks), {}, +day(5)).today).toEqual({ at: +day(5) })
    expect(mermaidGantt(db(tasks, { getTodayMarker: () => 'off' }), {}, +day(5)).today).toBeUndefined()
    const svg = renderMermaidDiagram({ type: 'gantt', db: db(tasks, { getTodayMarker: () => 'stroke-width:5px,stroke:#0f0' }) }, { today: day(5) })
    expect(svg).toContain('class="today"')
    expect(svg).toContain('stroke="#0f0" stroke-width="5"')
  })
})

describe('Mermaid pie charts', () => {
  it('draws the largest slice first from twelve o\'clock, labels the slices it can, and names every slice in the legend', () => {
    const chart = mermaidPie({ getSections: () => new Map([['Small', 2], ['Big', 70], ['Mid', 28]]), getShowData: () => true, getDiagramTitle: () => 'Share' })
    const pie = layoutPie(chart)
    expect(pie.slices.map((s) => [s.label, s.percent, s.color])).toEqual([['Big', 70, 0], ['Mid', 28, 1], ['Small', 2, 2]])
    expect(pie.slices[0]!.start).toBe(0)
    expect(pie.slices[2]!.end).toBeCloseTo(Math.PI * 2)
    expect(pie.slices[0]!.labelX).toBeDefined()
    expect(pie.slices[2]!.labelX).toBeUndefined()
    expect(pie.legend.map((row) => row.detail)).toEqual(['70 · 70%', '28 · 28%', '2 · 2%'])
    const svg = renderMermaidDiagram({ type: 'pie', db: { getSections: () => new Map([['Only', 1]]) } })
    expect(svg).toContain('<circle')
    expect(svg).toContain('<title>Only: 1 (100%)</title>')
  })
})

describe('Mermaid mindmaps', () => {
  const leaf = (id: number, descr: string, type = 0) => ({ id, descr, type, children: [] })
  const db = {
    getMindmap: () => ({
      id: 0, descr: 'Root', type: 3, children: [
        { id: 1, descr: 'A', type: 2, children: [leaf(2, 'A1'), leaf(3, 'A2')] },
        leaf(4, 'B', 1),
        leaf(5, 'C', 4),
        leaf(6, 'D', 6),
      ],
    }),
  }

  it('reads each node\'s shape, and grows the first branches down the right and the rest up the left, evened by leaves', () => {
    const root = mermaidMindmap(db)
    expect([root.shape, ...root.children.map((child) => child.shape)]).toEqual(['circle', 'rect', 'rounded', 'cloud', 'hexagon'])
    const map = layoutMindmap(root)
    const at = (label: string) => map.nodes.find((node) => node.label === label)!
    const centre = at('Root').x + at('Root').width / 2
    // A (two leaves) and B go right; C and D go left, D above C, reading on round the clock.
    expect(at('A').x).toBeGreaterThan(centre)
    expect(at('B').x).toBeGreaterThan(centre)
    expect(at('C').x + at('C').width).toBeLessThan(centre)
    expect(at('D').y).toBeLessThan(at('C').y)
    expect(at('A').y).toBeLessThan(at('B').y)
    expect(at('A1').branch).toBe(0)
    expect(map.edges.find((edge) => edge.to === at('A1').id)!.depth).toBe(2)
  })

  it('wraps a label past Mermaid\'s 200px', () => {
    const map = layoutMindmap(mermaidMindmap({ getMindmap: () => ({ id: 0, descr: 'A root label long enough that Mermaid would wrap it onto a second line', type: 0, children: [] }) }))
    expect(map.nodes[0]!.label).toContain('\n')
    expect(renderMermaidDiagram({ type: 'mindmap', db })).toContain('data-shape="cloud"')
  })
})
