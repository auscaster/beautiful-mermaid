// ============================================================================
// Mindmaps as Mermaid's parser reads them: the tree from its root, each
// node's label and shape.
// ============================================================================

import type { MindmapNode, MindmapShape } from '../mindmap/types.ts'
import { mermaidLabel } from './labels.ts'

interface MermaidMindmapNode {
  id: number | string
  descr: string
  type: number
  children?: MermaidMindmapNode[]
}

/** The mindmap database Mermaid's parser fills (`getDiagramFromText(text).db`). */
export interface MermaidMindmapDb {
  getMindmap(): MermaidMindmapNode | null
}

/** Mermaid's node types, by number. */
const SHAPES: MindmapShape[] = ['default', 'rounded', 'rect', 'circle', 'cloud', 'bang', 'hexagon']

/** A Mermaid mindmap database as the mindmap layout reads it. */
export function mermaidMindmap(db: MermaidMindmapDb): MindmapNode {
  const root = db.getMindmap()
  if (!root) throw new Error('Mermaid\'s mindmap has no root')
  const read = (node: MermaidMindmapNode): MindmapNode => ({
    id: String(node.id),
    label: mermaidLabel(node.descr, 'markdown'),
    shape: SHAPES[node.type] ?? 'default',
    children: (node.children ?? []).map(read),
  })
  return read(root)
}
