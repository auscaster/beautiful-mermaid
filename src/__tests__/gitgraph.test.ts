/**
 * Git graphs as Mermaid's parser reads them, written the way Mermaid 12
 * hands them over, so these run without Mermaid.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidDiagram } from '../index.ts'
import { mermaidGitGraph, type MermaidGitGraphDb } from '../mermaid/gitgraph.ts'
import { layoutGitGraph } from '../gitgraph/layout.ts'

type Commit = { id: string; branch: string; parents?: string[]; type?: number; customId?: boolean; tags?: string[]; message?: string }
const db = (branches: string[], commits: Commit[], extra: Partial<Record<keyof MermaidGitGraphDb, () => unknown>> = {}) => ({
  getCommits: () => new Map(commits.map((commit, seq) => [commit.id, { message: '', type: 0, tags: [], parents: [], ...commit, seq }])),
  getBranchesAsObjArray: () => branches.map((name) => ({ name })),
  getDirection: () => 'LR',
  getConfig: () => ({}),
  getDiagramTitle: () => '',
  ...extra,
}) as unknown as MermaidGitGraphDb

// main: 1 → 2 → merge; feature branches from 1, commits f1, merges into main.
const FEATURE = db(['main', 'feature'], [
  { id: '1', branch: 'main' },
  { id: 'f1', branch: 'feature', parents: ['1'] },
  { id: '2', branch: 'main', parents: ['1'], tags: ['v1', 'v2'] },
  { id: 'M', branch: 'main', parents: ['2', 'f1'], type: 3 },
])

describe('Mermaid git graphs', () => {
  it("read each commit's kind and labels as Mermaid draws them, with Mermaid's defaults", () => {
    const graph = mermaidGitGraph(db(['main'], [
      { id: 'a', branch: 'main' },
      { id: 'b', branch: 'main', parents: ['a'], type: 3 },
      { id: 'c', branch: 'main', parents: ['b'], type: 3, customId: true },
      { id: 'd', branch: 'main', parents: ['c'], type: 4 },
      { id: 'e', branch: 'main', parents: ['d', null as unknown as string], type: 0, customType: 2 } as Commit,
    ]))
    expect(graph.commits.map((commit) => [commit.id, commit.kind, commit.labelled])).toEqual([
      ['a', 'normal', true], ['b', 'merge', false], ['c', 'merge', true], ['d', 'cherry-pick', false], ['e', 'highlight', true],
    ])
    expect(graph.commits[4]!.parents).toEqual(['d'])
    expect([graph.direction, graph.showBranches, graph.showCommitLabel, graph.rotateCommitLabel, graph.parallelCommits]).toEqual(['LR', true, true, true, false])
  })

  it('step commits along time in the order made, a lane per branch, joining a branch from its parent and merging it back', () => {
    const graph = layoutGitGraph(mermaidGitGraph(FEATURE))
    const at = Object.fromEntries(graph.commits.map((commit) => [commit.id, [commit.x, commit.y]])) as Record<string, [number, number]>
    expect(at['f1']![0]! - at['1']![0]!).toBe(44)
    expect(at['M']![0]! - at['1']![0]!).toBe(132)
    expect(at['f1']![1]! - at['1']![1]!).toBe(44)
    const [x1, y1] = at['1']!, [xf, yf] = at['f1']!, [xm, ym] = at['M']!
    // Into the branch: down from its parent, then along its lane. Back: along it, then up into the merge.
    expect(graph.arrows.map((arrow) => [arrow.d, arrow.color])).toEqual([
      [`M ${x1} ${y1} L ${x1} ${yf - 14} Q ${x1} ${yf} ${x1 + 14} ${yf} L ${xf} ${yf}`, 1],
      [`M ${x1} ${y1} L ${at['2']![0]} ${at['2']![1]}`, 0],
      [`M ${at['2']![0]} ${at['2']![1]} L ${xm} ${ym}`, 0],
      [`M ${xf} ${yf} L ${xm - 14} ${yf} Q ${xm} ${yf} ${xm} ${yf - 14} L ${xm} ${ym}`, 1],
    ])
    // Tags stack above their commit, the last written nearest it.
    expect(graph.tags.map((tag) => tag.text)).toEqual(['v2', 'v1'])
    expect(graph.tags[0]!.y).toBeGreaterThan(graph.tags[1]!.y)
  })

  it("take a lane of their own past a commit the curve would cross, and a step after their latest parent with parallelCommits", () => {
    const rerouted = layoutGitGraph(mermaidGitGraph(db(['main', 'side'], [
      { id: '1', branch: 'main' },
      { id: 's1', branch: 'side', parents: ['1'] },
      { id: 's2', branch: 'side', parents: ['s1'] },
      { id: 'M', branch: 'main', parents: ['1', 's1'], type: 3 },
    ])))
    const lanes = rerouted.lanes.map((lane) => lane.y1)
    const merge = rerouted.arrows[rerouted.arrows.length - 1]!.d
    // s2 stands on the merged lane between s1 and the merge, so the curve runs between the lanes.
    expect(merge).toContain(` ${(lanes[0]! + lanes[1]!) / 2} `)
    const parallel = layoutGitGraph(mermaidGitGraph(db(['main', 'a'], [
      { id: '1', branch: 'main' },
      { id: 'a1', branch: 'a', parents: ['1'] },
      { id: '2', branch: 'main', parents: ['1'] },
    ], { getConfig: () => ({ parallelCommits: true }) })))
    const x = Object.fromEntries(parallel.commits.map((commit) => [commit.id, commit.x]))
    expect(x['a1']).toBe(x['2'])
  })

  it('stand vertical lanes far enough apart for their names, and run time upwards bottom to top', () => {
    const vertical = (direction: string) => layoutGitGraph(mermaidGitGraph(db(['main', 'a-rather-long-branch'], [
      { id: '1', branch: 'main' },
      { id: '2', branch: 'a-rather-long-branch', parents: ['1'] },
    ], { getDirection: () => direction })))
    const down = vertical('TB')
    const [main, long] = down.branchLabels
    expect(long!.x - (main!.x + main!.width)).toBeCloseTo(8)
    expect(down.commits[1]!.y).toBeGreaterThan(down.commits[0]!.y)
    const up = vertical('BT')
    expect(up.commits[1]!.y).toBeLessThan(up.commits[0]!.y)
    expect(up.branchLabels[0]!.y).toBeGreaterThan(up.commits[0]!.y)
  })

  it('draw each kind of commit, its id haloed in the page colour, and its message on hover', () => {
    const svg = renderMermaidDiagram({ type: 'gitGraph', db: db(['main'], [
      { id: 'a', branch: 'main', message: 'Start' },
      { id: 'b', branch: 'main', parents: ['a'], type: 1 },
      { id: 'c', branch: 'main', parents: ['b'], type: 2 },
    ]) })
    expect(svg).toContain('<title>a on main: Start</title>')
    expect(svg).toContain('class="git-commit git-commit-reverse"')
    expect(svg).toMatch(/class="git-commit git-commit-highlight"[^]*?<rect /)
    expect(svg).toContain('paint-order="stroke"')
    expect(svg).toContain('>main</text>')
  })
})
