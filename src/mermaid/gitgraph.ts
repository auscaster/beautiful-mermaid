// ============================================================================
// Git graphs as Mermaid's parser reads them: each commit's branch, parents,
// kind and tags, the branches in their lanes' order, the direction time runs
// and the graph's own settings.
// ============================================================================

import type { GitCommitKind, GitGraph } from '../gitgraph/types.ts'
import { mermaidLabel } from './labels.ts'

interface MermaidCommit {
  id: string
  message?: string
  seq: number
  /** Mermaid's commitType: normal 0, reverse 1, highlight 2, merge 3, cherry-pick 4. */
  type: number
  customType?: number
  customId?: boolean
  tags?: string[]
  parents: Array<string | null>
  branch: string
}

/** The git graph database Mermaid's parser fills (`getDiagramFromText(text).db`). */
export interface MermaidGitGraphDb {
  getCommits(): Map<string, MermaidCommit>
  getBranchesAsObjArray(): Array<{ name: string }>
  getDirection?(): string
  getConfig?(): { showBranches?: boolean; showCommitLabel?: boolean; rotateCommitLabel?: boolean; parallelCommits?: boolean }
  getDiagramTitle?(): string
}

const KINDS: GitCommitKind[] = ['normal', 'reverse', 'highlight', 'merge', 'cherry-pick']

/**
 * Whether Mermaid made a commit's id up: its sequence number, then seven
 * random hex digits. Mermaid records only of a merge whether its id was given.
 */
function madeUp(commit: MermaidCommit): boolean {
  return commit.customId !== true && commit.id.startsWith(`${commit.seq}-`) && /^\d+-[0-9a-f]{7}$/.test(commit.id)
}

/**
 * An id for a commit written without one, in the shape Mermaid gives it, made
 * as git makes a commit's, from the commit and its parents: the same graph is
 * drawn the same each time, where Mermaid's random id would change.
 */
function derivedId(seq: number, parts: string[]): string {
  let hash = 0x811c9dc5
  for (const char of parts.join('\0')) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193)
  return `${seq}-${(hash >>> 0).toString(16).padStart(8, '0').slice(0, 7)}`
}

/** A Mermaid git graph database as the git graph layout reads it, with Mermaid's defaults. */
export function mermaidGitGraph(db: MermaidGitGraphDb): GitGraph {
  const config = db.getConfig?.() ?? {}
  const direction = db.getDirection?.()
  const ids = new Map<string, string>()
  return {
    title: mermaidLabel(db.getDiagramTitle?.()),
    direction: direction === 'TB' || direction === 'BT' ? direction : 'LR',
    branches: db.getBranchesAsObjArray().map((branch) => branch.name),
    commits: [...db.getCommits().values()].sort((a, b) => a.seq - b.seq).map((commit) => {
      const message = commit.message ?? ''
      const kind = KINDS[commit.customType ?? commit.type] ?? 'normal'
      const parents = commit.parents.filter((parent): parent is string => !!parent).map((parent) => ids.get(parent) ?? parent)
      const id = madeUp(commit) ? derivedId(commit.seq, [message, commit.branch, kind, ...parents]) : commit.id
      ids.set(commit.id, id)
      return {
        id,
        message,
        branch: commit.branch,
        parents,
        kind,
        tags: [...(commit.tags ?? [])],
        // Mermaid labels a merge only by an id it was given, and a cherry-pick never.
        labelled: commit.type !== 4 && (commit.type !== 3 || commit.customId === true),
      }
    }),
    showBranches: config.showBranches ?? true,
    showCommitLabel: config.showCommitLabel ?? true,
    rotateCommitLabel: config.rotateCommitLabel ?? true,
    parallelCommits: config.parallelCommits ?? false,
  }
}
