/**
 * State, class, sequence and ER diagrams as Mermaid's parser reads them,
 * written the way Mermaid 11 hands them over, so these run without Mermaid.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidDiagram } from '../index.ts'
import { layoutMermaidGraph } from '../mermaid/graph.ts'
import { layoutMermaidClass } from '../mermaid/class.ts'
import { layoutMermaidEr } from '../mermaid/er.ts'
import { mermaidSequence, type MermaidSequenceDb } from '../mermaid/sequence.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import type { MermaidLayoutData } from '../mermaid/types.ts'

const options = { padding: 16, nodeSpacing: 40, rankSpacing: 40 }
const transition = (start: string, end: string, extra: Record<string, unknown> = {}) => ({ id: `${start}-${end}`, start, end, arrowTypeEnd: 'arrow_barb', style: 'fill:none', classes: 'transition', ...extra })

describe('Mermaid state diagrams', () => {
  it('shows a state by its description, its further descriptions under a divider, and no label on its marks', () => {
    const data: MermaidLayoutData = {
      direction: 'TB',
      nodes: [
        { id: 'root_start', label: 'root_start', shape: 'stateStart', labelType: 'markdown' },
        { id: 'CLOSED', label: 'Normal operation', shape: 'rectWithTitle', labelType: 'markdown', description: ['All requests go through'] },
        { id: 'fork1', label: 'fork1', shape: 'fork' },
        { id: 'c1', label: 'c1', shape: 'choice' },
      ],
      edges: [transition('root_start', 'CLOSED'), transition('CLOSED', 'fork1', { label: '5 failures', labelType: 'markdown' }), transition('fork1', 'c1')],
    }
    const graph = layoutMermaidGraph(data, 'state', options)
    const at = (id: string) => graph.nodes.find((n) => n.id === id)!
    expect(at('CLOSED')).toMatchObject({ label: 'Normal operation', description: 'All requests go through', shape: 'rounded' })
    expect(at('root_start')).toMatchObject({ label: '', shape: 'state-start' })
    expect(at('fork1')).toMatchObject({ label: '', shape: 'state-bar', width: 70, height: 8 })
    expect(at('c1')).toMatchObject({ label: '', shape: 'state-choice' })
    const svg = renderMermaidDiagram({ type: 'stateDiagram', db: { getData: () => data } })
    expect(svg).toContain('Normal operation')
    expect(svg).toContain('All requests go through')
    expect(svg).not.toContain('>root_start<')
    expect(svg).not.toContain('>CLOSED<')
  })

  it('hangs a note from its state on a dotted line with no arrowhead, and draws a concurrent region as a dashed box', () => {
    const data: MermaidLayoutData = {
      direction: 'TB',
      nodes: [
        { id: 'Comp', label: 'Comp', shape: 'roundedWithTitle', isGroup: true },
        { id: 'region', shape: 'divider', isGroup: true, parentId: 'Comp' },
        { id: 'X', label: 'X', shape: 'rect', parentId: 'region' },
        { id: 'D', label: 'D', shape: 'rect' },
        { id: 'D----parent', label: 'a note', shape: 'noteGroup', isGroup: true },
        { id: 'D----note-1', label: 'a note', shape: 'note', parentId: 'D----parent' },
      ],
      edges: [transition('D', 'Comp'), { id: 'D-D----note-1', start: 'D', end: 'D----note-1', style: 'fill:none', classes: 'transition note-edge' }],
    }
    const svg = renderMermaidDiagram({ type: 'stateDiagram', db: { getData: () => data } })
    expect(svg).toMatch(/data-to="D----note-1" data-style="dotted" data-arrow-start="false" data-arrow-end="false"/)
    expect(svg).toContain('data-shape="note"')
    expect(svg).toMatch(/class="subgraph region"[^]*stroke-dasharray="4 4"/)
    // The box holding the note beside its state is not drawn.
    expect(svg).not.toContain('data-id="D----parent"')
  })
})

describe('Mermaid class diagrams', () => {
  it('reads members as written, relationships by their ends, and cardinalities at each end', () => {
    const data = {
      direction: 'TB',
      nodes: [
        { id: 'Animal', label: 'Animal', shape: 'classBox', annotations: ['abstract'], members: [{ memberType: 'attribute', visibility: '+', text: '\\+id: UUID' }, { memberType: 'attribute', visibility: '-', classifier: '$', text: '\\-int age' }], methods: [{ memberType: 'method', visibility: '+', classifier: '*', id: 'move', parameters: 'int distance', returnType: 'bool' }] },
        { id: 'Duck', label: 'Duck', shape: 'classBox' },
        { id: 'Egg', label: 'Egg', shape: 'classBox' },
        { id: 'Zoo', label: 'Zoo', shape: 'classBox' },
      ],
      edges: [
        { id: 'e1', start: 'Animal', end: 'Duck', arrowTypeStart: 'extension', arrowTypeEnd: 'none', pattern: 'solid' },
        { id: 'e2', start: 'Duck', end: 'Egg', arrowTypeStart: 'composition', arrowTypeEnd: 'none', pattern: 'solid', label: 'lays', startLabelRight: '1', endLabelLeft: 'many' },
        { id: 'e3', start: 'Duck', end: 'Zoo', arrowTypeStart: 'none', arrowTypeEnd: 'none', pattern: 'dotted' },
      ],
    } as unknown as MermaidLayoutData
    const diagram = layoutMermaidClass(data, options)
    const animal = diagram.classes.find((c) => c.id === 'Animal')!
    expect(animal.annotation).toBe('abstract')
    expect(animal.attributes).toEqual([{ visibility: '+', name: 'id', type: 'UUID' }, { visibility: '-', name: 'int age', isStatic: true }])
    expect(animal.methods).toEqual([{ visibility: '+', name: 'move', isMethod: true, params: 'int distance', type: 'bool', isAbstract: true }])
    const [inherit, lays, link] = diagram.relationships
    expect(inherit).toMatchObject({ type: 'inheritance', markerAt: 'from' })
    expect(lays).toMatchObject({ type: 'composition', label: 'lays', fromCardinality: '1', toCardinality: 'many' })
    expect(link).toMatchObject({ type: 'link', dashed: true })
  })
})

describe('Mermaid sequence diagrams', () => {
  // Mermaid 11's codes, as its sequence database hands them over.
  const LINETYPE = { SOLID: 0, DOTTED: 1, NOTE: 2, SOLID_CROSS: 3, SOLID_OPEN: 5, ALT_START: 12, ALT_ELSE: 13, ALT_END: 14, ACTIVE_START: 17, ACTIVE_END: 18, RECT_START: 22, RECT_END: 23, SOLID_POINT: 24, AUTONUMBER: 26, BIDIRECTIONAL_DOTTED: 34 }
  const PLACEMENT = { LEFTOF: 0, RIGHTOF: 1, OVER: 2 }
  const db = (messages: object[], extra: object = {}) => ({
    LINETYPE,
    PLACEMENT,
    getActors: () => new Map([
      ['U', { name: 'U', description: 'User<br/>person', type: 'actor' }],
      ['W', { name: 'W', description: 'Web', type: 'participant' }],
      ['D', { name: 'D', description: 'Store', type: 'database' }],
    ]),
    getMessages: () => messages,
    getBoxes: () => [{ name: 'Front end', fill: 'transparent', actorKeys: ['U', 'W'] }],
    ...extra,
  })

  it('reads messages, notes, blocks and activations in the order Mermaid records them', () => {
    const diagram = mermaidSequence(db([
      { type: 26, message: { start: 10, step: 5, visible: true } },
      { type: 0, from: 'U', to: 'W', message: 'Open ﬂ°quot¶ßhomeﬂ°quot¶ß' },
      { type: 17, from: 'W' },
      { type: 12, message: 'cached' },
      { type: 34, from: 'W', to: 'D', message: 'sync' },
      { type: 13, message: 'cold' },
      { type: 3, from: 'W', to: 'D', message: 'lost' },
      { type: 14 },
      { type: 2, from: 'U', to: 'W', placement: 2, message: 'a note' },
      { type: 22, message: 'rgb(200, 220, 255)' },
      { type: 24, from: 'W', to: 'U', message: 'done' },
      { type: 23 },
      { type: 18, from: 'W' },
    ]) as unknown as MermaidSequenceDb)

    expect(diagram.actors).toEqual([
      { id: 'U', label: 'User\nperson', type: 'actor' },
      { id: 'W', label: 'Web', type: 'participant' },
      { id: 'D', label: 'Store', type: 'database' },
    ])
    expect(diagram.boxes).toEqual([{ label: 'Front end', actorIds: ['U', 'W'] }])
    expect(diagram.timeline!.map((event) => event.kind === 'message' ? `${event.message.label} ${event.number} ${event.message.lineStyle} ${event.message.arrowHead}${event.message.bidirectional ? ' both' : ''}` : event.kind)).toEqual([
      'Open "home" 10 solid filled', 'activate', 'block-start', 'sync 15 dashed filled both', 'block-divider', 'lost 20 solid cross', 'block-end', 'note', 'block-start', 'done 25 solid open', 'block-end', 'deactivate',
    ])
    expect(diagram.timeline![7]).toEqual({ kind: 'note', note: { actorIds: ['U', 'W'], text: 'a note', position: 'over' } })
    expect(diagram.timeline![8]).toEqual({ kind: 'block-start', type: 'rect', label: '', fill: 'rgb(200, 220, 255)' })
  })

  it('draws an actor a message creates where that message arrives, and ends one at the message that destroys it', () => {
    const parsed = db([
      { type: 0, from: 'U', to: 'W', message: 'hello' },
      { type: 0, from: 'W', to: 'D', message: 'create' },
      { type: 0, from: 'W', to: 'D', message: 'drop' },
    ], { getCreatedActors: () => new Map([['D', 1]]), getDestroyedActors: () => new Map([['D', 2]]) }) as unknown as MermaidSequenceDb
    const positioned = layoutSequenceDiagram(mermaidSequence(parsed))
    const head = positioned.actors.find((actor) => actor.id === 'D')!
    const foot = positioned.footerActors!.find((actor) => actor.id === 'D')!
    const [, create, drop] = positioned.messages
    expect(head.y + head.height / 2).toBeCloseTo(create!.y)
    expect(foot.y + foot.height / 2).toBeCloseTo(drop!.y)
    // Each arrow stops at the box's side, not its lifeline.
    expect(create!.x2).toBeCloseTo(head.x - head.width / 2)
    const lifeline = positioned.lifelines.find((line) => line.actorId === 'D')!
    expect(lifeline.topY).toBeCloseTo(head.y + head.height)
    expect(lifeline.bottomY).toBeCloseTo(foot.y)
    const svg = renderMermaidDiagram({ type: 'sequence', db: parsed })
    expect(svg).toContain('data-type="database"')
    expect(svg).toContain('class="box" data-label="Front end"')
  })
})

describe('Mermaid ER diagrams', () => {
  it('tabulates every attribute with its keys and comment, draws an attribute-less entity as its header, and reads both cardinalities', () => {
    const data = {
      direction: 'TB',
      nodes: [
        { id: 'entity-A-0', label: 'Workflow', shape: 'erBox', attributes: [{ type: 'UUID', name: 'id', keys: ['PK'] }, { type: 'string', name: 'status', comment: 'indexed: queued, done' }] },
        { id: 'entity-B-1', label: 'Tenant', shape: 'erBox', attributes: [] },
      ],
      edges: [{ id: 'r1', start: 'entity-A-0', end: 'entity-B-1', label: 'belongs to', labelType: 'markdown', arrowTypeStart: 'zero_or_more', arrowTypeEnd: 'only_one', pattern: 'solid' }],
    } as unknown as MermaidLayoutData
    const diagram = layoutMermaidEr(data, options)
    const [workflow, tenant] = diagram.entities
    expect(workflow!.attributes[1]).toEqual({ type: 'string', name: 'status', keys: [], comment: 'indexed: queued, done' })
    expect(workflow!.columns!.comment).toBeGreaterThan(0)
    expect(tenant!.height).toBe(tenant!.headerHeight)
    expect(diagram.relationships[0]).toMatchObject({ cardinality1: 'zero-many', cardinality2: 'one', label: 'belongs to', identifying: true })
    const svg = renderMermaidDiagram({ type: 'er', db: { getData: () => data } })
    expect(svg).toContain('indexed: queued, done')
    expect(svg).not.toContain('(no attributes)')
  })
})
