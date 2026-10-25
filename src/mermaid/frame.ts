// ============================================================================
// Framing — the canvas around a laid-out drawing, the same margin on every side.
// ============================================================================

import type { Point, PositionedGroup } from '../types.ts'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Collects what a drawing inks, to find how far to move it and how large its canvas is. */
export class Ink {
  private x0 = Infinity
  private y0 = Infinity
  private x1 = -Infinity
  private y1 = -Infinity

  box(box: Box): this {
    this.x0 = Math.min(this.x0, box.x)
    this.y0 = Math.min(this.y0, box.y)
    this.x1 = Math.max(this.x1, box.x + box.width)
    this.y1 = Math.max(this.y1, box.y + box.height)
    return this
  }

  point(point: Point): this {
    return this.box({ ...point, width: 0, height: 0 })
  }

  groups(groups: PositionedGroup[]): this {
    for (const group of groups) this.box(group).groups(group.children)
    return this
  }

  /** The shift that puts the ink `padding` from the canvas's top and left, and the canvas's size. */
  frame(padding: number): { dx: number; dy: number; width: number; height: number } {
    if (!Number.isFinite(this.x0)) return { dx: 0, dy: 0, width: padding * 2, height: padding * 2 }
    return { dx: padding - this.x0, dy: padding - this.y0, width: this.x1 - this.x0 + padding * 2, height: this.y1 - this.y0 + padding * 2 }
  }
}

export const movePoint = (point: Point, dx: number, dy: number): Point => ({ x: point.x + dx, y: point.y + dy })

export function moveGroups(groups: PositionedGroup[], dx: number, dy: number): PositionedGroup[] {
  return groups.map((group) => ({ ...group, x: group.x + dx, y: group.y + dy, children: moveGroups(group.children, dx, dy) }))
}
