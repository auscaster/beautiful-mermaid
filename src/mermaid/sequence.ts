// ============================================================================
// Sequence diagrams as Mermaid's parser reads them, in the sequence layout's
// terms: the actors in Mermaid's order, and a timeline of what happens, from
// the messages, notes, blocks and activations Mermaid records in turn.
// ============================================================================

import type { Actor, ActorType, Block, Message, SequenceDiagram, SequenceEvent, SequenceBox } from '../sequence/types.ts'
import { mermaidLabel } from './labels.ts'

interface MermaidActor {
  name: string
  description?: string
  type?: string
}

interface MermaidMessage {
  type: number
  from?: string
  to?: string
  /** The text; for an `autonumber` line, where numbering starts, its step, and whether it shows */
  message?: string | { start?: number; step?: number; visible?: boolean }
  placement?: number
}

/** The sequence database Mermaid's parser fills (`getDiagramFromText(text).db`). */
export interface MermaidSequenceDb {
  getActors(): Map<string, MermaidActor>
  getMessages(): MermaidMessage[]
  getBoxes?(): Array<{ name?: string; fill?: string; actorKeys: string[] }>
  showSequenceNumbers?(): boolean
  getCreatedActors?(): Map<string, number>
  getDestroyedActors?(): Map<string, number>
  LINETYPE: Record<string, number>
  PLACEMENT: Record<string, number>
}

const ACTOR_TYPES: ReadonlySet<string> = new Set<ActorType>(['participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue'])

/** Arrows by Mermaid's name for them: how the line is drawn and what it ends in. */
const ARROWS: Record<string, Pick<Message, 'lineStyle' | 'arrowHead' | 'bidirectional'>> = {
  SOLID: { lineStyle: 'solid', arrowHead: 'filled' },
  DOTTED: { lineStyle: 'dashed', arrowHead: 'filled' },
  SOLID_CROSS: { lineStyle: 'solid', arrowHead: 'cross' },
  DOTTED_CROSS: { lineStyle: 'dashed', arrowHead: 'cross' },
  SOLID_OPEN: { lineStyle: 'solid', arrowHead: 'none' },
  DOTTED_OPEN: { lineStyle: 'dashed', arrowHead: 'none' },
  SOLID_POINT: { lineStyle: 'solid', arrowHead: 'open' },
  DOTTED_POINT: { lineStyle: 'dashed', arrowHead: 'open' },
  BIDIRECTIONAL_SOLID: { lineStyle: 'solid', arrowHead: 'filled', bidirectional: true },
  BIDIRECTIONAL_DOTTED: { lineStyle: 'dashed', arrowHead: 'filled', bidirectional: true },
}

/** Mermaid's half arrows (`-|\`, `/|-` and the like): a whole head of the same kind, at the end it points to. */
const HALF_ARROW = /^(SOLID|STICK)(?:_ARROW)?_(?:TOP|BOTTOM)(_REVERSE)?(_DOTTED)?$/

const BLOCK_STARTS: Record<string, Block['type']> = {
  LOOP_START: 'loop', ALT_START: 'alt', OPT_START: 'opt', PAR_START: 'par', PAR_OVER_START: 'par',
  CRITICAL_START: 'critical', BREAK_START: 'break', RECT_START: 'rect',
}
const BLOCK_DIVIDERS = new Set(['ALT_ELSE', 'PAR_AND', 'CRITICAL_OPTION'])
const BLOCK_ENDS = new Set(['LOOP_END', 'ALT_END', 'OPT_END', 'PAR_END', 'CRITICAL_END', 'BREAK_END', 'RECT_END'])

/** A Mermaid sequence database as the sequence layout reads it. */
export function mermaidSequence(db: MermaidSequenceDb): SequenceDiagram {
  const names = new Map(Object.entries(db.LINETYPE).map(([name, code]) => [code, name]))
  const placements = new Map(Object.entries(db.PLACEMENT).map(([name, code]) => [code, name]))
  const actors: Actor[] = [...db.getActors()].map(([id, actor]) => ({
    id,
    label: mermaidLabel(actor.description ?? actor.name),
    type: ACTOR_TYPES.has(actor.type ?? '') ? (actor.type as ActorType) : 'participant',
  }))
  const created = new Map([...(db.getCreatedActors?.() ?? [])].map(([id, at]) => [at, id]))
  const destroyed = new Map([...(db.getDestroyedActors?.() ?? [])].map(([id, at]) => [at, id]))

  const timeline: SequenceEvent[] = []
  const messages: Message[] = []
  // Mermaid numbers every message from 1, shown while `autonumber` is on.
  let numbering = { shown: db.showSequenceNumbers?.() ?? false, next: 1, step: 1 }
  db.getMessages().forEach((msg, at) => {
    const name = names.get(msg.type) ?? ''
    const text = typeof msg.message === 'string' ? mermaidLabel(msg.message) : ''
    if (name === 'AUTONUMBER') {
      const setting = typeof msg.message === 'object' ? msg.message : {}
      numbering = { shown: setting.visible ?? true, next: setting.start ?? numbering.next, step: setting.step ?? numbering.step }
      return
    }
    if (name === 'NOTE') {
      const position = placements.get(msg.placement ?? -1) === 'LEFTOF' ? 'left' : placements.get(msg.placement ?? -1) === 'RIGHTOF' ? 'right' : 'over'
      const actorIds = position === 'over' && msg.to && msg.to !== msg.from ? [msg.from!, msg.to] : [msg.from!]
      timeline.push({ kind: 'note', note: { actorIds, text, position } })
      return
    }
    if (name === 'ACTIVE_START' || name === 'ACTIVE_END') {
      if (msg.from) timeline.push({ kind: name === 'ACTIVE_START' ? 'activate' : 'deactivate', actorId: msg.from })
      return
    }
    const block = BLOCK_STARTS[name]
    if (block) {
      // A rect's "label" is its colour.
      timeline.push(block === 'rect' ? { kind: 'block-start', type: 'rect', label: '', fill: typeof msg.message === 'string' ? msg.message.trim() : undefined } : { kind: 'block-start', type: block, label: text })
      return
    }
    if (BLOCK_DIVIDERS.has(name)) return void timeline.push({ kind: 'block-divider', label: text })
    if (BLOCK_ENDS.has(name)) return void timeline.push({ kind: 'block-end' })

    const half = HALF_ARROW.exec(name)
    const arrow = ARROWS[name] ?? (half ? { lineStyle: half[3] ? 'dashed' : 'solid', arrowHead: half[1] === 'SOLID' ? 'filled' : 'open' } as const : undefined)
    if (!arrow || !msg.from || !msg.to) return
    const [from, to] = half?.[2] ? [msg.to, msg.from] : [msg.from, msg.to]
    const message: Message = { from, to, label: text, ...arrow }
    messages.push(message)
    const number = numbering.shown ? { number: numbering.next } : {}
    numbering.next += numbering.step
    const ends = destroyed.get(at)
    timeline.push({
      kind: 'message',
      message,
      ...number,
      ...(created.get(at) === to ? { creates: true } : {}),
      ...(ends ? { destroys: ends === to ? 'to' as const : 'from' as const } : {}),
    })
  })

  const boxes: SequenceBox[] = (db.getBoxes?.() ?? []).map((box) => ({
    label: mermaidLabel(box.name),
    actorIds: box.actorKeys,
    ...(box.fill && box.fill !== 'transparent' ? { fill: box.fill } : {}),
  }))
  return { actors, messages, blocks: [], notes: [], timeline, ...(boxes.length ? { boxes } : {}) }
}
