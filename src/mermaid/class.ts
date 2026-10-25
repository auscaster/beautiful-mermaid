// ============================================================================
// Class diagrams as Mermaid's parser reads them (`getData()`), laid out as
// Mermaid lays them out and drawn as this renderer draws class diagrams.
// ============================================================================

import type { Direction, PositionedNode } from '../types.ts'
import type { ClassMember, ClassNode, PositionedClassDiagram, PositionedClassRelationship, RelationshipType } from '../class/types.ts'
import { classBoxSize } from '../class/layout.ts'
import { FONT_SIZES, FONT_WEIGHTS } from '../styles.ts'
import { measureMultilineText } from '../text-metrics.ts'
import { estimateNodeSize, GROUP_HEADER_GAP, groupHeaderHeight } from '../node-size.ts'
import { layoutDagre, type DagreNodeInput } from '../dagre/layout.ts'
import { intersectRect } from '../dagre/intersect.ts'
import type { MermaidLayoutData, MermaidLayoutNode } from './types.ts'
import { mermaidLabel } from './labels.ts'
import { Ink, moveGroups, movePoint } from './frame.ts'
import { groupTree, type GraphLayoutOptions } from './graph.ts'

interface MermaidMember {
  memberType?: string
  visibility?: string
  /** `$` static, `*` abstract */
  classifier?: string
  /** The member as written, its visibility escaped: `\+id: UUID`, `\+String name` */
  text?: string
  /** A method's name */
  id?: string
  parameters?: string
  returnType?: string
}

interface MermaidClassNode extends MermaidLayoutNode {
  members?: MermaidMember[]
  methods?: MermaidMember[]
  annotations?: string[]
}

interface MermaidClassEdge {
  id: string
  start: string
  end: string
  label?: string
  labelType?: string
  arrowTypeStart?: string
  arrowTypeEnd?: string
  /** `solid`, `dashed` or `dotted` */
  pattern?: string
  startLabelRight?: string
  endLabelLeft?: string
}

const VISIBILITY = new Set(['+', '-', '#', '~'])

export function layoutMermaidClass(data: MermaidLayoutData, options: GraphLayoutOptions): PositionedClassDiagram {
  const direction = (data.direction ?? 'TB') as Direction
  const classes = new Map<string, ClassNode>()
  const notes = new Map<string, PositionedNode>()
  const groups = new Map<string, { label: string; parentId?: string }>()
  const dagreNodes: DagreNodeInput[] = []

  for (const raw of data.nodes as MermaidClassNode[]) {
    if (raw.isGroup) {
      const label = mermaidLabel(raw.label, raw.labelType)
      groups.set(raw.id, { label, parentId: raw.parentId })
      const header = groupHeaderHeight(label)
      dagreNodes.push({ id: raw.id, parentId: raw.parentId, isGroup: true, ...(header ? { titleHeight: header + GROUP_HEADER_GAP } : {}), width: 0, height: 0 })
      continue
    }
    if (raw.shape === 'note') {
      const label = mermaidLabel(raw.label, raw.labelType)
      const size = estimateNodeSize(label, 'note')
      notes.set(raw.id, { id: raw.id, label, shape: 'note', x: 0, y: 0, ...size })
      dagreNodes.push({ id: raw.id, parentId: raw.parentId, isGroup: false, ...size })
      continue
    }
    const cls: ClassNode = {
      id: raw.id,
      label: mermaidLabel(raw.label, raw.labelType),
      ...(raw.annotations?.length ? { annotation: raw.annotations[0] } : {}),
      attributes: (raw.members ?? []).map(attribute),
      methods: (raw.methods ?? []).map(method),
    }
    classes.set(raw.id, cls)
    const size = classBoxSize(cls)
    dagreNodes.push({ id: raw.id, parentId: raw.parentId, isGroup: false, width: size.width, height: size.height })
  }

  const edges = (data.edges as unknown as MermaidClassEdge[]).map((edge) => {
    const label = mermaidLabel(edge.label, edge.labelType)
    return { edge, label, metrics: label ? measureMultilineText(label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel) : undefined }
  })
  const laid = layoutDagre(
    {
      direction,
      nodes: dagreNodes,
      edges: edges.map(({ edge, metrics }) => ({ id: edge.id, source: edge.start, target: edge.end, minlen: 1, ...(metrics ? { labelWidth: metrics.width + 8, labelHeight: metrics.height + 6 } : {}) })),
      nodeSpacing: options.nodeSpacing,
      rankSpacing: options.rankSpacing,
    },
    intersectRect,
  )

  const byId = new Map(edges.map((input) => [input.edge.id, input]))
  const relationships: PositionedClassRelationship[] = []
  for (const laidEdge of laid.edges) {
    const input = byId.get(laidEdge.id)
    if (!input) continue
    const { edge, label } = input
    const { type, markerAt } = relationship(edge)
    relationships.push({
      from: laidEdge.source,
      to: laidEdge.target,
      type,
      markerAt,
      ...(label ? { label, ...(laidEdge.label ? { labelPosition: laidEdge.label } : {}) } : {}),
      ...(edge.startLabelRight ? { fromCardinality: mermaidLabel(edge.startLabelRight) } : {}),
      ...(edge.endLabelLeft ? { toCardinality: mermaidLabel(edge.endLabelLeft) } : {}),
      points: laidEdge.points,
      curved: true,
      // A plain link written with dots, and a note's connector, are dashed.
      ...(type === 'link' && edge.pattern !== 'solid' ? { dashed: true } : {}),
    })
  }

  const box = (id: string) => {
    const laidBox = laid.nodes.get(id)!
    return { x: laidBox.x - laidBox.width / 2, y: laidBox.y - laidBox.height / 2, width: laidBox.width, height: laidBox.height }
  }
  const positionedClasses = [...classes.values()].filter((cls) => laid.nodes.has(cls.id)).map((cls) => {
    const size = classBoxSize(cls)
    return { ...cls, ...box(cls.id), headerHeight: size.headerHeight, attrHeight: size.attrHeight, methodHeight: size.methodHeight }
  })
  const positionedNotes = [...notes.values()].filter((note) => laid.nodes.has(note.id)).map((note) => ({ ...note, ...box(note.id) }))
  const positionedGroups = groupTree(groups, laid.clusters)

  const ink = new Ink().groups(positionedGroups)
  for (const item of [...positionedClasses, ...positionedNotes]) ink.box(item)
  for (const rel of relationships) {
    for (const point of rel.points) ink.point(point)
    // The label sits 8px above its position, as the renderer draws it.
    if (rel.label && rel.labelPosition) {
      const metrics = measureMultilineText(rel.label, FONT_SIZES.edgeLabel, FONT_WEIGHTS.edgeLabel)
      ink.box({ x: rel.labelPosition.x - metrics.width / 2, y: rel.labelPosition.y - 8 - metrics.height / 2, width: metrics.width, height: metrics.height })
    }
  }
  const { dx, dy, width, height } = ink.frame(options.padding)
  return {
    width,
    height,
    classes: positionedClasses.map((cls) => ({ ...cls, x: cls.x + dx, y: cls.y + dy })),
    notes: positionedNotes.map((note) => ({ ...note, x: note.x + dx, y: note.y + dy })),
    groups: moveGroups(positionedGroups, dx, dy),
    relationships: relationships.map((rel) => ({ ...rel, points: rel.points.map((point) => movePoint(point, dx, dy)), ...(rel.labelPosition ? { labelPosition: movePoint(rel.labelPosition, dx, dy) } : {}) })),
  }
}

/** An attribute as written: `+id: UUID` splits into name and type; `+String name` stays as it reads. */
function attribute(member: MermaidMember): ClassMember {
  const written = (member.text ?? member.id ?? '').replace(/^\\(?=[+\-#~])/, '')
  const visibility = VISIBILITY.has(written[0] ?? '') ? written[0]! : ''
  const rest = mermaidLabel(visibility ? written.slice(1) : written)
  const colon = rest.indexOf(':')
  return {
    visibility: visibility as ClassMember['visibility'],
    name: colon > 0 ? rest.slice(0, colon).trim() : rest,
    ...(colon > 0 ? { type: rest.slice(colon + 1).trim() } : {}),
    ...(member.classifier === '$' ? { isStatic: true } : {}),
    ...(member.classifier === '*' ? { isAbstract: true } : {}),
  }
}

function method(member: MermaidMember): ClassMember {
  return {
    visibility: (VISIBILITY.has(member.visibility ?? '') ? member.visibility : '') as ClassMember['visibility'],
    name: mermaidLabel(member.id ?? ''),
    isMethod: true,
    ...(member.parameters ? { params: mermaidLabel(member.parameters) } : {}),
    ...(member.returnType ? { type: mermaidLabel(member.returnType) } : {}),
    ...(member.classifier === '$' ? { isStatic: true } : {}),
    ...(member.classifier === '*' ? { isAbstract: true } : {}),
  }
}

/**
 * The UML relationship an edge's ends name, and which end carries its marker:
 * a triangle (`<|--`), dashed for realisation; a diamond (`*--`, `o--`); an
 * arrow (`-->`), dashed for a dependency; or a plain link (`--`, `..`).
 */
function relationship(edge: MermaidClassEdge): { type: RelationshipType; markerAt: 'from' | 'to' } {
  const start = edge.arrowTypeStart ?? 'none'
  const end = edge.arrowTypeEnd ?? 'none'
  const marker = start !== 'none' ? start : end
  const markerAt = start !== 'none' ? 'from' : 'to'
  const dashed = edge.pattern === 'dashed' || edge.pattern === 'dotted'
  switch (marker) {
    case 'extension': return { type: dashed ? 'realization' : 'inheritance', markerAt }
    case 'composition': return { type: 'composition', markerAt }
    case 'aggregation': return { type: 'aggregation', markerAt }
    case 'dependency': return { type: dashed ? 'dependency' : 'association', markerAt }
    default: return { type: 'link', markerAt }
  }
}
