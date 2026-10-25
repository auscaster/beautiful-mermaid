// ============================================================================
// ER diagrams as Mermaid's parser reads them (`getData()`), laid out as
// Mermaid lays them out and drawn as this renderer draws ER diagrams.
// ============================================================================

import type { Direction } from '../types.ts'
import type { Cardinality, ErAttribute, ErEntity, PositionedErDiagram, PositionedErRelationship } from '../er/types.ts'
import { ER, entityTable } from '../er/layout.ts'
import { FONT_SIZES, FONT_WEIGHTS } from '../styles.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { layoutDagre } from '../dagre/layout.ts'
import { intersectRect } from '../dagre/intersect.ts'
import type { MermaidLayoutData, MermaidLayoutNode } from './types.ts'
import { mermaidLabel } from './labels.ts'
import { Ink, movePoint } from './frame.ts'
import type { GraphLayoutOptions } from './graph.ts'

interface MermaidErNode extends MermaidLayoutNode {
  attributes?: { type?: string; name?: string; keys?: string[]; comment?: string }[]
}

interface MermaidErEdge {
  id: string
  start: string
  end: string
  label?: string
  labelType?: string
  arrowTypeStart?: string
  arrowTypeEnd?: string
  /** `solid` for an identifying relationship (`--`), `dashed` for a non-identifying one (`..`) */
  pattern?: string
}

const CARDINALITIES: Record<string, Cardinality> = { only_one: 'one', zero_or_one: 'zero-one', one_or_more: 'many', zero_or_more: 'zero-many' }
const KEYS = new Set(['PK', 'FK', 'UK'])

export function layoutMermaidEr(data: MermaidLayoutData, options: GraphLayoutOptions): PositionedErDiagram {
  const direction = (data.direction ?? 'TB') as Direction
  const entities = new Map<string, ErEntity>()
  for (const raw of data.nodes as MermaidErNode[]) {
    if (raw.isGroup) continue
    entities.set(raw.id, {
      id: raw.id,
      label: mermaidLabel(raw.label, raw.labelType),
      attributes: (raw.attributes ?? []).map((attr): ErAttribute => ({
        type: mermaidLabel(attr.type ?? ''),
        name: mermaidLabel(attr.name ?? ''),
        keys: (attr.keys ?? []).filter((key): key is ErAttribute['keys'][number] => KEYS.has(key)),
        ...(attr.comment ? { comment: mermaidLabel(attr.comment) } : {}),
      })),
    })
  }

  const edges = (data.edges as unknown as MermaidErEdge[]).map((edge) => {
    const label = mermaidLabel(edge.label, edge.labelType)
    return { edge, label, metrics: label ? measureMultilineText(label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel) : undefined }
  })
  const laid = layoutDagre(
    {
      direction,
      nodes: [...entities.values()].map((entity) => ({ id: entity.id, isGroup: false, ...entityTable(entity) })),
      edges: edges.map(({ edge, metrics }) => ({ id: edge.id, source: edge.start, target: edge.end, minlen: 1, ...(metrics ? { labelWidth: metrics.width + 8, labelHeight: metrics.height + 6 } : {}) })),
      nodeSpacing: options.nodeSpacing,
      rankSpacing: options.rankSpacing,
    },
    intersectRect,
  )

  const byId = new Map(edges.map((input) => [input.edge.id, input]))
  const relationships: PositionedErRelationship[] = []
  for (const laidEdge of laid.edges) {
    const input = byId.get(laidEdge.id)
    if (!input) continue
    const { edge, label } = input
    relationships.push({
      entity1: laidEdge.source,
      entity2: laidEdge.target,
      cardinality1: CARDINALITIES[edge.arrowTypeStart ?? ''] ?? 'one',
      cardinality2: CARDINALITIES[edge.arrowTypeEnd ?? ''] ?? 'one',
      label,
      identifying: edge.pattern !== 'dashed' && edge.pattern !== 'dotted',
      points: laidEdge.points,
      ...(laidEdge.label ? { labelPosition: laidEdge.label } : {}),
      curved: true,
    })
  }

  const positionedEntities = [...entities.values()].filter((entity) => laid.nodes.has(entity.id)).map((entity) => {
    const box = laid.nodes.get(entity.id)!
    return { ...entity, x: box.x - box.width / 2, y: box.y - box.height / 2, width: box.width, height: box.height, headerHeight: ER.headerHeight, rowHeight: ER.rowHeight, columns: entityTable(entity).columns }
  })

  const ink = new Ink()
  for (const entity of positionedEntities) ink.box(entity)
  for (const rel of relationships) {
    for (const point of rel.points) ink.point(point)
    // The label's pill, as the renderer draws it: the text with 4px and 3px around it.
    const metrics = rel.label ? measureMultilineText(rel.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel) : undefined
    if (metrics && rel.labelPosition) ink.box({ x: rel.labelPosition.x - metrics.width / 2 - 4, y: rel.labelPosition.y - metrics.height / 2 - 3, width: metrics.width + 8, height: metrics.height + 6 })
  }
  const { dx, dy, width, height } = ink.frame(options.padding)
  return {
    width,
    height,
    entities: positionedEntities.map((entity) => ({ ...entity, x: entity.x + dx, y: entity.y + dy })),
    relationships: relationships.map((rel) => ({ ...rel, points: rel.points.map((point) => movePoint(point, dx, dy)), ...(rel.labelPosition ? { labelPosition: movePoint(rel.labelPosition, dx, dy) } : {}) })),
  }
}
