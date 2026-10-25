import type { SequenceDiagram, SequenceEvent, PositionedSequenceDiagram, PositionedActor, Lifeline, PositionedMessage, Activation, PositionedBlock, PositionedNote, Note, ActorType } from './types.ts'
import type { RenderOptions } from '../types.ts'
import { FONT_SIZES, FONT_WEIGHTS } from '../styles.ts'
import { measureMultilineText } from '../text-metrics.ts'

// ============================================================================
// Sequence diagram layout engine
//
// A timeline, as Mermaid lays one out: actors side by side, as far apart as
// the messages and notes between them need; then each message, note, block
// and activation in the order it happens, each line of a label given room.
// The actors are repeated below the lifelines, as Mermaid repeats them.
// ============================================================================

/** Layout constants specific to sequence diagrams */
export const SEQ = {
  /** Padding around the entire diagram */
  padding: 16,
  /** Actor box height for a one-line label */
  actorHeight: 40,
  /** Horizontal padding inside actor boxes, and vertical padding around a taller label */
  actorPadX: 16,
  actorPadY: 8,
  actorMinWidth: 80,
  /** Space between an actor figure and its label below it */
  actorLabelGap: 6,
  /** Least space between neighbouring actor boxes */
  actorMargin: 40,
  /** Space between the actors and the first row */
  headerGap: 20,
  /** Space between a message's label and its arrow */
  labelGap: 6,
  /** Room either side of a label between the lifelines it spans */
  labelClearance: 16,
  /** Space between one row and the next */
  rowGap: 20,
  /** A self-message's loop out from its lifeline and back, its label centred above it */
  selfLoopWidth: 30,
  selfLoopHeight: 20,
  /** Activation box width (narrow rectangle on lifeline), and its shift per nesting level */
  activationWidth: 10,
  activationNesting: 4,
  /** Notes: their gap from a lifeline, their padding and least width */
  noteGap: 10,
  notePadX: 10,
  notePadY: 6,
  noteMinWidth: 60,
  /** How far an over-note reaches past the lifelines it spans */
  noteOverhang: 20,
  /** Blocks: their inset around what they hold, and the space under their label tab */
  blockPad: 10,
  blockTabMinHeight: 18,
  blockTabPadX: 8,
  blockTabPadY: 2,
  blockHeaderGap: 10,
  /** Space either side of an else/and divider's label */
  dividerGap: 8,
  /** Space between the last row and the repeated actors */
  footerGap: 24,
  /** Participant boxes: their inset around their actors */
  boxPad: 10,
  boxLabelGap: 6,
} as const

/** A label's size in the message font: its widest line and its lines' height. */
function labelSize(text: string): { width: number; height: number } {
  if (!text) return { width: 0, height: 0 }
  const metrics = measureMultilineText(text, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)
  return { width: metrics.width, height: metrics.height }
}

/** Where a message's label is centred: its last line `labelGap` above the arrow. */
export function messageLabelY(arrowY: number, label: string): number {
  return arrowY - SEQ.labelGap - labelSize(label).height / 2
}

/** A block's label tab, `loop [label]`, sized to hold every line. */
export function blockTab(type: string, label: string): { text: string; width: number; height: number } {
  const text = `${type}${label ? ` [${label}]` : ''}`
  const metrics = measureMultilineText(text, FONT_SIZES.edgeLabel, FONT_WEIGHTS.groupHeader)
  return { text, width: metrics.width + SEQ.blockTabPadX * 2, height: Math.max(SEQ.blockTabMinHeight, metrics.height + SEQ.blockTabPadY * 2) }
}

/** An else/and divider's label, `[label]`, as drawn under its line. */
export function dividerLabel(label: string): { text: string; width: number; height: number } {
  const text = label ? `[${label}]` : ''
  return { text, ...labelSize(text) }
}

/** A note's size: its text with padding, at least the minimum width. */
function noteSize(text: string): { width: number; height: number } {
  const size = labelSize(text)
  return { width: Math.max(SEQ.noteMinWidth, size.width + SEQ.notePadX * 2), height: size.height + SEQ.notePadY * 2 }
}

/** An actor's label in the actor font. */
function actorLabel(label: string): { width: number; height: number } {
  return measureMultilineText(label, FONT_SIZES.nodeLabel, FONT_WEIGHTS.nodeLabel)
}

/** Actors drawn as a symbol with their label under it, rather than as a labelled box. */
export const SYMBOL_ACTORS: ReadonlySet<ActorType> = new Set(['actor', 'boundary', 'control', 'entity'])

/** How far an actor reaches below its top: its box, or its symbol and the label under it. */
export function actorDepth(actor: PositionedActor): number {
  return SYMBOL_ACTORS.has(actor.type) ? actor.height + SEQ.actorLabelGap + actorLabel(actor.label).height : actor.height
}

/** Where a block's contents start below its top: under its label tab, or inside its padding when it has none. */
function blockHead(type: PositionedBlock['type'], label: string): number {
  return type === 'rect' ? SEQ.blockPad : blockTab(type, label).height + SEQ.blockHeaderGap
}

interface OpenBlock {
  type: PositionedBlock['type']
  label: string
  fill?: string
  top: number
  dividers: { y: number; label: string }[]
  left: number
  right: number
}

/**
 * Lay out a parsed sequence diagram.
 * Returns a fully positioned diagram ready for SVG rendering.
 */
export function layoutSequenceDiagram(
  diagram: SequenceDiagram,
  _options: RenderOptions = {}
): PositionedSequenceDiagram {
  if (diagram.actors.length === 0) {
    return { width: 0, height: 0, actors: [], lifelines: [], messages: [], activations: [], blocks: [], notes: [] }
  }
  const timeline = diagram.timeline ?? timelineOf(diagram)

  // 1. Actor sizes, then centres as far apart as the timeline needs.
  const actorIndex = new Map(diagram.actors.map((actor, i) => [actor.id, i]))
  const index = (id: string) => actorIndex.get(id) ?? 0
  const labels = diagram.actors.map((actor) => actorLabel(actor.label))
  const widths = labels.map((metrics) => Math.max(SEQ.actorMinWidth, metrics.width + SEQ.actorPadX * 2))
  const actorHeight = Math.max(SEQ.actorHeight, ...diagram.actors.map((actor, i) => SYMBOL_ACTORS.has(actor.type) ? 0 : labels[i]!.height + SEQ.actorPadY * 2))
  const gaps = gapsFor(diagram, timeline, widths, index)
  const centers: number[] = [0]
  for (let i = 1; i < widths.length; i++) centers.push(centers[i - 1]! + gaps[i - 1]!)

  const boxed = (diagram.boxes ?? []).filter((box) => box.actorIds.length)
  const boxLabelHeight = Math.max(0, ...boxed.map((box) => box.label ? labelSize(box.label).height + SEQ.boxLabelGap : 0))
  const actorTop = boxed.length ? SEQ.boxPad + boxLabelHeight : 0
  const actors: PositionedActor[] = diagram.actors.map((actor, i) => ({ id: actor.id, label: actor.label, type: actor.type, x: centers[i]!, y: actorTop, width: widths[i]!, height: actorHeight }))
  // An actor a message creates appears where that message arrives; one a message destroys ends there.
  const created = new Set<string>()
  for (const event of timeline) if (event.kind === 'message' && event.creates) created.add(event.message.to)
  const ends = new Map<string, number>()
  const headBottom = actorTop + Math.max(...actors.filter((actor) => !created.has(actor.id)).map(actorDepth), actorHeight)

  // 2. The timeline, top to bottom. `y` is where the next row starts; `bottom` is the
  //    lowest thing drawn so far; `arrowY` is the last message's arrow.
  let y = headBottom + SEQ.headerGap
  let bottom = headBottom
  let arrowY = y
  let number = 0
  const messages: PositionedMessage[] = []
  const notes: PositionedNote[] = []
  const activations: Activation[] = []
  const blocks: PositionedBlock[] = []
  const active = new Map<string, number[]>()
  const open: OpenBlock[] = []

  /** Widen every open block to hold what was just placed. */
  const hold = (left: number, right: number) => {
    for (const block of open) {
      block.left = Math.min(block.left, left)
      block.right = Math.max(block.right, right)
    }
  }
  /** Where a message meets a lifeline: the side of its activation box facing `toward`, at `depth` activations deep. */
  const meet = (actorId: string, toward: number, depth = active.get(actorId)?.length ?? 0) => {
    const x = centers[index(actorId)]!
    if (!depth) return x
    const box = x - SEQ.activationWidth / 2 + (depth - 1) * SEQ.activationNesting
    return toward > x ? box + SEQ.activationWidth : box
  }
  const activation = (actorId: string, depth: number, top: number): Activation => ({
    actorId,
    x: centers[index(actorId)]! - SEQ.activationWidth / 2 + depth * SEQ.activationNesting,
    topY: top,
    bottomY: Math.max(arrowY, top + SEQ.activationWidth),
    width: SEQ.activationWidth,
  })
  const closeBlock = () => {
    const block = open.pop()!
    const tab = block.type === 'rect' ? { width: 0 } : blockTab(block.type, block.label)
    // A block holds what happened within it; an empty one spans every actor.
    let left = Number.isFinite(block.left) ? block.left - SEQ.blockPad : centers[0]! - widths[0]! / 2
    let right = Number.isFinite(block.right) ? block.right + SEQ.blockPad : centers[centers.length - 1]! + widths[widths.length - 1]! / 2
    const least = Math.max(tab.width, ...block.dividers.map((divider) => dividerLabel(divider.label).width + SEQ.blockTabPadX * 2)) + SEQ.blockPad
    if (right - left < least) {
      const grow = (least - (right - left)) / 2
      left -= grow
      right += grow
    }
    const end = bottom + SEQ.blockPad
    blocks.push({ type: block.type, label: block.label, ...(block.fill ? { fill: block.fill } : {}), x: left, y: block.top, width: right - left, height: end - block.top, dividers: block.dividers })
    hold(left, right)
    bottom = end
    y = end + SEQ.rowGap
  }

  timeline.forEach((event, at) => {
    switch (event.kind) {
      case 'message': {
        const msg = event.message
        const label = labelSize(msg.label)
        const fromX = centers[index(msg.from)]!
        const toX = centers[index(msg.to)]!
        const numbered = event.number !== undefined ? { number: event.number } : diagram.autonumber ? { number: ++number } : {}
        const flags = msg.bidirectional ? { bidirectional: true } : {}
        // A message that activates its target ends at the side of the box it opens.
        const next = timeline[at + 1]
        const opens = next?.kind === 'activate' && next.actorId === msg.to ? 1 : 0
        if (msg.from === msg.to) {
          // As Mermaid draws one: its label centred above a loop out to the right and back.
          const loopTop = y + label.height + SEQ.labelGap
          const x1 = meet(msg.from, fromX + 1)
          const mid = x1 + SEQ.selfLoopWidth / 2
          messages.push({ from: msg.from, to: msg.to, label: msg.label, lineStyle: msg.lineStyle, arrowHead: msg.arrowHead, ...flags, ...numbered, x1, x2: x1, y: loopTop, isSelf: true })
          hold(Math.min(fromX - SEQ.activationWidth, mid - label.width / 2), Math.max(x1 + SEQ.selfLoopWidth, mid + label.width / 2))
          arrowY = loopTop + SEQ.selfLoopHeight
          bottom = arrowY
        } else {
          // An end that appears or ends here is its actor's box, centred on the arrow, which meets its side.
          const end = event.creates ? 'to' : event.destroys
          const endActor = end ? actors[index(msg[end])]! : undefined
          const lineY = y + Math.max(label.height + SEQ.labelGap, endActor ? actorHeight / 2 : 0)
          const side = (toward: number) => toward > endActor!.x ? endActor!.x + endActor!.width / 2 : endActor!.x - endActor!.width / 2
          const x1 = end === 'from' ? side(toX) : meet(msg.from, toX)
          const x2 = end === 'to' ? side(fromX) : meet(msg.to, fromX, (active.get(msg.to)?.length ?? 0) + opens)
          messages.push({ from: msg.from, to: msg.to, label: msg.label, lineStyle: msg.lineStyle, arrowHead: msg.arrowHead, ...flags, ...numbered, x1, x2, y: lineY, isSelf: false })
          const mid = (x1 + x2) / 2
          hold(Math.min(x1, x2, mid - label.width / 2), Math.max(x1, x2, mid + label.width / 2))
          arrowY = lineY
          bottom = lineY
          if (endActor) {
            const top = lineY - actorHeight / 2
            if (event.creates) endActor.y = top
            else ends.set(endActor.id, top)
            hold(endActor.x - endActor.width / 2, endActor.x + endActor.width / 2)
            bottom = Math.max(bottom, top + actorDepth(endActor))
          }
        }
        y = bottom + SEQ.rowGap
        break
      }
      case 'note': {
        const { note } = event
        const size = noteSize(note.text)
        const first = index(note.actorIds[0] ?? '')
        const last = index(note.actorIds[note.actorIds.length - 1] ?? '')
        let width = size.width
        let x: number
        if (note.position === 'left') x = centers[first]! - SEQ.noteGap - width
        else if (note.position === 'right') x = centers[first]! + SEQ.noteGap
        else if (first !== last) {
          const left = Math.min(centers[first]!, centers[last]!) - SEQ.noteOverhang
          const right = Math.max(centers[first]!, centers[last]!) + SEQ.noteOverhang
          width = Math.max(width, right - left)
          x = (left + right) / 2 - width / 2
        } else x = centers[first]! - width / 2
        notes.push({ text: note.text, x, y, width, height: size.height, actors: note.actorIds, position: note.position })
        hold(x, x + width)
        bottom = y + size.height
        y = bottom + SEQ.rowGap
        break
      }
      case 'block-start': {
        open.push({ type: event.type, label: event.label, ...(event.fill ? { fill: event.fill } : {}), top: y, dividers: [], left: Infinity, right: -Infinity })
        bottom = y
        y += blockHead(event.type, event.label)
        break
      }
      case 'block-divider': {
        const block = open[open.length - 1]
        if (!block) break
        // Midway between the row above and the row below.
        const line = bottom + SEQ.rowGap / 2
        block.dividers.push({ y: line, label: event.label })
        const label = dividerLabel(event.label)
        bottom = line + (label.height ? SEQ.dividerGap + label.height : 0)
        y = bottom + (label.height ? SEQ.dividerGap : SEQ.rowGap / 2)
        break
      }
      case 'block-end': {
        if (open.length) closeBlock()
        break
      }
      case 'activate': {
        const stack = active.get(event.actorId) ?? []
        stack.push(arrowY)
        active.set(event.actorId, stack)
        break
      }
      case 'deactivate': {
        const stack = active.get(event.actorId)
        const top = stack?.pop()
        if (top !== undefined) activations.push(activation(event.actorId, stack!.length, top))
        break
      }
    }
  })
  while (open.length) closeBlock()
  // Activations still open at the end run to the last row.
  arrowY = Math.max(arrowY, bottom)
  for (const [actorId, stack] of active) stack.forEach((top, depth) => activations.push(activation(actorId, depth, top)))

  // 3. The actors again, below the lifelines, or where they ended.
  const footerTop = bottom + SEQ.footerGap
  const footerActors = actors.map((actor) => ({ ...actor, y: ends.get(actor.id) ?? footerTop }))
  const lifelines: Lifeline[] = actors.map((actor, i) => ({ actorId: actor.id, x: actor.x, topY: actor.y + actorDepth(actor), bottomY: footerActors[i]!.y }))
  const footerBottom = footerTop + Math.max(...footerActors.map(actorDepth))
  const boxes = boxed.map((box) => {
    const members = box.actorIds.map((id) => actors[index(id)]!)
    let left = Math.min(...members.map((actor) => actor.x - actor.width / 2)) - SEQ.boxPad
    let right = Math.max(...members.map((actor) => actor.x + actor.width / 2)) + SEQ.boxPad
    // Wide enough for its label.
    const grow = Math.max(0, labelSize(box.label).width + SEQ.boxPad * 2 - (right - left)) / 2
    left -= grow
    right += grow
    const top = actorTop - SEQ.boxPad - boxLabelHeight
    return { label: box.label, x: left, y: top, width: right - left, height: footerBottom + SEQ.boxPad - top, ...(box.fill ? { fill: box.fill } : {}) }
  })

  // 4. The canvas: everything drawn, the same padding on every side.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const take = (left: number, top: number, right: number, under: number) => {
    x0 = Math.min(x0, left); y0 = Math.min(y0, top); x1 = Math.max(x1, right); y1 = Math.max(y1, under)
  }
  for (const actor of [...actors, ...footerActors]) {
    const reach = SYMBOL_ACTORS.has(actor.type) ? Math.max(actor.width, actorLabel(actor.label).width) / 2 : actor.width / 2
    take(actor.x - reach, actor.y, actor.x + reach, actor.y + actorDepth(actor))
  }
  for (const msg of messages) {
    const label = labelSize(msg.label)
    const mid = msg.isSelf ? msg.x1 + SEQ.selfLoopWidth / 2 : (msg.x1 + msg.x2) / 2
    const right = msg.isSelf ? msg.x1 + SEQ.selfLoopWidth : Math.max(msg.x1, msg.x2)
    take(Math.min(msg.x1, msg.x2, mid - label.width / 2), msg.y - SEQ.labelGap - label.height, Math.max(right, mid + label.width / 2), msg.y + (msg.isSelf ? SEQ.selfLoopHeight : 0))
  }
  for (const item of [...notes, ...blocks, ...boxes]) take(item.x, item.y, item.x + item.width, item.y + item.height)
  for (const act of activations) take(act.x, act.topY, act.x + act.width, act.bottomY)
  const dx = SEQ.padding - x0
  const dy = SEQ.padding - y0
  return {
    width: x1 - x0 + SEQ.padding * 2,
    height: y1 - y0 + SEQ.padding * 2,
    actors: actors.map((actor) => ({ ...actor, x: actor.x + dx, y: actor.y + dy })),
    footerActors: footerActors.map((actor) => ({ ...actor, x: actor.x + dx, y: actor.y + dy })),
    lifelines: lifelines.map((line) => ({ ...line, x: line.x + dx, topY: line.topY + dy, bottomY: line.bottomY + dy })),
    messages: messages.map((msg) => ({ ...msg, x1: msg.x1 + dx, x2: msg.x2 + dx, y: msg.y + dy })),
    activations: activations.map((act) => ({ ...act, x: act.x + dx, topY: act.topY + dy, bottomY: act.bottomY + dy })),
    blocks: blocks.map((block) => ({ ...block, x: block.x + dx, y: block.y + dy, dividers: block.dividers.map((divider) => ({ ...divider, y: divider.y + dy })) })),
    notes: notes.map((note) => ({ ...note, x: note.x + dx, y: note.y + dy })),
    ...(boxes.length ? { boxes: boxes.map((box) => ({ ...box, x: box.x + dx, y: box.y + dy })) } : {}),
  }
}

/**
 * The space between neighbouring actors' centres: room for their boxes, for
 * every label between the lifelines it spans, for a self-message's label
 * beside its loop, and for a note beside or over its actors.
 */
function gapsFor(diagram: SequenceDiagram, timeline: SequenceEvent[], widths: number[], index: (id: string) => number): number[] {
  const gaps = widths.slice(1).map((width, i) => (widths[i]! + width) / 2 + SEQ.actorMargin)
  // Neighbours in different participant boxes sit apart by both boxes' insets.
  const boxOf = new Map<number, number>()
  diagram.boxes?.forEach((box, b) => box.actorIds.forEach((id) => boxOf.set(index(id), b)))
  gaps.forEach((gap, i) => {
    if (boxOf.get(i) !== boxOf.get(i + 1)) gaps[i] = Math.max(gap, (widths[i]! + widths[i + 1]!) / 2 + SEQ.boxPad * 2 + SEQ.actorMargin / 2)
  })
  const spans: { from: number; to: number; length: number }[] = []
  const need = (from: number, to: number, length: number) => {
    if (from >= 0 && to > from && to <= gaps.length) spans.push({ from, to, length })
  }
  for (const event of timeline) {
    if (event.kind === 'message') {
      const { from, to, label } = event.message
      const width = labelSize(label).width
      const a = index(from)
      const b = index(to)
      // A message to or from an actor's box (created or destroyed there) stops at the box's side.
      const endAt = event.creates || event.destroys === 'to' ? b : event.destroys === 'from' ? a : undefined
      const side = endAt === undefined ? 0 : widths[endAt]! / 2
      if (a === b) {
        // Half the label either side of the loop's middle.
        need(a, a + 1, SEQ.selfLoopWidth / 2 + width / 2 + SEQ.labelClearance)
        need(a - 1, a, width / 2 - SEQ.selfLoopWidth / 2 + SEQ.labelClearance)
      } else need(Math.min(a, b), Math.max(a, b), width + SEQ.labelClearance * 2 + side)
    } else if (event.kind === 'note') {
      const { note } = event
      const width = noteSize(note.text).width
      const a = index(note.actorIds[0] ?? '')
      const b = index(note.actorIds[note.actorIds.length - 1] ?? '')
      if (note.position === 'right') need(a, a + 1, SEQ.noteGap * 2 + width)
      else if (note.position === 'left') need(a - 1, a, SEQ.noteGap * 2 + width)
      else if (a === b) {
        need(a - 1, a, width / 2 + SEQ.noteGap)
        need(a, a + 1, width / 2 + SEQ.noteGap)
      } else need(Math.min(a, b), Math.max(a, b), width - SEQ.noteOverhang * 2)
    }
  }
  // Narrow spans first, so a wide one only adds what the narrower ones have not given it.
  spans.sort((p, q) => (p.to - p.from) - (q.to - q.from))
  for (const { from, to, length } of spans) {
    let total = 0
    for (let i = from; i < to; i++) total += gaps[i]!
    if (total >= length) continue
    const extra = (length - total) / (to - from)
    for (let i = from; i < to; i++) gaps[i] = gaps[i]! + extra
  }
  return gaps
}

/**
 * The timeline a diagram parsed here describes: each message in turn, with
 * the blocks that open before it and close after it, the notes that follow it,
 * and the lifelines its `+` and `-` activate and deactivate.
 */
function timelineOf(diagram: SequenceDiagram): SequenceEvent[] {
  const events: SequenceEvent[] = []
  const notesAfter = new Map<number, Note[]>()
  for (const note of diagram.notes) notesAfter.set(note.afterIndex, [...(notesAfter.get(note.afterIndex) ?? []), note])
  const noteEvent = ({ actorIds, text, position }: Note): SequenceEvent => ({ kind: 'note', note: { actorIds, text, position } })
  for (const note of notesAfter.get(-1) ?? []) events.push(noteEvent(note))
  diagram.messages.forEach((message, i) => {
    // Outer blocks open first and close last.
    for (const block of diagram.blocks.filter((b) => b.startIndex === i).sort((p, q) => q.endIndex - p.endIndex)) {
      events.push({ kind: 'block-start', type: block.type, label: block.label })
    }
    for (const block of diagram.blocks) {
      for (const divider of block.dividers) if (divider.index === i) events.push({ kind: 'block-divider', label: divider.label })
    }
    events.push({ kind: 'message', message })
    if (message.activate) events.push({ kind: 'activate', actorId: message.to })
    if (message.deactivate) events.push({ kind: 'deactivate', actorId: message.from })
    for (const note of notesAfter.get(i) ?? []) events.push(noteEvent(note))
    for (const _ of diagram.blocks.filter((b) => b.endIndex === i)) events.push({ kind: 'block-end' })
  })
  return events
}
