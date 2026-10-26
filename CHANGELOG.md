# Changelog

## 1.1.5 - 2026-10-26

### Added

- Git graphs (`gitGraph`) from Mermaid's reading, laid out as Mermaid lays
  them out: a lane per branch in its order, commits a step apart in the order
  made or after their latest parent with `parallelCommits`, left to right, top
  to bottom or bottom to top. A branch joins its parent with a curve and a
  merge leaves the merged lane, along a lane of its own where a commit stands
  in the way. Each branch takes the next categorical colour; merges, reverts,
  highlights and cherry-picks have marks of their own, ids slant under their
  commits with a halo of the page's colour, and tags stack above them.

## 1.1.4 - 2026-10-25

The first release of `@sourcey/beautiful-mermaid`, Sourcey's fork of
[beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) 1.1.3.

### Added

- `renderMermaidDiagram(parsed, options)` draws a diagram Mermaid's own parser
  has read (`mermaid.mermaidAPI.getDiagramFromText`), so every syntax and
  directive Mermaid accepts reads as Mermaid reads it.
- Flowcharts and state diagrams are laid out as Mermaid lays them out: dagre
  with Mermaid's subgraph rules, a subgraph no edge crosses laid out on its
  own, edges to a subgraph cut at its border, and labels wrapped where Mermaid
  wraps them.
- Class and ER diagrams from Mermaid's reading: members as written,
  relationships by their ends, cardinalities, notes and namespaces; ER
  attributes tabulated with their keys and comments.
- Sequence diagrams on a timeline: actors spaced for every label between them,
  blocks sized to what they hold, activations, autonumber, participant boxes,
  rect blocks, created and destroyed participants, and Mermaid's actor symbols.
- Gantt charts, pie charts and mindmaps. Gantt axes tick and format as d3 does;
  a today marker is drawn only for a `today` the caller passes.
- `embedFonts: false` leaves out the Google Fonts import, for hosts that serve
  their own fonts.

### Changed

- Labels are measured with Inter's own advance widths, so boxes fit their text.
- Secondary and muted text meet WCAG AA contrast (5.9:1 and 5:1 on white).
- Text an author gives no colour is set in near-black or white, whichever reads
  on the author's fill.
- Pie slices and mindmap branches take eight colour-blind-checked hues in a
  fixed order, stepped for the page's light or dark scheme (CSS `light-dark()`).

### Fixed

- Class attributes written `name: Type` read as a name and a type.
- A label's blank lines keep their room, and emphasis across a line break
  stays on every line.
