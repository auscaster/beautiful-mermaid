// ============================================================================
// Categorical colours, for charts whose marks name things: a pie's slices, a
// mindmap's branches.
//
// Eight hues in a fixed order, each stepped for light and dark pages and
// chosen between by the page's color-scheme (CSS light-dark()). The order is
// what keeps neighbours apart for colour-blind readers: every adjacent pair
// clears ΔE 8 (OKLab ×100) under protan, deutan and tritan simulation, and
// ΔE 15 for full colour vision, on white and on a #14161c dark page.
// ============================================================================

const SLOTS: ReadonlyArray<{ light: string; dark: string; ink: { light: string; dark: string } }> = [
  { light: '#2a78d6', dark: '#3987e5', ink: { light: '#ffffff', dark: '#ffffff' } }, // blue
  { light: '#eb6834', dark: '#d95926', ink: { light: '#ffffff', dark: '#ffffff' } }, // orange
  { light: '#1baf7a', dark: '#199e70', ink: { light: '#ffffff', dark: '#ffffff' } }, // aqua
  { light: '#eda100', dark: '#c98500', ink: { light: '#0b0b0b', dark: '#ffffff' } }, // yellow
  { light: '#e87ba4', dark: '#d55181', ink: { light: '#ffffff', dark: '#ffffff' } }, // magenta
  { light: '#008300', dark: '#008300', ink: { light: '#ffffff', dark: '#ffffff' } }, // green
  { light: '#6250d6', dark: '#9085e9', ink: { light: '#ffffff', dark: '#ffffff' } }, // violet
  { light: '#e34948', dark: '#e66767', ink: { light: '#ffffff', dark: '#ffffff' } }, // red
]

/** How many distinct hues there are before they repeat. */
export const CATEGORICAL_SLOTS = SLOTS.length

/**
 * The colour of the `index`th thing, in the fixed order. Past the eighth,
 * the hues repeat at a lighter mix, so a ninth slice never takes a hue of
 * its own; a legend or label names every one.
 */
export function categorical(index: number): string {
  const slot = SLOTS[index % SLOTS.length]!
  const color = `light-dark(${slot.light}, ${slot.dark})`
  return index < SLOTS.length ? color : `color-mix(in srgb, ${color} 55%, var(--bg))`
}

/** Text drawn on a categorical fill: white, or near-black on light yellow. */
export function categoricalInk(index: number): string {
  if (index >= SLOTS.length) return 'var(--_text)'
  const { ink } = SLOTS[index]!
  return ink.light === ink.dark ? ink.light : `light-dark(${ink.light}, ${ink.dark})`
}
