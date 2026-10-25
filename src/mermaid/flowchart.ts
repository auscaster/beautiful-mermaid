// ============================================================================
// Flowcharts as Mermaid's parser reads them, laid out as Mermaid lays them out.
// ============================================================================

import type { ArrowKind, Direction, EdgeStyle, NodeShape, Point, PositionedEdge, PositionedGraph, PositionedGroup, PositionedNode } from '../types.ts'
import { FONT_SIZES, FONT_WEIGHTS } from '../styles.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { estimateNodeSize, GROUP_HEADER_GAP, groupHeaderHeight } from '../node-size.ts'
import { layoutDagre, type DagreNodeInput } from '../dagre/layout.ts'
import { intersectShape } from '../dagre/intersect.ts'
import type { MermaidLayoutData } from './types.ts'
import { mermaidLabel, mermaidStyles, pixels } from './labels.ts'

/** Mermaid's shape names (flowchart and `@{ shape }`) as the renderer's. */
const SHAPES: Record<string, NodeShape> = {
  rect: 'rectangle', squareRect: 'rectangle', square: 'rectangle', process: 'rectangle', proc: 'rectangle',
  roundedRect: 'rounded', rounded: 'rounded', event: 'rounded',
  stadium: 'stadium', pill: 'stadium', terminal: 'stadium',
  subroutine: 'subroutine', subproc: 'subroutine', 'framed-rectangle': 'subroutine',
  cylinder: 'cylinder', cyl: 'cylinder', db: 'cylinder', database: 'cylinder',
  circle: 'circle', circ: 'circle', doublecircle: 'doublecircle', 'dbl-circ': 'doublecircle',
  diamond: 'diamond', question: 'diamond', decision: 'diamond', diam: 'diamond',
  hexagon: 'hexagon', hex: 'hexagon', prepare: 'hexagon',
  odd: 'asymmetric', asymmetric: 'asymmetric',
  lean_right: 'lean-right', 'lean-r': 'lean-right', 'in-out': 'lean-right',
  lean_left: 'lean-left', 'lean-l': 'lean-left', 'out-in': 'lean-left',
  trapezoid: 'trapezoid', 'trap-b': 'trapezoid', priority: 'trapezoid',
  inv_trapezoid: 'trapezoid-alt', 'trap-t': 'trapezoid-alt', manual: 'trapezoid-alt',
  doc: 'document', document: 'document',
}

const ARROWS: Record<string, ArrowKind> = { arrow_point: 'arrow', arrow_circle: 'circle', arrow_cross: 'cross', arrow_barb: 'arrow' }

const EDGE_LABEL_PADDING = { x: 8, y: 6 }

export interface FlowchartLayoutOptions {
  padding: number
  nodeSpacing: number
  rankSpacing: number
}

export function layoutMermaidFlowchart(data: MermaidLayoutData, options: FlowchartLayoutOptions): PositionedGraph {
  const direction = directionOf(data.direction)
  const nodes = new Map<string, PositionedNode>()
  const groups = new Map<string, { label: string; inlineStyle?: Record<string, string>; parentId?: string }>()
  const dagreNodes: DagreNodeInput[] = []

  for (const node of data.nodes) {
    const label = mermaidLabel(node.label, node.labelType)
    const inlineStyle = mermaidStyles(node.cssCompiledStyles, node.cssStyles)
    if (node.isGroup) {
      groups.set(node.id, { label, inlineStyle, parentId: node.parentId })
      const header = groupHeaderHeight(label)
      dagreNodes.push({ id: node.id, parentId: node.parentId, isGroup: true, dir: node.dir ? directionOf(node.dir) : undefined, ...(header ? { titleHeight: header + GROUP_HEADER_GAP } : {}), width: 0, height: 0 })
      continue
    }
    const shape = SHAPES[node.shape ?? ''] ?? 'rectangle'
    const size = estimateNodeSize(label, shape, pixels(inlineStyle?.['font-size']))
    nodes.set(node.id, { id: node.id, label, shape, x: 0, y: 0, width: size.width, height: size.height, inlineStyle })
    dagreNodes.push({ id: node.id, parentId: node.parentId, isGroup: false, width: size.width, height: size.height })
  }

  const edgeInputs = data.edges.map((edge) => {
    const label = mermaidLabel(edge.label, edge.labelType)
    const metrics = label ? measureMultilineText(label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel) : undefined
    return { edge, label, metrics }
  })

  const shapeOf = (id: string): NodeShape => nodes.get(id)?.shape ?? 'rectangle'
  const laid = layoutDagre(
    {
      direction,
      nodes: dagreNodes,
      edges: edgeInputs.map(({ edge, metrics }) => ({
        id: edge.id,
        source: edge.start,
        target: edge.end,
        minlen: edge.minlen ?? 1,
        ...(metrics ? { labelWidth: metrics.width + EDGE_LABEL_PADDING.x * 2, labelHeight: metrics.height + EDGE_LABEL_PADDING.y * 2 } : {}),
      })),
      nodeSpacing: options.nodeSpacing,
      rankSpacing: options.rankSpacing,
    },
    (box, toward) => intersectShape(shapeOf(box.id), box, toward),
  )

  const positionedNodes: PositionedNode[] = []
  for (const [id, node] of nodes) {
    const box = laid.nodes.get(id)
    if (!box) continue
    positionedNodes.push({ ...node, x: box.x - box.width / 2, y: box.y - box.height / 2, width: box.width, height: box.height })
  }

  const byId = new Map(edgeInputs.map((input) => [input.edge.id, input]))
  const positionedEdges: PositionedEdge[] = []
  for (const laidEdge of laid.edges) {
    const input = byId.get(laidEdge.id)
    if (!input) continue
    const { edge, label } = input
    const style = edgeStyle(edge.pattern ?? edge.thickness)
    if (style === 'invisible') continue
    const arrowStart = ARROWS[edge.arrowTypeStart ?? '']
    const arrowEnd = ARROWS[edge.arrowTypeEnd ?? '']
    positionedEdges.push({
      source: laidEdge.source,
      target: laidEdge.target,
      ...(label ? { label, labelPosition: laidEdge.label } : {}),
      style,
      hasArrowStart: Boolean(arrowStart),
      hasArrowEnd: Boolean(arrowEnd),
      ...(arrowStart && arrowStart !== 'arrow' ? { arrowStartKind: arrowStart } : {}),
      ...(arrowEnd && arrowEnd !== 'arrow' ? { arrowEndKind: arrowEnd } : {}),
      points: laidEdge.points,
      inlineStyle: mermaidStyles(edge.style?.filter((declaration) => !/^\s*fill\s*:/.test(declaration))),
      curved: true,
    })
  }

  const positionedGroups = groupTree(groups, laid.clusters)
  return framed({ width: laid.width, height: laid.height, nodes: positionedNodes, edges: positionedEdges, groups: positionedGroups }, options.padding)
}

function directionOf(value: string | undefined): Direction {
  const upper = (value ?? 'TB').toUpperCase()
  return (['TB', 'TD', 'BT', 'LR', 'RL'].includes(upper) ? (upper === 'TD' ? 'TB' : upper) : 'TB') as Direction
}

function edgeStyle(pattern: string | undefined): EdgeStyle {
  if (pattern === 'dotted') return 'dotted'
  if (pattern === 'thick') return 'thick'
  if (pattern === 'invisible') return 'invisible'
  return 'solid'
}

/** Subgraphs as nested groups, each at least as wide as its title. */
function groupTree(
  groups: Map<string, { label: string; inlineStyle?: Record<string, string>; parentId?: string }>,
  boxes: Map<string, { x: number; y: number; width: number; height: number }>,
): PositionedGroup[] {
  const made = new Map<string, PositionedGroup>()
  for (const [id, group] of groups) {
    const box = boxes.get(id)
    if (!box) continue
    const title = measureMultilineText(group.label, FONT_SIZES.groupHeader, FONT_WEIGHTS.groupHeader).width + 24
    const width = Math.max(box.width, title)
    made.set(id, { id, label: group.label, x: box.x - width / 2, y: box.y - box.height / 2, width, height: box.height, children: [], ...(group.inlineStyle ? { inlineStyle: group.inlineStyle } : {}) })
  }
  const roots: PositionedGroup[] = []
  for (const [id, group] of groups) {
    const made_ = made.get(id)
    if (!made_) continue
    const parent = group.parentId ? made.get(group.parentId) : undefined
    if (parent) parent.children.push(made_)
    else roots.push(made_)
  }
  return roots
}

/** The drawing moved so its ink sits the same padding from every side of the canvas. */
function framed(graph: PositionedGraph, padding: number): PositionedGraph {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const take = (x: number, y: number, w = 0, h = 0) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h) }
  for (const node of graph.nodes) take(node.x, node.y, node.width, node.height)
  const walk = (groups: PositionedGroup[]) => { for (const group of groups) { take(group.x, group.y, group.width, group.height); walk(group.children) } }
  walk(graph.groups)
  for (const edge of graph.edges) {
    for (const point of edge.points) take(point.x, point.y)
    if (edge.label && edge.labelPosition) {
      const metrics = measureMultilineText(edge.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)
      take(edge.labelPosition.x - metrics.width / 2 - EDGE_LABEL_PADDING.x, edge.labelPosition.y - metrics.height / 2 - EDGE_LABEL_PADDING.y, metrics.width + EDGE_LABEL_PADDING.x * 2, metrics.height + EDGE_LABEL_PADDING.y * 2)
    }
  }
  if (!Number.isFinite(x0)) return { ...graph, width: padding * 2, height: padding * 2 }
  const dx = padding - x0, dy = padding - y0
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy })
  const moveGroups = (groups: PositionedGroup[]): PositionedGroup[] => groups.map((group) => ({ ...group, x: group.x + dx, y: group.y + dy, children: moveGroups(group.children) }))
  return {
    width: x1 - x0 + padding * 2,
    height: y1 - y0 + padding * 2,
    nodes: graph.nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })),
    edges: graph.edges.map((edge) => ({ ...edge, points: edge.points.map(move), ...(edge.labelPosition ? { labelPosition: move(edge.labelPosition) } : {}) })),
    groups: moveGroups(graph.groups),
  }
}
