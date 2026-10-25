/**
 * ER diagram layout engine (ELK.js).
 *
 * Each entity box has:
 *   1. Header (entity name)
 *   2. Attribute rows (type, name, keys)
 */

import type { ElkNode, ElkExtendedEdge } from 'elkjs'
import type { ErColumns, ErDiagram, ErEntity, PositionedErDiagram, PositionedErEntity, PositionedErRelationship } from './types.ts'
import type { RenderOptions, Point } from '../types.ts'
import { estimateTextWidth, estimateMonoTextWidth, FONT_SIZES, FONT_WEIGHTS } from '../styles.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { elkLayoutSync } from '../elk-instance.ts'

/** Layout constants for ER diagrams */
export const ER = {
  padding: 40,
  boxPadX: 14,
  headerHeight: 34,
  rowHeight: 22,
  minWidth: 140,
  attrFontSize: 11,
  attrFontWeight: 400,
  nodeSpacing: 70,
  layerSpacing: 90,
} as const

type EntitySizeMap = Map<string, { width: number; height: number }>

/** Space between the columns of an entity's attribute table. */
export const ER_COLUMN_GAP = 12

/** Font of the key badges (PK, FK, UK). */
export const ER_KEY_FONT = { size: 9, weight: 600 } as const

/**
 * An entity's size and its attribute table's columns: type, name, keys and
 * comment, each as wide as its widest cell, as Mermaid tabulates them. An
 * entity with no attributes is its header alone.
 */
export function entityTable(entity: ErEntity): { width: number; height: number; columns: ErColumns } {
  const columns: ErColumns = { type: 0, name: 0, keys: 0, comment: 0 }
  for (const attr of entity.attributes) {
    columns.type = Math.max(columns.type, estimateMonoTextWidth(attr.type, ER.attrFontSize))
    columns.name = Math.max(columns.name, estimateMonoTextWidth(attr.name, ER.attrFontSize))
    if (attr.keys.length) columns.keys = Math.max(columns.keys, estimateTextWidth(attr.keys.join(', '), ER_KEY_FONT.size, ER_KEY_FONT.weight) + 8)
    if (attr.comment) columns.comment = Math.max(columns.comment, estimateTextWidth(attr.comment, ER.attrFontSize, ER.attrFontWeight))
  }
  const used = [columns.type, columns.name, columns.keys, columns.comment].filter((width) => width > 0)
  const rowWidth = used.reduce((sum, width) => sum + width, 0) + Math.max(0, used.length - 1) * ER_COLUMN_GAP
  const headerTextW = estimateTextWidth(entity.label, FONT_SIZES.nodeLabel, 700)
  return {
    width: Math.max(ER.minWidth, headerTextW + ER.boxPadX * 2, rowWidth + ER.boxPadX * 2),
    height: ER.headerHeight + entity.attributes.length * ER.rowHeight,
    columns,
  }
}

/** Build ELK graph and size map from an ER diagram. */
function buildErElkGraph(
  diagram: ErDiagram,
  _options: RenderOptions
): { elkGraph: ElkNode; entitySizes: EntitySizeMap } {
  const entitySizes: EntitySizeMap = new Map()

  for (const entity of diagram.entities) {
    const { width, height } = entityTable(entity)
    entitySizes.set(entity.id, { width, height })
  }

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': String(ER.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(ER.layerSpacing),
      'elk.padding': `[top=${ER.padding},left=${ER.padding},bottom=${ER.padding},right=${ER.padding}]`,
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.edgeLabels.placement': 'CENTER',
    },
    children: [],
    edges: [],
  }

  for (const entity of diagram.entities) {
    const size = entitySizes.get(entity.id)!
    elkGraph.children!.push({ id: entity.id, width: size.width, height: size.height })
  }

  for (let i = 0; i < diagram.relationships.length; i++) {
    const rel = diagram.relationships[i]!
    const metrics = measureMultilineText(rel.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)
    const edge: ElkExtendedEdge = { id: `e${i}`, sources: [rel.entity1], targets: [rel.entity2] }
    if (rel.label) {
      edge.labels = [{ text: rel.label, width: metrics.width + 8, height: metrics.height + 6 }]
    }
    elkGraph.edges!.push(edge)
  }

  return { elkGraph, entitySizes }
}

/** Extract positioned entities and relationships from ELK result. */
function extractErLayout(
  result: ElkNode,
  diagram: ErDiagram,
  entitySizes: EntitySizeMap
): PositionedErDiagram {
  const entityLookup = new Map<string, ErEntity>()
  for (const entity of diagram.entities) entityLookup.set(entity.id, entity)

  const positionedEntities: PositionedErEntity[] = []
  for (const child of result.children ?? []) {
    const entity = entityLookup.get(child.id)
    if (entity) {
      positionedEntities.push({
        id: entity.id,
        label: entity.label,
        attributes: entity.attributes,
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? entitySizes.get(entity.id)!.width,
        height: child.height ?? entitySizes.get(entity.id)!.height,
        headerHeight: ER.headerHeight,
        rowHeight: ER.rowHeight,
        columns: entityTable(entity).columns,
      })
    }
  }

  const relationships: PositionedErRelationship[] = []
  for (let i = 0; i < (result.edges?.length ?? 0); i++) {
    const elkEdge = result.edges![i]!
    const rel = diagram.relationships[i]!

    const points: Point[] = []
    if (elkEdge.sections && elkEdge.sections.length > 0) {
      const section = elkEdge.sections[0]!
      points.push({ x: section.startPoint.x, y: section.startPoint.y })
      if (section.bendPoints) {
        for (const bp of section.bendPoints) {
          points.push({ x: bp.x, y: bp.y })
        }
      }
      points.push({ x: section.endPoint.x, y: section.endPoint.y })
    }

    relationships.push({
      entity1: rel.entity1,
      entity2: rel.entity2,
      cardinality1: rel.cardinality1,
      cardinality2: rel.cardinality2,
      label: rel.label,
      identifying: rel.identifying,
      points,
    })
  }

  return {
    width: result.width ?? 600,
    height: result.height ?? 400,
    entities: positionedEntities,
    relationships,
  }
}

/**
 * Lay out a parsed ER diagram using ELK.js (synchronous).
 */
export function layoutErDiagramSync(
  diagram: ErDiagram,
  options: RenderOptions = {}
): PositionedErDiagram {
  if (diagram.entities.length === 0) {
    return { width: 0, height: 0, entities: [], relationships: [] }
  }

  const { elkGraph, entitySizes } = buildErElkGraph(diagram, options)
  const result = elkLayoutSync(elkGraph)
  return extractErLayout(result, diagram, entitySizes)
}
