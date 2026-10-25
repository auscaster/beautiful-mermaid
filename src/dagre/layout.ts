// ============================================================================
// Layout as Mermaid lays out flowchart, state, class and ER diagrams: dagre,
// with Mermaid's handling of clusters and self loops (mermaid 11.17,
// rendering-util/layout-algorithms/dagre). Mermaid measures each node by
// drawing it; here each node arrives measured, and a cluster laid out on its
// own takes the size of its own layout.
// ============================================================================

import { Graph } from 'dagre-d3-es/src/graphlib/index.js'
import { layout as dagreLayout } from './dagre.ts'
import type { Direction, Point } from '../types.ts'
import { ClusterIndex, type ClusterNodeLabel } from './clusters.ts'

/** A node to lay out: a measured leaf, or a cluster whose size its contents decide. */
export interface DagreNodeInput {
  id: string
  parentId?: string
  isGroup: boolean
  /** A cluster's own direction, which a cluster laid out on its own keeps. */
  dir?: Direction
  /** Room a cluster keeps between its title edge and its contents. */
  titleHeight?: number
  width: number
  height: number
}

export interface DagreEdgeInput {
  id: string
  source: string
  target: string
  minlen: number
  /** Room the edge's label takes, if it has one. */
  labelWidth?: number
  labelHeight?: number
}

export interface DagreInput {
  direction: Direction
  nodes: DagreNodeInput[]
  edges: DagreEdgeInput[]
  nodeSpacing: number
  rankSpacing: number
}

export interface LaidOutBox {
  id: string
  /** Centre and size, in the diagram's coordinates. */
  x: number
  y: number
  width: number
  height: number
}

export interface LaidOutEdge {
  id: string
  source: string
  target: string
  /** The path from the source's outline to the target's, cut at a cluster's border where the edge names one. */
  points: Point[]
  label?: Point
}

export interface DagreLayout {
  nodes: Map<string, LaidOutBox>
  clusters: Map<string, LaidOutBox>
  edges: LaidOutEdge[]
  width: number
  height: number
}

/** Where an edge leaves or enters a node: the node's outline, given the point it heads to. */
export type Intersect = (node: LaidOutBox, toward: Point) => Point

interface NodeLabel extends Record<string, unknown> {
  id: string
  width?: number
  height?: number
  x?: number
  y?: number
  isGroup?: boolean
  dir?: Direction
  titleHeight?: number
}

interface EdgeLabel extends Record<string, unknown> {
  id: string
  start: string
  end: string
  minlen: number
  width?: number
  height?: number
  labelpos?: string
  points?: Point[]
  x?: number
  y?: number
  fromCluster?: string
  toCluster?: string
  selfLoop?: { id: string; order: number }
  originalEdge?: EdgeLabel
}

const MARGIN = 8

export function layoutDagre(input: DagreInput, intersect: Intersect): DagreLayout {
  const graph = new Graph({ multigraph: true, compound: true })
    .setGraph({ rankdir: input.direction === 'TD' ? 'TB' : input.direction, nodesep: input.nodeSpacing, ranksep: input.rankSpacing, marginx: MARGIN, marginy: MARGIN })
    .setDefaultEdgeLabel(() => ({}))
  for (const node of input.nodes) {
    graph.setNode(node.id, { id: node.id, isGroup: node.isGroup, dir: node.dir, ...(node.isGroup ? (node.titleHeight ? { titleHeight: node.titleHeight } : {}) : { width: node.width, height: node.height }) } satisfies NodeLabel)
    if (node.parentId) graph.setParent(node.id, node.parentId)
  }
  for (const edge of input.edges) {
    const label: EdgeLabel = { id: edge.id, start: edge.source, end: edge.target, minlen: edge.minlen, ...(edge.labelWidth ? { width: edge.labelWidth, height: edge.labelHeight, labelpos: 'c' } : {}) }
    if (edge.source === edge.target) addSelfLoop(graph, label)
    else graph.setEdge(edge.source, edge.target, label, edge.id)
  }

  const clusters = new ClusterIndex()
  clusters.adjust(graph)
  run(graph)

  const out: DagreLayout = { nodes: new Map(), clusters: new Map(), edges: [], width: 0, height: 0 }
  place(graph, { x: 0, y: 0 }, out)
  const { width, height } = graph.graph() as { width: number; height: number }
  out.width = width
  out.height = height
  out.edges = edgesOf(graph, { x: 0, y: 0 }, out, clusters, intersect)
  return out
}

/** A self loop becomes two small nodes and three edges, as Mermaid lays one out. */
function addSelfLoop(graph: Graph, edge: EdgeLabel): void {
  const nodeId = edge.start
  const node = graph.node(nodeId) as NodeLabel
  const parent = graph.parent(nodeId)
  const first = `${nodeId}---${nodeId}---1`
  const second = `${nodeId}---${nodeId}---2`
  for (const id of [first, second]) {
    graph.setNode(id, { id, width: 10, height: 10 } satisfies NodeLabel)
    if (parent) graph.setParent(id, parent)
  }
  const original = { ...edge }
  const segment = (order: number, extra: Partial<EdgeLabel>): EdgeLabel => ({ ...edge, ...extra, originalEdge: original, selfLoop: { id: edge.id, order } })
  graph.setEdge(nodeId, first, segment(0, { id: `${nodeId}-cyclic-special-1`, width: undefined, height: undefined, labelpos: undefined, ...(node?.isGroup ? { fromCluster: nodeId } : {}) }), `${nodeId}-cyclic-special-0`)
  graph.setEdge(first, second, segment(1, { id: `${nodeId}-cyclic-special-mid` }), `${nodeId}-cyclic-special-1`)
  graph.setEdge(second, nodeId, segment(2, { id: `${nodeId}-cyclic-special-2`, width: undefined, height: undefined, labelpos: undefined, ...(node?.isGroup ? { toCluster: nodeId } : {}) }), `${nodeId}-cyclic-special-2`)
}

/**
 * Lay out a graph after the clusters taken out of it: each such cluster is laid
 * out first, in its own graph around its contents, and takes that layout's size.
 */
function run(graph: Graph): void {
  for (const v of graph.nodes()) {
    const node = graph.node(v) as ClusterNodeLabel | undefined
    if (!node?.clusterNode) continue
    const { ranksep, nodesep } = graph.graph() as { ranksep: number; nodesep: number }
    node.graph.setGraph({ ...node.graph.graph(), ranksep: ranksep + 25, nodesep })
    // The cluster itself holds what was taken out with it, so its box is laid out with them.
    node.graph.setNode(node.id, { ...node.clusterData, id: node.id, isGroup: true })
    for (const child of node.graph.nodes()) if (child !== node.id && !node.graph.parent(child)) node.graph.setParent(child, node.id)
    run(node.graph)
    const box = node.graph.node(node.id) as NodeLabel
    node.width = box.width ?? 0
    node.height = box.height ?? 0
  }
  dagreLayout(graph)
}

/** Every node's and cluster's box, a cluster laid out on its own moved to where its graph placed it. */
function place(graph: Graph, offset: Point, out: DagreLayout): void {
  for (const v of graph.nodes()) {
    const node = graph.node(v) as (NodeLabel & Partial<ClusterNodeLabel>) | undefined
    if (!node) continue
    if (node.clusterNode && node.graph) {
      const inner = node.graph.node(node.id) as NodeLabel
      const shift = { x: offset.x + (node.x ?? 0) - (inner.x ?? 0), y: offset.y + (node.y ?? 0) - (inner.y ?? 0) }
      place(node.graph, shift, out)
      continue
    }
    const box: LaidOutBox = { id: v, x: (node.x ?? 0) + offset.x, y: (node.y ?? 0) + offset.y, width: node.width ?? 0, height: node.height ?? 0 }
    if ((graph.children(v) ?? []).length > 0) out.clusters.set(v, box)
    else if (!/---.+---[12]$/.test(v)) out.nodes.set(v, box)
  }
}

/** Every edge's drawn path, in the diagram's coordinates, with its label's centre. */
function edgesOf(graph: Graph, offset: Point, out: DagreLayout, clusters: ClusterIndex, intersect: Intersect): LaidOutEdge[] {
  const edges: LaidOutEdge[] = []
  for (const v of graph.nodes()) {
    const node = graph.node(v) as (NodeLabel & Partial<ClusterNodeLabel>) | undefined
    if (node?.clusterNode && node.graph) {
      const inner = node.graph.node(node.id) as NodeLabel
      edges.push(...edgesOf(node.graph, { x: offset.x + (node.x ?? 0) - (inner.x ?? 0), y: offset.y + (node.y ?? 0) - (inner.y ?? 0) }, out, clusters, intersect))
    }
  }
  const moved = (point: Point): Point => ({ x: point.x + offset.x, y: point.y + offset.y })
  const loops = new Map<string, { edge: EdgeLabel; start: string; end: string }[]>()
  const rankdir = (graph.graph() as { rankdir?: string }).rankdir
  for (const e of graph.edges() as { v: string; w: string; name?: string }[]) {
    const edge = graph.edge(e) as EdgeLabel
    if (edge.selfLoop) {
      const group = loops.get(edge.selfLoop.id) ?? []
      group.push({ edge, start: e.v, end: e.w })
      loops.set(edge.selfLoop.id, group)
      continue
    }
    edges.push(drawn(edge, e.v, e.w, (edge.points ?? []).map(moved), edge.x === undefined ? undefined : moved({ x: edge.x, y: edge.y! })))
  }
  for (const segments of loops.values()) {
    segments.sort((a, b) => a.edge.selfLoop!.order - b.edge.selfLoop!.order)
    const original = segments[0]!.edge.originalEdge!
    const node = out.nodes.get(original.start) ?? out.clusters.get(original.start)
    if (!node || segments.length !== 3) continue
    const middle = segments[1]!.edge
    const label = { width: middle.width ?? 0, height: middle.height ?? 0 }
    const hints = [segments[0]!.end, segments[1]!.end].map((id) => graph.node(id) as NodeLabel).filter((hint) => typeof hint?.x === 'number').map((hint) => moved({ x: hint.x!, y: hint.y! }))
    const side = loopSide(node, hints, rankdir)
    const points = loopPoints(node, side, label.width)
    edges.push({ id: original.id, source: original.start, target: original.end, points, ...(label.width ? { label: loopLabel(node, points, side, label) } : {}) })
  }
  return edges

  function drawn(edge: EdgeLabel, start: string, end: string, raw: Point[], label?: Point): LaidOutEdge {
    const tail = out.nodes.get(start) ?? out.clusters.get(start)
    const head = out.nodes.get(end) ?? out.clusters.get(end)
    let points = raw
    // The path meets each end's outline, as Mermaid's node intersections place it.
    if (tail && head && raw.length >= 2) {
      const inner = raw.slice(1, -1)
      points = [intersect(tail, inner[0] ?? raw[raw.length - 1]!), ...inner, intersect(head, inner[inner.length - 1] ?? raw[0]!)]
    }
    // An edge that names a cluster stops at the cluster's border; Mermaid cuts dagre's own path for one that ends at it.
    if (edge.toCluster) {
      const box = out.clusters.get(edge.toCluster)
      if (box) points = cutAtBorder(raw, box)
    }
    if (edge.fromCluster) {
      const box = out.clusters.get(edge.fromCluster)
      if (box) points = cutAtBorder([...points].reverse(), box).reverse()
    }
    return { id: edge.id, source: edge.fromCluster ?? edge.start, target: edge.toCluster ?? edge.end, points: softenCorners(points.filter((point) => !Number.isNaN(point.y))), ...(label ? { label } : {}) }
  }
}

function loopSide(node: LaidOutBox, hints: Point[], rankdir?: string): 'top' | 'bottom' | 'left' | 'right' {
  const fallback = rankdir === 'BT' ? 'bottom' : rankdir === 'LR' ? 'right' : rankdir === 'RL' ? 'left' : 'top'
  if (!hints.length) return fallback
  const center = hints.reduce((sum, point) => ({ x: sum.x + point.x / hints.length, y: sum.y + point.y / hints.length }), { x: 0, y: 0 })
  const dx = center.x - node.x
  const dy = center.y - node.y
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  if (Math.abs(dy) > 0) return dy > 0 ? 'bottom' : 'top'
  return fallback
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function loopPoints(node: LaidOutBox, side: string, labelWidth: number): Point[] {
  const { x, y } = node
  const halfWidth = node.width / 2
  const halfHeight = node.height / 2
  const span = clamp(Math.max(labelWidth, node.width * 0.35), 36, Math.max(36, Math.min(100, node.width * 0.8)))
  const depth = clamp(Math.min(node.width, node.height) * 0.45, 24, 48)
  switch (side) {
    case 'bottom': return [{ x: x - span / 2, y: y + halfHeight }, { x: x - span / 2, y: y + halfHeight + depth }, { x: x + span / 2, y: y + halfHeight + depth }, { x: x + span / 2, y: y + halfHeight }]
    case 'right': return [{ x: x + halfWidth, y: y - span / 2 }, { x: x + halfWidth + depth, y: y - span / 2 }, { x: x + halfWidth + depth, y: y + span / 2 }, { x: x + halfWidth, y: y + span / 2 }]
    case 'left': return [{ x: x - halfWidth, y: y - span / 2 }, { x: x - halfWidth - depth, y: y - span / 2 }, { x: x - halfWidth - depth, y: y + span / 2 }, { x: x - halfWidth, y: y + span / 2 }]
    default: return [{ x: x - span / 2, y: y - halfHeight }, { x: x - span / 2, y: y - halfHeight - depth }, { x: x + span / 2, y: y - halfHeight - depth }, { x: x + span / 2, y: y - halfHeight }]
  }
}

function loopLabel(node: LaidOutBox, points: Point[], side: string, label: { width: number; height: number }): Point {
  const gap = 4
  switch (side) {
    case 'bottom': return { x: node.x, y: Math.max(...points.map((p) => p.y)) + label.height / 2 + gap }
    case 'right': return { x: Math.max(...points.map((p) => p.x)) + label.width / 2 + gap, y: node.y }
    case 'left': return { x: Math.min(...points.map((p) => p.x)) - label.width / 2 - gap, y: node.y }
    default: return { x: node.x, y: Math.min(...points.map((p) => p.y)) - label.height / 2 - gap }
  }
}

const outside = (box: LaidOutBox, point: Point) => Math.abs(point.x - box.x) >= box.width / 2 || Math.abs(point.y - box.y) >= box.height / 2

/** Where the segment from a point outside a box to one inside it crosses the box's border (Mermaid's `intersection`). */
function borderCrossing(box: LaidOutBox, outsidePoint: Point, insidePoint: Point): Point {
  const { x, y } = box
  const w = box.width / 2
  const h = box.height / 2
  const Q = Math.abs(outsidePoint.y - insidePoint.y)
  const R = Math.abs(outsidePoint.x - insidePoint.x)
  if (Math.abs(y - outsidePoint.y) * w > Math.abs(x - outsidePoint.x) * h) {
    const q = insidePoint.y < outsidePoint.y ? outsidePoint.y - h - y : y - h - outsidePoint.y
    const r = (R * q) / Q
    const result = { x: insidePoint.x < outsidePoint.x ? insidePoint.x + r : insidePoint.x - R + r, y: insidePoint.y < outsidePoint.y ? insidePoint.y + Q - q : insidePoint.y - Q + q }
    if (r === 0) return { ...outsidePoint }
    if (R === 0) result.x = outsidePoint.x
    if (Q === 0) result.y = outsidePoint.y
    return result
  }
  const r = insidePoint.x < outsidePoint.x ? outsidePoint.x - w - x : x - w - outsidePoint.x
  const q = (Q * r) / R
  const result = { x: insidePoint.x < outsidePoint.x ? insidePoint.x + R - r : insidePoint.x - R + r, y: insidePoint.y < outsidePoint.y ? insidePoint.y + q : insidePoint.y - q }
  if (r === 0) return { ...outsidePoint }
  if (R === 0) result.x = outsidePoint.x
  if (Q === 0) result.y = outsidePoint.y
  return result
}

/** The path up to where it first enters a box (Mermaid's `cutPathAtIntersect`). */
function cutAtBorder(points: Point[], box: LaidOutBox): Point[] {
  const kept: Point[] = []
  let lastOutside = points[0]!
  let inside = false
  for (const point of points) {
    if (!outside(box, point) && !inside) {
      const crossing = borderCrossing(box, lastOutside, point)
      if (!kept.some((p) => p.x === crossing.x && p.y === crossing.y)) kept.push(crossing)
      inside = true
    } else {
      lastOutside = point
      if (!inside) kept.push(point)
    }
  }
  return kept
}

/** Right-angle corners eased over five pixels, as Mermaid eases them before drawing a curve (`fixCorners`). */
function softenCorners(points: Point[]): Point[] {
  const corners = new Set<number>()
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!, curr = points[i]!, next = points[i + 1]!
    if ((prev.x === curr.x && curr.y === next.y && Math.abs(curr.x - next.x) > 5 && Math.abs(curr.y - prev.y) > 5) ||
        (prev.y === curr.y && curr.x === next.x && Math.abs(curr.x - prev.x) > 5 && Math.abs(curr.y - next.y) > 5)) corners.add(i)
  }
  if (!corners.size) return points
  const toward = (from: Point, to: Point, distance: number): Point => {
    const dx = to.x - from.x, dy = to.y - from.y
    const ratio = distance / Math.sqrt(dx * dx + dy * dy)
    return { x: to.x - ratio * dx, y: to.y - ratio * dy }
  }
  const result: Point[] = []
  for (let i = 0; i < points.length; i++) {
    if (!corners.has(i)) { result.push(points[i]!); continue }
    const prev = points[i - 1]!, corner = points[i]!, next = points[i + 1]!
    const before = toward(prev, corner, 5)
    const after = toward(next, corner, 5)
    const dx = after.x - before.x, dy = after.y - before.y
    const a = Math.sqrt(2) * 2
    let eased = { x: corner.x, y: corner.y }
    if (Math.abs(next.x - prev.x) > 10 && Math.abs(next.y - prev.y) >= 10) {
      const r = 5
      eased = corner.x === before.x
        ? { x: dx < 0 ? before.x - r + a : before.x + r - a, y: dy < 0 ? before.y - a : before.y + a }
        : { x: dx < 0 ? before.x - a : before.x + a, y: dy < 0 ? before.y - r + a : before.y + r - a }
    }
    result.push(before, eased, after)
  }
  return result
}
