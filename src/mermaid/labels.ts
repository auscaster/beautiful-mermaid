// ============================================================================
// Labels and styles as Mermaid's parser hands them over, in the renderer's
// terms: lines split on `\n`, emphasis as <b>, <i>, <u> and <s>.
// ============================================================================

import { decodeHTML } from 'entities'
import { normalizeBrTags } from '../multiline-utils.ts'

const FORMAT_TAG = /^<\/?(?:b|strong|i|em|u|s|del)\s*>$/i

/**
 * A label's text for drawing. HTML Mermaid allows in a label keeps its
 * emphasis and line breaks and loses other tags; entities become characters;
 * Markdown emphasis becomes the emphasis it marks, in a plain label too, where
 * Mermaid would show its asterisks.
 */
export function mermaidLabel(label: string | undefined, labelType?: string): string {
  if (!label) return ''
  // Mermaid hides `#quot;` and `#9829;` from its grammar as ﬂ°quot¶ß and ﬂ°°9829¶ß; they are entities.
  let text = label.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';')
  if (labelType === 'markdown') {
    // A Markdown string's own newlines are line breaks, and _x_ is emphasis as *x* is.
    text = text.replace(/(^|[^\w])_([^_\s](?:[^_]*[^_\s])?)_(?=[^\w]|$)/g, '$1<i>$2</i>').replace(/__([^_]+)__/g, '<b>$1</b>')
  }
  text = normalizeBrTags(text).replace(/<[^>]*>/g, (tag) => (FORMAT_TAG.test(tag) ? tag : ''))
  return decodeHTML(text).split('\n').map((line) => line.trim()).join('\n').trim()
}

/** `fill:#f96`, `stroke-width: 2px` and the like, later declarations winning. */
export function mermaidStyles(...lists: (string[] | undefined)[]): Record<string, string> | undefined {
  const styles: Record<string, string> = {}
  for (const list of lists) {
    for (const declaration of list ?? []) {
      const colon = declaration.indexOf(':')
      if (colon <= 0) continue
      const key = declaration.slice(0, colon).trim()
      const value = declaration.slice(colon + 1).replace(/!important/g, '').trim()
      if (key && value) styles[key] = value
    }
  }
  return Object.keys(styles).length ? styles : undefined
}

/** A CSS length such as `14px` as a number of pixels. */
export function pixels(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = value.match(/^(\d+(?:\.\d+)?)(?:px)?$/)
  return match ? Number(match[1]) : undefined
}
