// ============================================================================
// Sequence diagram types
//
// Models the parsed and positioned representations of a Mermaid sequence diagram.
// Sequence diagrams show actor interactions over time (vertical timeline).
// ============================================================================

/** Parsed sequence diagram — logical structure from mermaid text */
export interface SequenceDiagram {
  /** Ordered list of actors/participants */
  actors: Actor[]
  /** Messages between actors in chronological order */
  messages: Message[]
  /** Structural blocks (loop, alt, opt, par, critical) */
  blocks: Block[]
  /** Notes attached to actors */
  notes: Note[]
  /**
   * Everything in the order it happens, as Mermaid's parser reports it: messages, notes,
   * blocks opening, dividing and closing, and lifelines activating. Laid out from this when
   * present; derived from the lists above otherwise.
   */
  timeline?: SequenceEvent[]
  /** Number each message (`autonumber`) */
  autonumber?: boolean
  /** Boxes grouping participants (`box Label ... end`) */
  boxes?: SequenceBox[]
}

export type SequenceEvent =
  | {
      kind: 'message'
      message: Message
      /** The number shown beside it, when messages are numbered here (autonumber) */
      number?: number
      /** This message creates its target, which appears where it arrives (`create participant`) */
      creates?: boolean
      /** This message is the last for one of its ends, which ends here (`destroy`) */
      destroys?: 'from' | 'to'
    }
  | { kind: 'note'; note: Omit<Note, 'afterIndex'> }
  | { kind: 'block-start'; type: Block['type']; label: string; fill?: string }
  | { kind: 'block-divider'; label: string }
  | { kind: 'block-end' }
  | { kind: 'activate'; actorId: string }
  | { kind: 'deactivate'; actorId: string }

export interface SequenceBox {
  label: string
  actorIds: string[]
  /** The author's colour for the box */
  fill?: string
}

export interface Actor {
  id: string
  label: string
  /** 'participant' renders as a box, 'actor' renders as a stick figure; the rest as Mermaid's symbols */
  type: ActorType
}

export type ActorType = 'participant' | 'actor' | 'boundary' | 'control' | 'entity' | 'database' | 'collections' | 'queue'

export interface Message {
  from: string
  to: string
  label: string
  /** Arrow style: solid line or dashed line */
  lineStyle: 'solid' | 'dashed'
  /** Arrow head: filled (`->>`), open (`-)`), none (`->`) or a cross (`-x`) */
  arrowHead: 'filled' | 'open' | 'none' | 'cross'
  /** Arrow heads at both ends (`<<->>`) */
  bidirectional?: boolean
  /** Activate the target lifeline (+) */
  activate?: boolean
  /** Deactivate the source lifeline (-) */
  deactivate?: boolean
}

export interface Block {
  /** Block type keyword */
  type: 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect'
  /** Label for the block header */
  label: string
  /** Index of the first message inside this block */
  startIndex: number
  /** Index of the last message inside this block (inclusive) */
  endIndex: number
  /** For alt/par blocks: indices where "else"/"and" dividers appear (message indices) */
  dividers: Array<{ index: number; label: string }>
}

export interface Note {
  /** Which actor(s) the note is attached to */
  actorIds: string[]
  /** Note text content */
  text: string
  /** Position relative to the actor(s) */
  position: 'left' | 'right' | 'over'
  /** Message index after which this note appears */
  afterIndex: number
}

// ============================================================================
// Positioned sequence diagram — ready for SVG rendering
// ============================================================================

export interface PositionedSequenceDiagram {
  width: number
  height: number
  actors: PositionedActor[]
  lifelines: Lifeline[]
  messages: PositionedMessage[]
  activations: Activation[]
  blocks: PositionedBlock[]
  notes: PositionedNote[]
  /** The actors again below the lifelines, as Mermaid repeats them (mirrorActors) */
  footerActors?: PositionedActor[]
  /** Boxes grouping participants, drawn behind them */
  boxes?: Array<{ label: string; x: number; y: number; width: number; height: number; fill?: string }>
}

export interface PositionedActor {
  id: string
  label: string
  type: ActorType
  /** Center x of the actor box */
  x: number
  /** Top y of the actor box */
  y: number
  width: number
  height: number
}

/** Vertical dashed line from actor to bottom of diagram */
export interface Lifeline {
  actorId: string
  x: number
  topY: number
  bottomY: number
}

export interface PositionedMessage {
  from: string
  to: string
  label: string
  lineStyle: 'solid' | 'dashed'
  arrowHead: Message['arrowHead']
  /** Arrow heads at both ends */
  bidirectional?: boolean
  /** The message's number, when the diagram numbers them (autonumber) */
  number?: number
  /** Start point (from actor's lifeline) */
  x1: number
  /** End point (to actor's lifeline) */
  x2: number
  /** Vertical position */
  y: number
  /** Whether this is a self-message (same actor) */
  isSelf: boolean
}

/** Narrow rectangle on a lifeline showing active processing */
export interface Activation {
  actorId: string
  x: number
  topY: number
  bottomY: number
  width: number
}

export interface PositionedBlock {
  type: Block['type']
  label: string
  /** A `rect` block's colour */
  fill?: string
  x: number
  y: number
  width: number
  height: number
  /** Divider lines within the block (for alt/par) */
  dividers: Array<{ y: number; label: string }>
}

export interface PositionedNote {
  text: string
  x: number
  y: number
  width: number
  height: number
  /** Actor IDs this note is attached to (for SVG attribution) */
  actors?: string[]
  /** Note position relative to actors (for SVG attribution) */
  position?: 'left' | 'right' | 'over'
}
