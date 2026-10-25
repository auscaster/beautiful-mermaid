// ============================================================================
// Node sizing — the box a node's label needs, by shape.
//
// Shared by both layouts: ELK for diagrams parsed here, dagre for diagrams
// Mermaid's own parser reads.
// ============================================================================

import { FONT_SIZES, FONT_WEIGHTS, NODE_PADDING } from './styles.ts'
import { LINE_HEIGHT_RATIO, measureMultilineText } from './text-metrics.ts'

/** A subgraph's header band: its title's lines with 8px above and below, none for an untitled one. */
export function groupHeaderHeight(label: string): number {
  if (!label.trim()) return 0
  const lines = label.split('\n').length
  return FONT_SIZES.groupHeader + 16 + (lines - 1) * FONT_SIZES.groupHeader * LINE_HEIGHT_RATIO
}

/** Room between a subgraph's header band and the first thing inside it. */
export const GROUP_HEADER_GAP = 12

/** Space a node's description takes below its label: the divider's gap above and below it. */
export const DESCRIPTION_GAP = 8

/**
 * The width and height a node needs to hold its label in its shape.
 * `fontSize` is the label's size where an author's style sets one;
 * `description` is lines shown under a divider below the label.
 */
export function estimateNodeSize(label: string, shape: string, fontSize: number = FONT_SIZES.nodeLabel, description?: string): { width: number; height: number } {
  // A start state's dot and an end state's ring, at Mermaid's 14px.
  if (shape === 'state-start' || shape === 'state-end') return { width: 18, height: 18 }
  if (shape === 'state-choice') return { width: 28, height: 28 }

  const metrics = measureMultilineText(label, fontSize, FONT_WEIGHTS.nodeLabel)
  let width = metrics.width + NODE_PADDING.horizontal * 2
  let height = metrics.height + NODE_PADDING.vertical * 2
  if (description) {
    const below = measureMultilineText(description, fontSize, FONT_WEIGHTS.nodeLabel - 100)
    width = Math.max(width, below.width + NODE_PADDING.horizontal * 2)
    height += below.height + DESCRIPTION_GAP * 2
  }

  if (shape === 'diamond') {
    const side = Math.max(width, height) + NODE_PADDING.diamondExtra
    width = side
    height = side
  }

  if (shape === 'circle' || shape === 'doublecircle') {
    const diameter = Math.ceil(Math.sqrt(width * width + height * height)) + 8
    width = shape === 'doublecircle' ? diameter + 12 : diameter
    height = width
  }

  // Slanted sides take room the label cannot use.
  if (shape === 'hexagon' || shape === 'trapezoid' || shape === 'trapezoid-alt' || shape === 'lean-right' || shape === 'lean-left') {
    width += NODE_PADDING.horizontal
  }

  if (shape === 'asymmetric') width += 12
  if (shape === 'cylinder') height += 14
  if (shape === 'document') height += 10

  return { width: Math.max(width, 60), height: Math.max(height, 36) }
}
