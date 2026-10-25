/**
 * Flowcharts as Mermaid's parser reads them (`db.getData()`), laid out as
 * Mermaid lays them out. The inputs are written the way Mermaid 11 hands them
 * over, so these run without Mermaid.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidDiagram } from '../index.ts'
import { layoutMermaidGraph } from '../mermaid/graph.ts'
import type { MermaidLayoutData, MermaidLayoutNode } from '../mermaid/types.ts'
import type { PositionedGroup } from '../types.ts'

const node = (id: string, label: string, extra: Partial<MermaidLayoutNode> = {}): MermaidLayoutNode => ({ id, label, labelType: 'text', shape: 'squareRect', ...extra })
const group = (id: string, label: string, extra: Partial<MermaidLayoutNode> = {}): MermaidLayoutNode => ({ id, label, labelType: 'string', shape: 'rect', isGroup: true, ...extra })
const edge = (start: string, end: string, extra: Record<string, unknown> = {}) => ({ id: `L_${start}_${end}_0`, start, end, type: 'arrow_point', pattern: 'normal', arrowTypeStart: 'none', arrowTypeEnd: 'arrow_point', minlen: 1, ...extra })
const options = { padding: 16, nodeSpacing: 40, rankSpacing: 40 }
const flatten = (groups: PositionedGroup[]): PositionedGroup[] => groups.flatMap((g) => [g, ...flatten(g.children)])

describe('Mermaid flowcharts', () => {
  it('lays out a subgraph no edge crosses on its own, across the diagram, keeping the order its nodes were written in', () => {
    // Gauzy's platform diagram: layers linked subgraph to subgraph, each a stack of unlinked nodes.
    const data: MermaidLayoutData = {
      direction: 'TB',
      nodes: [group('Clients', 'Client Layer'), group('API', 'API Server'), node('FE', 'Frontend', { parentId: 'Clients' }), node('DE', 'Desktop', { parentId: 'Clients' }), node('AUTH', 'Auth Guards', { parentId: 'API' }), node('MOD', 'Modules', { parentId: 'API' }), node('PLUG', 'Plugin System', { parentId: 'API' })],
      edges: [edge('Clients', 'API')],
    }
    const graph = layoutMermaidGraph(data, 'flowchart', options)
    const at = (id: string) => graph.nodes.find((n) => n.id === id)!
    // Taken out of a top-to-bottom diagram, each layer is laid out left to right, so its unlinked nodes stack, in order.
    expect(at('FE').y).toBeLessThan(at('DE').y)
    expect(at('AUTH').y).toBeLessThan(at('MOD').y)
    expect(at('MOD').y).toBeLessThan(at('PLUG').y)
    expect(Math.abs(at('AUTH').x + at('AUTH').width / 2 - (at('PLUG').x + at('PLUG').width / 2))).toBeLessThan(1)
    // The edge between the layers runs from the bottom of one to the top of the other.
    const [link] = graph.edges
    const [clients, api] = ['Clients', 'API'].map((id) => graph.groups.find((g) => g.id === id)!)
    expect(link!.source).toBe('Clients')
    expect(link!.target).toBe('API')
    expect(link!.points[0]!.y).toBeCloseTo(clients!.y + clients!.height, 0)
    expect(link!.points.at(-1)!.y).toBeCloseTo(api!.y, 0)
  })

  it('keeps room under every titled subgraph for its header, and none under an untitled one', () => {
    const data: MermaidLayoutData = {
      direction: 'LR',
      nodes: [group('Outer', 'Outer'), group('Inner', 'Inner', { parentId: 'Outer' }), group('Bare', ' '), node('A', 'A', { parentId: 'Inner' }), node('B', 'B', { parentId: 'Outer' }), node('C', 'C', { parentId: 'Bare' })],
      edges: [edge('A', 'B'), edge('B', 'C')],
    }
    const graph = layoutMermaidGraph(data, 'flowchart', options)
    for (const g of flatten(graph.groups)) {
      const contents = [...graph.nodes.filter((n) => n.x >= g.x && n.x + n.width <= g.x + g.width && n.y >= g.y && n.y + n.height <= g.y + g.height), ...flatten(g.children)]
      const room = Math.min(...contents.map((item) => item.y)) - g.y
      expect(room).toBeGreaterThanOrEqual(g.label.trim() ? 40 : 0)
    }
  })

  it('takes the direction from the database when the layout data leaves it out, as a flowchart does', () => {
    const db = { getData: () => ({ nodes: [node('A', 'A'), node('B', 'B')], edges: [edge('A', 'B')] }), getDirection: () => 'LR' }
    const svg = renderMermaidDiagram({ type: 'flowchart-v2', db })
    const xs = [...svg.matchAll(/<g class="node" data-id="(A|B)"[^>]*>\s*<rect x="([\d.]+)"/g)].map((m) => Number(m[2]))
    expect(xs[0]).toBeLessThan(xs[1]!)
  })

  it('draws each end and line as Mermaid reads it, and leaves an invisible link out', () => {
    const data: MermaidLayoutData = {
      direction: 'TB',
      nodes: [node('A', 'A'), node('B', 'B'), node('C', 'C'), node('D', 'D'), node('E', 'E')],
      edges: [
        edge('A', 'B', { pattern: 'dotted' }),
        edge('A', 'C', { arrowTypeEnd: 'arrow_circle', arrowTypeStart: 'arrow_circle' }),
        edge('A', 'D', { arrowTypeEnd: 'arrow_cross', pattern: 'thick' }),
        edge('A', 'E', { pattern: 'invisible', arrowTypeEnd: 'none' }),
      ],
    }
    const svg = renderMermaidDiagram({ type: 'flowchart-v2', db: { getData: () => data } })
    expect(svg).toContain('data-to="B" data-style="dotted"')
    expect(svg).toMatch(/data-to="C"[^>]*marker-end="url\(#circle-end\)" marker-start="url\(#circle-start\)"/)
    expect(svg).toMatch(/data-to="D" data-style="thick"[^>]*marker-end="url\(#cross-end\)"/)
    expect(svg).not.toContain('data-to="E"')
    // E is still placed, as Mermaid places a node an invisible link holds.
    expect(svg).toContain('data-id="E"')
  })

  it('keeps an author\'s styles and reads labels as Mermaid hands them over', () => {
    const data: MermaidLayoutData = {
      nodes: [
        node('A', '**Node Level**<br>Contribution: 65%', { labelType: 'string', cssCompiledStyles: ['fill:#ffeb3b', 'stroke:#000', 'color:#2c3e50', 'font-size:14px'], cssStyles: ['stroke:#f00'] }),
        node('B', 'Tom &amp; Jerry', { shape: 'cylinder' }),
      ],
      edges: [edge('A', 'B', { label: 'reads', labelType: 'text', style: ['stroke:#09f', 'stroke-width:2px', 'fill:none'] })],
    }
    const graph = layoutMermaidGraph(data, 'flowchart', options)
    const [a, b] = graph.nodes
    expect(a!.label).toBe('<b>Node Level</b>\nContribution: 65%')
    expect(a!.inlineStyle).toEqual({ fill: '#ffeb3b', stroke: '#f00', color: '#2c3e50', 'font-size': '14px' })
    expect(b!.label).toBe('Tom & Jerry')
    expect(b!.shape).toBe('cylinder')
    expect(graph.edges[0]!.inlineStyle).toEqual({ stroke: '#09f', 'stroke-width': '2px' })
  })

  it('frames the drawing with the same margin on every side', () => {
    const graph = layoutMermaidGraph({ nodes: [group('G', 'Group'), node('A', 'A', { parentId: 'G' }), node('B', 'Wide label here')], edges: [edge('A', 'B', { label: 'to' })] }, 'flowchart', options)
    const boxes = [...graph.nodes, ...flatten(graph.groups)]
    expect(Math.min(...boxes.map((b) => b.x))).toBeCloseTo(16, 5)
    expect(Math.min(...boxes.map((b) => b.y))).toBeCloseTo(16, 5)
    expect(graph.width - Math.max(...boxes.map((b) => b.x + b.width))).toBeGreaterThanOrEqual(16 - 1e-9)
    expect(graph.height - Math.max(...boxes.map((b) => b.y + b.height))).toBeGreaterThanOrEqual(16 - 1e-9)
  })
})
