// ============================================================================
// Git graph types
// ============================================================================

export type GitCommitKind = 'normal' | 'reverse' | 'highlight' | 'merge' | 'cherry-pick'

export interface GitCommit {
  id: string
  /** The message it was committed with, for its tooltip; Mermaid draws none. */
  message: string
  branch: string
  /** Its parents' ids, its own branch's first. */
  parents: string[]
  kind: GitCommitKind
  /** Tags in the order written; the last stands nearest the commit. */
  tags: string[]
  /** Whether its id shows beside it: a merge's only when it was given one, a cherry-pick's never. */
  labelled: boolean
}

export interface GitGraph {
  title: string
  /** Time runs left to right (`LR`), top to bottom (`TB`) or bottom to top (`BT`). */
  direction: 'LR' | 'TB' | 'BT'
  /** Branches in the order their lanes stand. */
  branches: string[]
  /** Commits in the order they were made. */
  commits: GitCommit[]
  showBranches: boolean
  showCommitLabel: boolean
  rotateCommitLabel: boolean
  /** Each commit one step after its latest parent, rather than one after the commit made before it. */
  parallelCommits: boolean
}

export interface PositionedGitCommit extends GitCommit {
  x: number
  y: number
  /** Its branch's place in the fixed colour order. */
  color: number
  /** Where its id sits: centred on (x, y), or ending there and slanting down to the left. */
  label?: { x: number; y: number; anchor: 'middle' | 'end'; slant: boolean }
}

export interface PositionedGitTag {
  text: string
  /** The tag's box, which points left, toward its commit or its lane. */
  x: number
  y: number
  width: number
  height: number
}

export interface PositionedGitGraph {
  width: number
  height: number
  title?: { text: string; x: number; y: number }
  lanes: Array<{ x1: number; y1: number; x2: number; y2: number; color: number }>
  branchLabels: Array<{ name: string; x: number; y: number; width: number; height: number; color: number }>
  /** Each parent to child connection, as a path, in the colour of the branch it belongs to. */
  arrows: Array<{ d: string; color: number }>
  commits: PositionedGitCommit[]
  tags: PositionedGitTag[]
}
