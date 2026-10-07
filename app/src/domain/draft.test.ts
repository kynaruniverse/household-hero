import { describe, expect, it } from 'vitest'
import {
  assignRemaining, autoPick, createDraft, fairShares, legalCells, pick, rng, snakePlayer,
  type Category, type Cell, type Player, type Role,
} from './draft'
import cases from './fixtures/fairness.json'

const P = (id: string, role: Role): Player => ({ id, role })
const C = (id: string, effort: number, category: Category = 'FAMILY'): Cell => ({ id, effort, category })

describe('fair shares (fixtures)', () => {
  for (const t of cases) {
    it(t.name, () => {
      const players = t.roles.map((r, i) => P(`p${i}`, r as Role))
      const cells = t.cells.map(([e, cat], i) => C(`c${i}`, e as number, cat as Category))
      const shares = fairShares(players, cells)
      for (const p of players) {
        const want = p.role === 'CHILD' ? t.child : t.adult
        expect(shares[p.id]).toBeCloseTo(want as number, 5)
      }
    })
  }
})

describe('snake order', () => {
  it('goes forwards then backwards', () => {
    const seq = Array.from({ length: 9 }, (_, i) => snakePlayer(['a', 'b', 'c'], i))
    expect(seq).toEqual(['a', 'b', 'c', 'c', 'b', 'a', 'a', 'b', 'c'])
  })
})

describe('rules', () => {
  it('children cannot take adult-only cells', () => {
    const s = createDraft({
      players: [P('a', 'ADULT'), P('k', 'CHILD')],
      cells: [C('x', 2), C('y', 3, 'ADULT_ONLY'), C('z', 1)],
      loadCapPercent: 125,
      seed: 1,
    })
    expect(legalCells(s, 'k').map((c) => c.id)).not.toContain('y')
    expect(legalCells(s, 'a').map((c) => c.id)).toContain('y')
  })

  it('stops a player going over the load cap', () => {
    // total 12 between two adults: share 6, cap 7.5
    const s = createDraft({
      players: [P('a', 'ADULT'), P('b', 'ADULT')],
      cells: [C('big1', 5), C('big2', 5), C('s1', 1), C('s2', 1)],
      loadCapPercent: 125,
      seed: 1,
    })
    const first = s.current!
    const after = pick(s, first, 'big1')
    const legal = legalCells(after, first).map((c) => c.id)
    expect(legal).not.toContain('big2') // 5 + 5 = 10 > 7.5
    expect(legal).toContain('s1') // 5 + 1 = 6 <= 7.5
  })

  it('rejects a pick out of turn', () => {
    const s = createDraft({
      players: [P('a', 'ADULT'), P('b', 'ADULT')],
      cells: [C('x', 2), C('y', 2)],
      loadCapPercent: 125,
      seed: 1,
    })
    const notYou = s.current === 'a' ? 'b' : 'a'
    expect(() => pick(s, notYou, 'x')).toThrow()
  })

  it('skips a player with no legal picks', () => {
    const s = createDraft({
      players: [P('a', 'ADULT'), P('k', 'CHILD')],
      cells: [C('x', 2, 'ADULT_ONLY'), C('y', 2, 'ADULT_ONLY')],
      loadCapPercent: 125,
      seed: 3,
    })
    expect(s.current).toBe('a')
    const s2 = pick(s, 'a', 'x')
    expect(s2.current).toBe('a')
    const s3 = pick(s2, 'a', 'y')
    expect(s3.done).toBe(true)
  })

  it('hands leftovers to the lowest load', () => {
    const s = createDraft({
      players: [P('a', 'ADULT'), P('b', 'ADULT')],
      cells: [C('c1', 3), C('c2', 3), C('c3', 2), C('c4', 2)],
      loadCapPercent: 125,
      seed: 1,
    })
    const r = assignRemaining(s)
    expect(Object.keys(r.picks)).toHaveLength(4)
    expect(r.loads.a).toBe(5)
    expect(r.loads.b).toBe(5)
    expect(Object.values(r.picks).every((p) => p.source === 'AUTO')).toBe(true)
  })

  it('is repeatable with the same seed', () => {
    const args = {
      players: [P('a', 'ADULT'), P('b', 'ADULT'), P('k', 'CHILD')],
      cells: [C('x', 2), C('y', 3), C('z', 1)],
      loadCapPercent: 125,
      seed: 42,
    }
    expect(createDraft(args).order).toEqual(createDraft(args).order)
  })
})

describe('a whole auto-played draft', () => {
  it('assigns every cell and respects adult-only chores', () => {
    const r = rng(7)
    const cells: Cell[] = Array.from({ length: 24 }, (_, i) =>
      C(`c${i}`, 1 + Math.floor(r() * 5), i % 4 === 0 ? 'ADULT_ONLY' : 'FAMILY')
    )
    const players = [P('a', 'HEAD'), P('b', 'ADULT'), P('k', 'CHILD')]
    let s = createDraft({ players, cells, loadCapPercent: 125, seed: 5 })
    let guard = 0
    while (!s.done && guard++ < 200) {
      const id = autoPick(s, s.current!, guard)
      s = pick(s, s.current!, id!, 'AUTO')
    }
    expect(s.done).toBe(true)
    expect(Object.keys(s.picks)).toHaveLength(cells.length)
    for (const c of cells) {
      if (c.category === 'ADULT_ONLY') expect(s.picks[c.id].member).not.toBe('k')
    }
    const total = cells.reduce((n, c) => n + c.effort, 0)
    expect(Object.values(s.loads).reduce((n, v) => n + v, 0)).toBe(total)
  })
})