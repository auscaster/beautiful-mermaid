/**
 * State, class and ER diagrams as Mermaid's parser reads them (`db.getData()`),
 * written the way Mermaid 11 hands them over, so these run without Mermaid.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidDiagram } from '../index.ts'
import { layoutMermaidGraph } from '../mermaid/graph.ts'
import { layoutMermaidClass } from '../mermaid/class.ts'
import { layoutMermaidEr } from '../mermaid/er.ts'
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
