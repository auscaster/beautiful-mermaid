// ============================================================================
// A diagram as Mermaid's own parser reads it.
//
// `mermaid.mermaidAPI.getDiagramFromText(text)` returns the diagram's type and
// its database. Flowchart, state, class and ER diagrams describe themselves to
// Mermaid's layouts through `db.getData()`; these are the parts of that data
// the renderer reads. Nothing here imports Mermaid.
// ============================================================================

export interface ParsedMermaidDiagram {
  /** Mermaid's diagram type: `flowchart-v2`, `stateDiagram`, `classDiagram`, `er`, `sequence`, `gantt`, ... */
  type: string
  db: unknown
}

export interface MermaidLayoutData {
  nodes: MermaidLayoutNode[]
  edges: MermaidLayoutEdge[]
  direction?: string
}

export interface MermaidLayoutNode {
  id: string
  label?: string
  /** `markdown` for a backtick string; `string` or `text` otherwise, which may hold HTML. */
  labelType?: string
  shape?: string
  parentId?: string
  isGroup?: boolean
  /** A subgraph's own direction. */
  dir?: string
  /** Styles from the node's classes (`classDef`), in order. */
  cssCompiledStyles?: string[]
  /** Styles from `style` statements, which win over the classes'. */
  cssStyles?: string[]
  link?: string
}

export interface MermaidLayoutEdge {
  id: string
  start: string
  end: string
  label?: string
  labelType?: string
  /** `normal`, `dotted`, `thick` or `invisible`. */
  pattern?: string
  thickness?: string
  arrowTypeStart?: string
  arrowTypeEnd?: string
  minlen?: number
  /** Styles from `linkStyle`. */
  style?: string[]
}
