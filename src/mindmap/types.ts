// ============================================================================
// Mindmap types
// ============================================================================

/** Mermaid's mindmap shapes: `text`, `(rounded)`, `[square]`, `((circle))`, `)cloud(`, `))bang((`, `{{hexagon}}` */
export type MindmapShape = 'default' | 'rounded' | 'rect' | 'circle' | 'cloud' | 'bang' | 'hexagon'

export interface MindmapNode {
  id: string
  label: string
  shape: MindmapShape
  children: MindmapNode[]
}

export interface PositionedMindmapNode {
  id: string
  label: string
  shape: MindmapShape
  /** Top-left corner and size */
  x: number
  y: number
  width: number
  height: number
  /** Its depth: 0 for the root */
  depth: number
  /** The top-level branch it belongs to, which colours it; undefined for the root */
  branch?: number
}

export interface PositionedMindmapEdge {
  from: string
  to: string
  /** A cubic curve: start, two control points, end */
  points: [number, number][]
  depth: number
  branch: number
}

export interface PositionedMindmap {
  width: number
  height: number
  nodes: PositionedMindmapNode[]
  edges: PositionedMindmapEdge[]
}
