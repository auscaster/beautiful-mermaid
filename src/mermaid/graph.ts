// ============================================================================
// Flowcharts and state diagrams as Mermaid's parser reads them (`getData()`),
// laid out as Mermaid lays them out. The two share Mermaid's layout; they
// differ in the shapes their nodes take and how their edges end.
// ============================================================================

import type { ArrowKind, Direction, EdgeStyle, NodeShape, Point, PositionedEdge, PositionedGraph, PositionedGroup, PositionedNode } from '../types.ts'
import { FONT_SIZES, FONT_WEIGHTS } from '../styles.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { estimateNodeSize, GROUP_HEADER_GAP, groupHeaderHeight } from '../node-size.ts'
import { layoutDagre, type DagreNodeInput } from '../dagre/layout.ts'
import { intersectShape } from '../dagre/intersect.ts'
import type { MermaidLayoutData } from './types.ts'
import { mermaidLabel, mermaidStyles, pixels } from './labels.ts'
import { Ink, moveGroups, movePoint } from './frame.ts'

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

/** Mermaid's state shapes as the renderer's; a state is a rounded box. */
const STATE_SHAPES: Record<string, NodeShape> = {
  stateStart: 'state-start', stateEnd: 'state-end', rect: 'rounded', rectWithTitle: 'rounded',
  choice: 'state-choice', fork: 'state-bar', join: 'state-bar', note: 'note',
}

/** State shapes that are a mark: Mermaid names them (`root_start`, `fork1`) but shows no label. */
const STATE_MARKS: ReadonlySet<string> = new Set(['stateStart', 'stateEnd', 'choice', 'fork', 'join'])

const ARROWS: Record<string, ArrowKind> = { arrow_point: 'arrow', arrow_circle: 'circle', arrow_cross: 'cross', arrow_barb: 'arrow' }

const EDGE_LABEL_PADDING = { x: 8, y: 6 }

export interface GraphLayoutOptions {
  padding: number
  nodeSpacing: number
  rankSpacing: number
}

export type GroupInput = { label: string; inlineStyle?: Record<string, string>; parentId?: string; variant?: PositionedGroup['variant'] }

export function layoutMermaidGraph(data: MermaidLayoutData, kind: 'flowchart' | 'state', options: GraphLayoutOptions): PositionedGraph {
  const direction = directionOf(data.direction)
  const nodes = new Map<string, PositionedNode>()
  const groups = new Map<string, GroupInput>()
  const dagreNodes: DagreNodeInput[] = []

  for (const node of data.nodes) {
    const inlineStyle = mermaidStyles(node.cssCompiledStyles, node.cssStyles)
    if (node.isGroup) {
      // A state's concurrent regions and the box holding a note beside its state are untitled.
      const variant = kind === 'state' ? (node.shape === 'divider' ? 'region' : node.shape === 'noteGroup' ? 'hidden' : undefined) : undefined
      const label = variant ? '' : mermaidLabel(node.label, node.labelType)
      groups.set(node.id, { label, inlineStyle, parentId: node.parentId, ...(variant ? { variant } : {}) })
      const header = groupHeaderHeight(label)
      dagreNodes.push({ id: node.id, parentId: node.parentId, isGroup: true, dir: node.dir ? directionOf(node.dir) : undefined, ...(header ? { titleHeight: header + GROUP_HEADER_GAP } : {}), width: 0, height: 0 })
      continue
    }
    const shape = (kind === 'state' ? STATE_SHAPES[node.shape ?? ''] ?? 'rounded' : SHAPES[node.shape ?? '']) ?? 'rectangle'
    const label = kind === 'state' && STATE_MARKS.has(node.shape ?? '') ? '' : mermaidLabel(node.label, node.labelType)
    const description = node.description?.length ? node.description.map((line) => mermaidLabel(line, node.labelType)).join('\n') : undefined
    const size = shape === 'state-bar' ? (direction === 'LR' || direction === 'RL' ? { width: 8, height: 70 } : { width: 70, height: 8 }) : estimateNodeSize(label, shape, pixels(inlineStyle?.['font-size']), description)
    nodes.set(node.id, { id: node.id, label, shape, x: 0, y: 0, width: size.width, height: size.height, inlineStyle, ...(description ? { description } : {}) })
    dagreNodes.push({ id: node.id, parentId: node.parentId, isGroup: false, width: size.width, height: size.height })
  }

  const edgeInputs = data.edges.map((edge) => {
    const label = mermaidLabel(edge.label, edge.labelType)
    const metrics = label ? measureMultilineText(label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel) : undefined
    // A note hangs from its state on a dotted line with no arrowhead.
    const note = kind === 'state' && /\bnote-edge\b/.test(edge.classes ?? '')
    return { edge, label, metrics, note }
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
    const { edge, label, note } = input
    const style = note ? 'dotted' : edgeStyle(edge.pattern ?? edge.thickness)
    if (style === 'invisible') continue
    const arrowStart = note ? undefined : ARROWS[edge.arrowTypeStart ?? '']
    const arrowEnd = note ? undefined : ARROWS[edge.arrowTypeEnd ?? '']
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
      // linkStyle's declarations; a state's edges carry only Mermaid's own `fill:none`.
      inlineStyle: Array.isArray(edge.style) ? mermaidStyles(edge.style.filter((declaration) => !/^\s*fill\s*:/.test(declaration))) : undefined,
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
export function groupTree(groups: Map<string, GroupInput>, boxes: Map<string, { x: number; y: number; width: number; height: number }>): PositionedGroup[] {
  const made = new Map<string, PositionedGroup>()
  for (const [id, group] of groups) {
    const box = boxes.get(id)
    if (!box) continue
    const title = measureMultilineText(group.label, FONT_SIZES.groupHeader, FONT_WEIGHTS.groupHeader).width + 24
    const width = Math.max(box.width, title)
    made.set(id, { id, label: group.label, x: box.x - width / 2, y: box.y - box.height / 2, width, height: box.height, children: [], ...(group.inlineStyle ? { inlineStyle: group.inlineStyle } : {}), ...(group.variant ? { variant: group.variant } : {}) })
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
  const ink = new Ink().groups(graph.groups)
  for (const node of graph.nodes) ink.box(node)
  for (const edge of graph.edges) {
    for (const point of edge.points) ink.point(point)
    if (edge.label && edge.labelPosition) {
      const metrics = measureMultilineText(edge.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)
      ink.box({ x: edge.labelPosition.x - metrics.width / 2 - EDGE_LABEL_PADDING.x, y: edge.labelPosition.y - metrics.height / 2 - EDGE_LABEL_PADDING.y, width: metrics.width + EDGE_LABEL_PADDING.x * 2, height: metrics.height + EDGE_LABEL_PADDING.y * 2 })
    }
  }
  const { dx, dy, width, height } = ink.frame(padding)
  return {
    width,
    height,
    nodes: graph.nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy })),
    edges: graph.edges.map((edge) => ({ ...edge, points: edge.points.map((point) => movePoint(point, dx, dy)), ...(edge.labelPosition ? { labelPosition: movePoint(edge.labelPosition, dx, dy) } : {}) })),
    groups: moveGroups(graph.groups, dx, dy),
  }
}
