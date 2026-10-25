// ============================================================================
// Where an edge meets a node: the point on the node's outline on the line from
// its centre toward the point the edge heads to.
// ============================================================================

import type { NodeShape, Point } from '../types.ts'
import type { LaidOutBox } from './layout.ts'

export function intersectShape(shape: NodeShape, node: LaidOutBox, toward: Point): Point {
  switch (shape) {
    case 'diamond':
      return intersectPolygon(node, toward, [[0, -1], [1, 0], [0, 1], [-1, 0]])
    case 'circle':
    case 'doublecircle':
    case 'state-start':
    case 'state-end':
      return intersectCircle(node, toward)
    case 'hexagon': {
      const inset = (node.height / 4 / node.width) * 2
      return intersectPolygon(node, toward, [[-1 + inset, -1], [1 - inset, -1], [1, 0], [1 - inset, 1], [-1 + inset, 1], [-1, 0]])
    }
    case 'trapezoid':
      return intersectPolygon(node, toward, [[-0.7, -1], [0.7, -1], [1, 1], [-1, 1]])
    case 'trapezoid-alt':
      return intersectPolygon(node, toward, [[-1, -1], [1, -1], [0.7, 1], [-0.7, 1]])
    case 'lean-right':
      return intersectPolygon(node, toward, [[-0.7, -1], [1, -1], [0.7, 1], [-1, 1]])
    case 'lean-left':
      return intersectPolygon(node, toward, [[-1, -1], [0.7, -1], [1, 1], [-0.7, 1]])
    default:
      return intersectRect(node, toward)
  }
}

/** Dagre's rectangle intersection, which Mermaid keeps for box-like shapes. */
export function intersectRect(node: LaidOutBox, toward: Point): Point {
  const dx = toward.x - node.x
  const dy = toward.y - node.y
  let w = node.width / 2
  let h = node.height / 2
  if (!dx && !dy) return { x: node.x, y: node.y }
  let sx: number
  let sy: number
  if (Math.abs(dy) * w > Math.abs(dx) * h) {
    if (dy < 0) h = -h
    sx = (h * dx) / dy
    sy = h
  } else {
    if (dx < 0) w = -w
    sx = w
    sy = (w * dy) / dx
  }
  return { x: node.x + sx, y: node.y + sy }
}

function intersectCircle(node: LaidOutBox, toward: Point): Point {
  const r = Math.min(node.width, node.height) / 2
  const dx = toward.x - node.x
  const dy = toward.y - node.y
  const length = Math.sqrt(dx * dx + dy * dy)
  if (!length) return { x: node.x, y: node.y }
  return { x: node.x + (dx / length) * r, y: node.y + (dy / length) * r }
}

/**
 * The outline of a polygon given by its corners as fractions of the half-size
 * (from -1 to 1 on each axis), crossed by the ray from the centre toward a point.
 */
function intersectPolygon(node: LaidOutBox, toward: Point, corners: [number, number][]): Point {
  const points = corners.map(([fx, fy]) => ({ x: node.x + (fx * node.width) / 2, y: node.y + (fy * node.height) / 2 }))
  const dx = toward.x - node.x
  const dy = toward.y - node.y
  let best: Point | undefined
  let bestT = Infinity
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    const ex = b.x - a.x
    const ey = b.y - a.y
    const denominator = dx * ey - dy * ex
    if (Math.abs(denominator) < 1e-9) continue
    // Ray: centre + t·(dx, dy); edge: a + s·(ex, ey).
    const t = ((a.x - node.x) * ey - (a.y - node.y) * ex) / denominator
    const s = ((a.x - node.x) * dy - (a.y - node.y) * dx) / denominator
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9 && t < bestT) {
      bestT = t
      best = { x: node.x + t * dx, y: node.y + t * dy }
    }
  }
  return best ?? intersectRect(node, toward)
}
