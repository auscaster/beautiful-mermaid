// ============================================================================
// Clusters — which subgraphs Mermaid lays out on their own, and how edges that
// name a subgraph reach it.
//
// A port of Mermaid's mermaid-graphlib (adjustClustersAndEdges and extractor,
// mermaid 11.17), so a diagram is arranged as Mermaid arranges it. A cluster no
// edge crosses into is taken out of its graph and laid out as a graph of its
// own, at right angles to the one around it unless it names a direction; an
// edge to or from a cluster is attached to a node inside it and cut at the
// cluster's border when drawn. State is kept per layout, never in the module.
// ============================================================================

import { Graph } from 'dagre-d3-es/src/graphlib/index.js'

export interface ClusterEntry {
  /** The node an edge naming this cluster attaches to. */
  id: string
  clusterData: Record<string, unknown>
  externalConnections?: boolean
}

export interface ClusterNodeLabel {
  clusterNode: true
  id: string
  clusterData: Record<string, unknown>
  graph: Graph
  width?: number
  height?: number
  x?: number
  y?: number
}

interface EdgeRef {
  v: string
  w: string
  name?: string | number
}

export class ClusterIndex {
  readonly clusters = new Map<string, ClusterEntry>()
  private readonly descendants = new Map<string, string[]>()

  private isDescendant(id: string, ancestorId: string): boolean {
    return (this.descendants.get(ancestorId) ?? []).includes(id)
  }

  private edgeInCluster(edge: EdgeRef, clusterId: string): boolean {
    const clusterDescendants = this.descendants.get(clusterId) ?? []
    if (edge.v === clusterId || edge.w === clusterId) return false
    return clusterDescendants.includes(edge.v) || this.isDescendant(edge.v, clusterId) || this.isDescendant(edge.w, clusterId) || clusterDescendants.includes(edge.w)
  }

  private extractDescendants(id: string, graph: Graph): string[] {
    const children = graph.children(id) ?? []
    let result = [...children]
    for (const child of children) result = [...result, ...this.extractDescendants(child, graph)]
    return result
  }

  private findCommonEdges(graph: Graph, id1: string, id2: string): EdgeRef[] {
    const edges1 = (graph.edges() as EdgeRef[]).filter((edge) => edge.v === id1 || edge.w === id1)
    const edges2 = (graph.edges() as EdgeRef[]).filter((edge) => edge.v === id2 || edge.w === id2)
    const edges1Prim = edges1.map((edge: EdgeRef) => ({ v: edge.v === id1 ? id2 : edge.v, w: edge.w === id1 ? id1 : edge.w }))
    return edges1Prim.filter((edgeIn1: EdgeRef) => edges2.some((edge: EdgeRef) => edgeIn1.v === edge.v && edgeIn1.w === edge.w))
  }

  /** The first node inside a cluster, descending, that no edge of the cluster's own already names. */
  findNonClusterChild(id: string, graph: Graph, clusterId: string): string | undefined {
    const children = graph.children(id) ?? []
    if (children.length < 1) return id
    let reserve: string | undefined
    for (const child of children) {
      const found = this.findNonClusterChild(child, graph, clusterId)
      const commonEdges = found ? this.findCommonEdges(graph, clusterId, found) : []
      if (found) {
        if (commonEdges.length > 0) reserve = found
        else return found
      }
    }
    return reserve
  }

  private anchorId(id: string): string {
    const entry = this.clusters.get(id)
    if (!entry || !entry.externalConnections) return id
    return entry.id
  }

  private isNodeInExtractableCluster(graph: Graph, node: string, rootId: string): boolean {
    let parent = graph.parent(node)
    while (parent && parent !== rootId) {
      const cluster = this.clusters.get(parent)
      if (cluster && !cluster.externalConnections) return true
      parent = graph.parent(parent)
    }
    return false
  }

  private findSafeAnchorNode(graph: Graph, clusterId: string, excludedCluster: string | undefined): string | null {
    for (const child of graph.children(clusterId) ?? []) {
      if (child === excludedCluster || (excludedCluster && this.isDescendant(child, excludedCluster))) continue
      const candidate = this.findNonClusterChild(child, graph, clusterId)
      if (!candidate) continue
      if (!this.isNodeInExtractableCluster(graph, candidate, clusterId)) return candidate
    }
    return null
  }

  /**
   * Mark each cluster an edge crosses, attach edges that name a cluster to a
   * node inside it, and take out the clusters no edge crosses.
   */
  adjust(graph: Graph): void {
    for (const id of graph.nodes()) {
      if ((graph.children(id) ?? []).length > 0) {
        this.descendants.set(id, this.extractDescendants(id, graph))
        this.clusters.set(id, { id: this.findNonClusterChild(id, graph, id) ?? id, clusterData: graph.node(id) })
      }
    }
    for (const id of graph.nodes()) {
      if ((graph.children(id) ?? []).length === 0) continue
      for (const edge of graph.edges() as EdgeRef[]) {
        if (this.isDescendant(edge.v, id) !== this.isDescendant(edge.w, id)) this.clusters.get(id)!.externalConnections = true
      }
    }
    for (const id of this.clusters.keys()) {
      const entry = this.clusters.get(id)!
      const nonClusterChild = entry.id
      const parent = graph.parent(nonClusterChild)
      if (parent !== id && parent && this.clusters.has(parent) && !this.clusters.get(parent)!.externalConnections) entry.id = parent
      const hasDirectOutgoingEdge = (graph.edges() as EdgeRef[]).some((edge) => edge.v === id)
      if (nonClusterChild && entry.externalConnections && hasDirectOutgoingEdge && this.isNodeInExtractableCluster(graph, nonClusterChild, id)) {
        const safeAnchor = this.findSafeAnchorNode(graph, id, graph.parent(nonClusterChild))
        if (safeAnchor) entry.id = safeAnchor
      }
    }
    for (const e of graph.edges() as EdgeRef[]) {
      const edge = graph.edge(e)
      if (!this.clusters.has(e.v) && !this.clusters.has(e.w)) continue
      const v = this.anchorId(e.v)
      const w = this.anchorId(e.w)
      graph.removeEdge(e.v, e.w, e.name)
      if (v !== e.v) {
        const parent = graph.parent(v)
        if (parent && this.clusters.has(parent)) this.clusters.get(parent)!.externalConnections = true
        edge.fromCluster = e.v
      }
      if (w !== e.w) {
        const parent = graph.parent(w)
        if (parent && this.clusters.has(parent)) this.clusters.get(parent)!.externalConnections = true
        edge.toCluster = e.w
      }
      graph.setEdge(v, w, edge, e.name)
    }
    this.extract(graph, 0)
  }

  private copy(clusterId: string, graph: Graph, newGraph: Graph, rootId: string): void {
    const nodes = [...(graph.children(clusterId) ?? [])]
    if (clusterId !== rootId) nodes.push(clusterId)
    for (const node of nodes) {
      if ((graph.children(node) ?? []).length > 0) {
        this.copy(node, graph, newGraph, rootId)
      } else {
        newGraph.setNode(node, graph.node(node))
        if (rootId !== graph.parent(node)) newGraph.setParent(node, graph.parent(node))
        if (clusterId !== rootId && node !== clusterId) newGraph.setParent(node, clusterId)
        // Every edge of the graph, in its order, as Mermaid copies them: the order of a layout's
        // edges steers how dagre orders its nodes.
        for (const edge of graph.edges() as EdgeRef[]) {
          if (this.edgeInCluster(edge, rootId)) newGraph.setEdge(edge.v, edge.w, graph.edge(edge.v, edge.w, edge.name), edge.name)
        }
      }
      graph.removeNode(node)
    }
  }

  private extract(graph: Graph, depth: number): void {
    if (depth > 10) return
    if (!graph.nodes().some((node: string) => (graph.children(node) ?? []).length > 0)) return
    for (const node of graph.nodes()) {
      const entry = this.clusters.get(node)
      if (!entry || entry.externalConnections || !(graph.children(node) ?? []).length) continue
      const rankdir = (graph.graph() as { rankdir?: string }).rankdir
      const dir = (entry.clusterData?.dir as string | undefined) ?? (rankdir === 'TB' ? 'LR' : 'TB')
      const clusterGraph = new Graph({ multigraph: true, compound: true })
        .setGraph({ rankdir: dir, nodesep: 50, ranksep: 50, marginx: 8, marginy: 8 })
        .setDefaultEdgeLabel(() => ({}))
      this.copy(node, graph, clusterGraph, node)
      const label: ClusterNodeLabel = { clusterNode: true, id: node, clusterData: entry.clusterData, graph: clusterGraph }
      graph.setNode(node, label)
    }
    for (const node of graph.nodes()) {
      const data = graph.node(node) as ClusterNodeLabel | undefined
      if (data?.clusterNode) this.extract(data.graph, depth + 1)
    }
  }
}
