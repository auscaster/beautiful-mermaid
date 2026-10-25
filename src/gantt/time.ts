// ============================================================================
// Time as Mermaid's Gantt axis shows it: ticks where d3's time scale puts them
// (or at the chart's own tickInterval), labelled in d3's strftime format, in
// local time, as Mermaid reads the chart's dates.
// ============================================================================

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** A calendar step in local time, as d3-time defines one. */
interface Interval {
  floor(date: Date): void
  offset(date: Date, step: number): void
  /** The calendar field `every` steps through */
  field?(date: Date): number
}

const millisecond: Interval = { floor: () => {}, offset: (d, s) => d.setTime(+d + s) }
const second: Interval = { floor: (d) => d.setTime(+d - d.getMilliseconds()), offset: (d, s) => d.setTime(+d + s * SECOND), field: (d) => d.getUTCSeconds() }
const minute: Interval = { floor: (d) => d.setTime(+d - d.getMilliseconds() - d.getSeconds() * SECOND), offset: (d, s) => d.setTime(+d + s * MINUTE), field: (d) => d.getMinutes() }
const hour: Interval = {
  floor: (d) => d.setTime(+d - d.getMilliseconds() - d.getSeconds() * SECOND - d.getMinutes() * MINUTE),
  offset: (d, s) => d.setTime(+d + s * HOUR),
  field: (d) => d.getHours(),
}
const day: Interval = { floor: (d) => d.setHours(0, 0, 0, 0), offset: (d, s) => d.setDate(d.getDate() + s), field: (d) => d.getDate() - 1 }
const month: Interval = { floor: (d) => { d.setDate(1); d.setHours(0, 0, 0, 0) }, offset: (d, s) => d.setMonth(d.getMonth() + s), field: (d) => d.getMonth() }
const year: Interval = { floor: (d) => { d.setMonth(0, 1); d.setHours(0, 0, 0, 0) }, offset: (d, s) => d.setFullYear(d.getFullYear() + s), field: (d) => d.getFullYear() }

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** Weeks starting on `weekday` (0 for Sunday). */
function weekStarting(weekday: number): Interval {
  return {
    floor: (d) => { d.setDate(d.getDate() - ((d.getDay() + 7 - weekday) % 7)); d.setHours(0, 0, 0, 0) },
    offset: (d, s) => d.setDate(d.getDate() + s * 7),
  }
}

/** Whole weeks from the epoch's week to `date`'s, across daylight-saving changes. */
function weeksSinceEpoch(week: Interval, date: Date): number {
  const start = new Date(0)
  const end = new Date(+date)
  week.floor(start)
  week.floor(end)
  return Math.floor((+end - +start - (end.getTimezoneOffset() - start.getTimezoneOffset()) * MINUTE) / WEEK)
}

/** Every `step`th of an interval, as d3's `interval.every(step)` keeps them. */
function every(interval: Interval, step: number): Interval {
  step = Math.floor(step)
  if (!(step > 1)) return interval
  if (interval === millisecond) return { floor: (d) => d.setTime(Math.floor(+d / step) * step), offset: (d, s) => d.setTime(+d + s * step) }
  if (interval === year) {
    return {
      floor: (d) => { d.setFullYear(Math.floor(d.getFullYear() / step) * step); d.setMonth(0, 1); d.setHours(0, 0, 0, 0) },
      offset: (d, s) => d.setFullYear(d.getFullYear() + s * step),
    }
  }
  const test = interval.field ? (d: Date) => interval.field!(d) % step === 0 : (d: Date) => weeksSinceEpoch(interval, d) % step === 0
  return {
    floor: (d) => { while ((interval.floor(d), !test(d))) d.setTime(+d - 1) },
    offset: (d, s) => { while (--s >= 0) while ((interval.offset(d, 1), !test(d))) { /* step on */ } },
  }
}

/** The interval's dates from `start` up to, not including, `stop`. */
function range(interval: Interval, start: number, stop: number): Date[] {
  const dates: Date[] = []
  const at = new Date(start - 1)
  interval.floor(at)
  interval.offset(at, 1)
  interval.floor(at)
  if (!(+at < stop)) return dates
  let previous: Date
  do {
    dates.push(previous = new Date(+at))
    interval.offset(at, 1)
    interval.floor(at)
  } while (+previous < +at && +at < stop)
  return dates
}

/** d3-array's tickStep: a round step that cuts the span into about `count` pieces. */
function tickStep(start: number, stop: number, count: number): number {
  const step = (stop - start) / Math.max(0, count)
  const power = Math.floor(Math.log10(step))
  const error = step / Math.pow(10, power)
  const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1
  return factor * Math.pow(10, power)
}

const TICK_INTERVALS: [Interval, number, number][] = [
  [second, 1, SECOND], [second, 5, 5 * SECOND], [second, 15, 15 * SECOND], [second, 30, 30 * SECOND],
  [minute, 1, MINUTE], [minute, 5, 5 * MINUTE], [minute, 15, 15 * MINUTE], [minute, 30, 30 * MINUTE],
  [hour, 1, HOUR], [hour, 3, 3 * HOUR], [hour, 6, 6 * HOUR], [hour, 12, 12 * HOUR],
  [day, 1, DAY], [day, 2, 2 * DAY], [weekStarting(0), 1, WEEK],
  [month, 1, MONTH], [month, 3, 3 * MONTH], [year, 1, YEAR],
]

/** The interval d3's time scale picks for about `count` ticks across a span. */
function autoInterval(start: number, stop: number, count: number): Interval {
  const target = Math.abs(stop - start) / count
  const i = TICK_INTERVALS.findIndex(([, , step]) => step > target)
  if (i === -1) return every(year, tickStep(start / YEAR, stop / YEAR, count))
  if (i === 0) return every(millisecond, Math.max(tickStep(start, stop, count), 1))
  const [interval, step] = TICK_INTERVALS[target / TICK_INTERVALS[i - 1]![2] < TICK_INTERVALS[i]![2] / target ? i - 1 : i]!
  return every(interval, step)
}

const TICK_INTERVAL = /^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/

/**
 * The axis ticks across a span, as Mermaid's Gantt chart places them: at the
 * chart's `tickInterval` (`1week`, `15minute`), weeks starting on its
 * `weekday`, or else where d3 places about ten.
 */
export function timeTicks(start: number, stop: number, tickInterval?: string, weekday = 'sunday'): Date[] {
  if (!(stop > start)) return [new Date(start)]
  const match = tickInterval ? TICK_INTERVAL.exec(tickInterval) : null
  let interval: Interval
  if (match) {
    const step = Number(match[1])
    const unit = match[2]!
    const base: Interval = unit === 'millisecond' ? millisecond : unit === 'second' ? second : unit === 'minute' ? minute : unit === 'hour' ? hour
      : unit === 'day' ? day : unit === 'week' ? weekStarting(Math.max(0, WEEKDAYS.indexOf(weekday as typeof WEEKDAYS[number]))) : month
    interval = every(base, step)
  } else interval = autoInterval(start, stop, 10)
  return range(interval, start, stop + 1)
}

// ============================================================================
// d3-time-format's strftime directives, in English
// ============================================================================

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function pad(value: number, fill: string, width: number): string {
  const sign = value < 0 ? '-' : ''
  const digits = String(Math.abs(value))
  return sign + (digits.length < width ? fill.repeat(width - digits.length) + digits : digits)
}

function dayOfYear(d: Date): number {
  return Math.round((+new Date(d.getFullYear(), d.getMonth(), d.getDate()) - +new Date(d.getFullYear(), 0, 1)) / DAY)
}

/** ISO 8601 week number and the year it belongs to. */
function isoWeek(d: Date): [number, number] {
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7))
  return [Math.floor(dayOfYear(thursday) / 7) + 1, thursday.getFullYear()]
}

/** Each directive: its value for a date, and d3's padding for it (fill and width). */
const DIRECTIVES: Record<string, (d: Date) => [number | string, string?, number?]> = {
  a: (d) => [DAY_NAMES[d.getDay()]!.slice(0, 3)],
  A: (d) => [DAY_NAMES[d.getDay()]!],
  b: (d) => [MONTH_NAMES[d.getMonth()]!.slice(0, 3)],
  B: (d) => [MONTH_NAMES[d.getMonth()]!],
  d: (d) => [d.getDate(), '0', 2],
  e: (d) => [d.getDate(), ' ', 2],
  f: (d) => [d.getMilliseconds() * 1000, '0', 6],
  g: (d) => [isoWeek(d)[1] % 100, '0', 2],
  G: (d) => [isoWeek(d)[1], '0', 4],
  H: (d) => [d.getHours(), '0', 2],
  I: (d) => [d.getHours() % 12 || 12, '0', 2],
  j: (d) => [dayOfYear(d) + 1, '0', 3],
  L: (d) => [d.getMilliseconds(), '0', 3],
  m: (d) => [d.getMonth() + 1, '0', 2],
  M: (d) => [d.getMinutes(), '0', 2],
  p: (d) => [d.getHours() >= 12 ? 'PM' : 'AM'],
  q: (d) => [Math.floor(d.getMonth() / 3) + 1],
  Q: (d) => [+d],
  s: (d) => [Math.floor(+d / 1000)],
  S: (d) => [d.getSeconds(), '0', 2],
  u: (d) => [d.getDay() || 7],
  U: (d) => [Math.floor((dayOfYear(d) + new Date(d.getFullYear(), 0, 1).getDay()) / 7), '0', 2],
  V: (d) => [isoWeek(d)[0], '0', 2],
  w: (d) => [d.getDay()],
  W: (d) => [Math.floor((dayOfYear(d) + ((new Date(d.getFullYear(), 0, 1).getDay() + 6) % 7)) / 7), '0', 2],
  y: (d) => [d.getFullYear() % 100, '0', 2],
  Y: (d) => [d.getFullYear() % 10000, '0', 4],
  Z: (d) => {
    const offset = -d.getTimezoneOffset()
    return [`${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60), '0', 2)}${pad(Math.abs(offset) % 60, '0', 2)}`]
  },
}
const EXPANSIONS: Record<string, string> = { c: '%x, %X', x: '%-m/%-d/%Y', X: '%-I:%M:%S %p' }

/** A date in d3-time-format's strftime format (`%Y-%m-%d`, `%b %e`, `%H:%M`), in local time. */
export function formatTime(format: string, date: Date): string {
  return format
    .replace(/%([-_0]?)([cxX])/g, (_, __, code: string) => EXPANSIONS[code]!)
    .replace(/%([-_0]?)([a-zA-Z%])/g, (match, modifier: string, code: string) => {
      if (code === '%') return '%'
      const directive = DIRECTIVES[code]
      if (!directive) return match
      const [value, fill, width] = directive(date)
      if (typeof value === 'string' || !fill || !width) return String(value)
      return modifier === '-' ? String(value) : pad(value, modifier === '_' ? ' ' : modifier === '0' ? '0' : fill, width)
    })
}
