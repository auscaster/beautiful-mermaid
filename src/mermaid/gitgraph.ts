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

/** A Mermaid git graph database as the git graph layout reads it, with Mermaid's defaults. */
export function mermaidGitGraph(db: MermaidGitGraphDb): GitGraph {
  const config = db.getConfig?.() ?? {}
  const direction = db.getDirection?.()
  return {
    title: mermaidLabel(db.getDiagramTitle?.()),
    direction: direction === 'TB' || direction === 'BT' ? direction : 'LR',
    branches: db.getBranchesAsObjArray().map((branch) => branch.name),
    commits: [...db.getCommits().values()].sort((a, b) => a.seq - b.seq).map((commit) => ({
      id: commit.id,
      message: commit.message ?? '',
      branch: commit.branch,
      parents: commit.parents.filter((parent): parent is string => !!parent),
      kind: KINDS[commit.customType ?? commit.type] ?? 'normal',
      tags: [...(commit.tags ?? [])],
      // Mermaid labels a merge only by an id it was given, and a cherry-pick never.
      labelled: commit.type !== 4 && (commit.type !== 3 || commit.customId === true),
    })),
    showBranches: config.showBranches ?? true,
    showCommitLabel: config.showCommitLabel ?? true,
    rotateCommitLabel: config.rotateCommitLabel ?? true,
    parallelCommits: config.parallelCommits ?? false,
  }
}
