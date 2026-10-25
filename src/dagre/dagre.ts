// ============================================================================
// Dagre's layout, as Mermaid runs it, with room for subgraph titles.
//
// A port of dagre-d3-es's layout orchestration (src/dagre/layout.js, MIT,
// itself dagre's), calling the same stages in the same order. One step is
// added: before coordinates are assigned, the border a cluster's title sits on
// (its top, as the diagram is finally drawn) takes the title's height. Ranks
// and the order within them are decided before that step, so a diagram keeps
// Mermaid's arrangement; only the room around a titled cluster grows.
// ============================================================================

import { Graph } from 'dagre-d3-es/src/graphlib/index.js'
import * as acyclic from 'dagre-d3-es/src/dagre/acyclic.js'
import { addBorderSegments } from 'dagre-d3-es/src/dagre/add-border-segments.js'
import * as coordinateSystem from 'dagre-d3-es/src/dagre/coordinate-system.js'
import * as nestingGraph from 'dagre-d3-es/src/dagre/nesting-graph.js'
import * as normalize from 'dagre-d3-es/src/dagre/normalize.js'
import { order } from 'dagre-d3-es/src/dagre/order/index.js'
import { parentDummyChains } from 'dagre-d3-es/src/dagre/parent-dummy-chains.js'
import { position } from 'dagre-d3-es/src/dagre/position/index.js'
import { rank } from 'dagre-d3-es/src/dagre/rank/index.js'
import * as util from 'dagre-d3-es/src/dagre/util.js'

type Label = Record<string, any>
type EdgeObj = { v: string; w: string; name?: string }

const GRAPH_NUMBERS = ['nodesep', 'edgesep', 'ranksep', 'marginx', 'marginy']
const GRAPH_DEFAULTS: Label = { ranksep: 50, edgesep: 20, nodesep: 50, rankdir: 'tb' }
const GRAPH_ATTRS = ['acyclicer', 'ranker', 'rankdir', 'align']
/** A node's size, and the room a cluster's title needs above its contents. */
const NODE_NUMBERS = ['width', 'height', 'titleheight']
const NODE_DEFAULTS: Label = { width: 0, height: 0 }
const EDGE_NUMBERS = ['minlen', 'weight', 'width', 'height', 'labeloffset']
const EDGE_DEFAULTS: Label = { minlen: 1, weight: 1, width: 0, height: 0, labeloffset: 10, labelpos: 'r' }
const EDGE_ATTRS = ['labelpos']

/**
 * Lay out `g` in place, as dagre's `layout` does. A cluster whose label has
 * `titleHeight` keeps that much room between its title edge and its contents.
 */
export function layout(g: Graph): void {
  const layoutGraph = buildLayoutGraph(g)
  runLayout(layoutGraph)
  updateInputGraph(g, layoutGraph)
}

function runLayout(g: Graph): void {
  makeSpaceForEdgeLabels(g)
  removeSelfEdges(g)
  acyclic.run(g)
  nestingGraph.run(g)
  rank(util.asNonCompoundGraph(g))
  injectEdgeLabelProxies(g)
  util.removeEmptyRanks(g)
  nestingGraph.cleanup(g)
  util.normalizeRanks(g)
  assignRankMinMax(g)
  removeEdgeLabelProxies(g)
  normalize.run(g)
  parentDummyChains(g)
  addBorderSegments(g)
  order(g)
  insertSelfEdges(g)
  coordinateSystem.adjust(g)
  makeRoomForTitles(g)
  position(g)
  positionSelfEdges(g)
  removeBorderNodes(g)
  normalize.undo(g)
  fixupEdgeLabelCoords(g)
  coordinateSystem.undo(g)
  translateGraph(g)
  assignNodeIntersects(g)
  reversePointsForReversedEdges(g)
  acyclic.undo(g)
}

/**
 * The border a cluster's title sits on, sized so the title fits between it and
 * the contents. Coordinates are still top to bottom here: a top-to-bottom
 * diagram's title border is the cluster's top, a bottom-to-top one's its
 * bottom (the layout is flipped afterwards), and a left-to-right or
 * right-to-left one's its left border, which becomes the top when the axes
 * swap. A border node sits on the cluster's edge, centred, so half its size
 * falls inside.
 */
function makeRoomForTitles(g: Graph): void {
  const rankdir = String(g.graph().rankdir).toLowerCase()
  const { ranksep, nodesep, edgesep } = g.graph() as { ranksep: number; nodesep: number; edgesep: number }
  for (const v of g.nodes()) {
    const node = g.node(v) as Label
    const title = node.titleheight as number | undefined
    if (!title || !(g.children(v) ?? []).length) continue
    if (rankdir === 'tb' || rankdir === 'bt') {
      // The rank above the contents is the border's own; the contents sit ranksep below it.
      const border = g.node(rankdir === 'tb' ? node.borderTop : node.borderBottom) as Label | undefined
      if (border) border.height = Math.max(border.height ?? 0, 2 * Math.max(0, title - ranksep))
    } else {
      // Within a rank, a border sits edgesep/2 + nodesep/2 from the node beside it.
      const width = 2 * Math.max(0, title - (edgesep + nodesep) / 2)
      for (const id of (node.borderLeft ?? []) as string[]) {
        const border = id ? (g.node(id) as Label | undefined) : undefined
        if (border) border.width = Math.max(border.width ?? 0, width)
      }
    }
  }
}

function updateInputGraph(inputGraph: Graph, layoutGraph: Graph): void {
  for (const v of inputGraph.nodes()) {
    const inputLabel = inputGraph.node(v) as Label | undefined
    const layoutLabel = layoutGraph.node(v) as Label
    if (inputLabel) {
      inputLabel.x = layoutLabel.x
      inputLabel.y = layoutLabel.y
      if ((layoutGraph.children(v) ?? []).length) {
        inputLabel.width = layoutLabel.width
        inputLabel.height = layoutLabel.height
      }
    }
  }
  for (const e of inputGraph.edges() as EdgeObj[]) {
    const inputLabel = inputGraph.edge(e) as Label
    const layoutLabel = layoutGraph.edge(e) as Label
    inputLabel.points = layoutLabel.points
    if (Object.prototype.hasOwnProperty.call(layoutLabel, 'x')) {
      inputLabel.x = layoutLabel.x
      inputLabel.y = layoutLabel.y
    }
  }
  inputGraph.graph().width = layoutGraph.graph().width
  inputGraph.graph().height = layoutGraph.graph().height
}

function buildLayoutGraph(inputGraph: Graph): Graph {
  const g = new Graph({ multigraph: true, compound: true })
  const graph = canonicalize(inputGraph.graph() as Label)
  g.setGraph({ ...GRAPH_DEFAULTS, ...numbers(graph, GRAPH_NUMBERS), ...pick(graph, GRAPH_ATTRS) })
  for (const v of inputGraph.nodes()) {
    const node = canonicalize(inputGraph.node(v) as Label)
    g.setNode(v, { ...NODE_DEFAULTS, ...numbers(node, NODE_NUMBERS) })
    g.setParent(v, inputGraph.parent(v))
  }
  for (const e of inputGraph.edges() as EdgeObj[]) {
    const edge = canonicalize(inputGraph.edge(e) as Label)
    g.setEdge(e, { ...EDGE_DEFAULTS, ...numbers(edge, EDGE_NUMBERS), ...pick(edge, EDGE_ATTRS) })
  }
  return g
}

/** Halve the rank separation and double every edge's length, so a label can sit on the rank between its ends. */
function makeSpaceForEdgeLabels(g: Graph): void {
  const graph = g.graph() as Label
  graph.ranksep /= 2
  for (const e of g.edges() as EdgeObj[]) {
    const edge = g.edge(e) as Label
    edge.minlen *= 2
    if (String(edge.labelpos).toLowerCase() !== 'c') {
      if (graph.rankdir === 'TB' || graph.rankdir === 'BT') edge.width += edge.labeloffset
      else edge.height += edge.labeloffset
    }
  }
}

function injectEdgeLabelProxies(g: Graph): void {
  for (const e of g.edges() as EdgeObj[]) {
    const edge = g.edge(e) as Label
    if (edge.width && edge.height) {
      const v = g.node(e.v) as Label
      const w = g.node(e.w) as Label
      util.addDummyNode(g, 'edge-proxy', { rank: (w.rank - v.rank) / 2 + v.rank, e }, '_ep')
    }
  }
}

function assignRankMinMax(g: Graph): void {
  let maxRank = 0
  for (const v of g.nodes()) {
    const node = g.node(v) as Label
    if (node.borderTop) {
      node.minRank = (g.node(node.borderTop) as Label).rank
      node.maxRank = (g.node(node.borderBottom) as Label).rank
      maxRank = Math.max(maxRank, node.maxRank)
    }
  }
  g.graph().maxRank = maxRank
}

function removeEdgeLabelProxies(g: Graph): void {
  for (const v of g.nodes()) {
    const node = g.node(v) as Label
    if (node.dummy === 'edge-proxy') {
      ;(g.edge(node.e) as Label).labelRank = node.rank
      g.removeNode(v)
    }
  }
}

function translateGraph(g: Graph): void {
  let minX = Number.POSITIVE_INFINITY
  let maxX = 0
  let minY = Number.POSITIVE_INFINITY
  let maxY = 0
  const graphLabel = g.graph() as Label
  const marginX = graphLabel.marginx || 0
  const marginY = graphLabel.marginy || 0
  const extremes = (attrs: Label) => {
    minX = Math.min(minX, attrs.x - attrs.width / 2)
    maxX = Math.max(maxX, attrs.x + attrs.width / 2)
    minY = Math.min(minY, attrs.y - attrs.height / 2)
    maxY = Math.max(maxY, attrs.y + attrs.height / 2)
  }
  for (const v of g.nodes()) extremes(g.node(v) as Label)
  for (const e of g.edges() as EdgeObj[]) {
    const edge = g.edge(e) as Label
    if (Object.prototype.hasOwnProperty.call(edge, 'x')) extremes(edge)
  }
  minX -= marginX
  minY -= marginY
  for (const v of g.nodes()) {
    const node = g.node(v) as Label
    node.x -= minX
    node.y -= minY
  }
  for (const e of g.edges() as EdgeObj[]) {
    const edge = g.edge(e) as Label
    for (const p of edge.points ?? []) {
      p.x -= minX
      p.y -= minY
    }
    if (Object.prototype.hasOwnProperty.call(edge, 'x')) edge.x -= minX
    if (Object.prototype.hasOwnProperty.call(edge, 'y')) edge.y -= minY
  }
  graphLabel.width = maxX - minX + marginX
  graphLabel.height = maxY - minY + marginY
}

function assignNodeIntersects(g: Graph): void {
  for (const e of g.edges() as EdgeObj[]) {
    const edge = g.edge(e) as Label
    const nodeV = g.node(e.v) as Label
    const nodeW = g.node(e.w) as Label
    let p1: Label
    let p2: Label
    if (!edge.points) {
      edge.points = []
      p1 = nodeW
      p2 = nodeV
    } else {
      p1 = edge.points[0]
      p2 = edge.points[edge.points.length - 1]
    }
    edge.points.unshift(util.intersectRect(nodeV, p1))
    edge.points.push(util.intersectRect(nodeW, p2))
  }
}

function fixupEdgeLabelCoords(g: Graph): void {
  for (const e of g.edges() as EdgeObj[]) {
    const edge = g.edge(e) as Label
    if (!Object.prototype.hasOwnProperty.call(edge, 'x')) continue
    if (edge.labelpos === 'l' || edge.labelpos === 'r') edge.width -= edge.labeloffset
    if (edge.labelpos === 'l') edge.x -= edge.width / 2 + edge.labeloffset
    else if (edge.labelpos === 'r') edge.x += edge.width / 2 + edge.labeloffset
  }
}

function reversePointsForReversedEdges(g: Graph): void {
  for (const e of g.edges() as EdgeObj[]) {
    const edge = g.edge(e) as Label
    if (edge.reversed) edge.points.reverse()
  }
}

function removeBorderNodes(g: Graph): void {
  for (const v of g.nodes()) {
    if (!(g.children(v) ?? []).length) continue
    const node = g.node(v) as Label
    const t = g.node(node.borderTop) as Label
    const b = g.node(node.borderBottom) as Label
    const l = g.node(node.borderLeft[node.borderLeft.length - 1]) as Label
    const r = g.node(node.borderRight[node.borderRight.length - 1]) as Label
    node.width = Math.abs(r.x - l.x)
    node.height = Math.abs(b.y - t.y)
    node.x = l.x + node.width / 2
    node.y = t.y + node.height / 2
  }
  for (const v of g.nodes()) {
    if ((g.node(v) as Label).dummy === 'border') g.removeNode(v)
  }
}

function removeSelfEdges(g: Graph): void {
  for (const e of g.edges() as EdgeObj[]) {
    if (e.v !== e.w) continue
    const node = g.node(e.v) as Label
    if (!node.selfEdges) node.selfEdges = []
    node.selfEdges.push({ e, label: g.edge(e) })
    g.removeEdge(e)
  }
}

function insertSelfEdges(g: Graph): void {
  for (const layer of util.buildLayerMatrix(g) as string[][]) {
    let orderShift = 0
    layer.forEach((v, i) => {
      const node = g.node(v) as Label
      node.order = i + orderShift
      for (const selfEdge of node.selfEdges ?? []) {
        util.addDummyNode(g, 'selfedge', { width: selfEdge.label.width, height: selfEdge.label.height, rank: node.rank, order: i + ++orderShift, e: selfEdge.e, label: selfEdge.label }, '_se')
      }
      delete node.selfEdges
    })
  }
}

function positionSelfEdges(g: Graph): void {
  for (const v of g.nodes()) {
    const node = g.node(v) as Label
    if (node.dummy !== 'selfedge') continue
    const selfNode = g.node(node.e.v) as Label
    const x = selfNode.x + selfNode.width / 2
    const y = selfNode.y
    const dx = node.x - x
    const dy = selfNode.height / 2
    g.setEdge(node.e, node.label)
    g.removeNode(v)
    node.label.points = [
      { x: x + (2 * dx) / 3, y: y - dy },
      { x: x + (5 * dx) / 6, y: y - dy },
      { x: x + dx, y },
      { x: x + (5 * dx) / 6, y: y + dy },
      { x: x + (2 * dx) / 3, y: y + dy },
    ]
    node.label.x = node.x
    node.label.y = node.y
  }
}

function numbers(obj: Label, attrs: string[]): Label {
  const out: Label = {}
  for (const key of attrs) if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = Number(obj[key])
  return out
}

function pick(obj: Label, attrs: string[]): Label {
  const out: Label = {}
  for (const key of attrs) if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = obj[key]
  return out
}

function canonicalize(attrs: Label | undefined): Label {
  const out: Label = {}
  for (const [key, value] of Object.entries(attrs ?? {})) out[key.toLowerCase()] = value
  return out
}
