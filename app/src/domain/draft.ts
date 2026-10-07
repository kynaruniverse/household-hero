export type Role = 'HEAD' | 'ADULT' | 'CHILD'
export type Category = 'FAMILY' | 'ADULT_ONLY'
export type Player = { id: string; role: Role }
export type Cell = { id: string; effort: number; category: Category }
export type Source = 'DRAFT' | 'AUTO'

export type DraftState = {
  players: Player[]
  cells: Cell[]
  order: string[] // shuffled player ids
  turnIndex: number // position in the snake sequence
  current: string | null // whose turn it is (null when finished)
  picks: Record<string, { member: string; source: Source }>
  loads: Record<string, number>
  shares: Record<string, number>
  caps: Record<string, number>
  done: boolean
}

const EPS = 1e-9
const isAdult = (p: Player) => p.role !== 'CHILD'
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

// Small seeded random generator so tests are repeatable
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: T[], seed: number): T[] {
  const r = rng(seed)
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

// 1,2,3 -> 1 2 3 3 2 1 1 2 3 3 2 1 ...
export function snakePlayer(order: string[], index: number): string {
  const n = order.length
  const round = Math.floor(index / n)
  const pos = index % n
  return round % 2 === 0 ? order[pos] : order[n - 1 - pos]
}

// Adult-only effort is split between adults. Family effort then tops up whoever is
// lowest (children first), so overall loads end up as equal as possible.
export function fairShares(players: Player[], cells: Cell[]): Record<string, number> {
  const adults = players.filter(isAdult).length
  const kids = players.length - adults
  const family = sum(cells.filter((c) => c.category === 'FAMILY').map((c) => c.effort))
  const adultOnly = adults > 0
    ? sum(cells.filter((c) => c.category === 'ADULT_ONLY').map((c) => c.effort))
    : 0

  let adultLevel = 0
  let kidLevel = 0
  if (adults > 0 && kids > 0) {
    const base = adultOnly / adults
    const gap = base * kids // effort needed to lift every child to the adults' level
    if (family <= gap) {
      adultLevel = base
      kidLevel = family / kids
    } else {
      adultLevel = kidLevel = base + (family - gap) / players.length
    }
  } else if (adults > 0) {
    adultLevel = (adultOnly + family) / adults
  } else if (kids > 0) {
    kidLevel = family / kids
  }

  return Object.fromEntries(players.map((p) => [p.id, isAdult(p) ? adultLevel : kidLevel]))
}

export function openCells(s: DraftState): Cell[] {
  return s.cells.filter((c) => !s.picks[c.id])
}

export function legalCells(s: DraftState, playerId: string): Cell[] {
  const p = s.players.find((x) => x.id === playerId)
  if (!p) return []
  return openCells(s).filter(
    (c) =>
      (c.category === 'FAMILY' || isAdult(p)) &&
      s.loads[p.id] + c.effort <= s.caps[p.id] + EPS
  )
}

// Anything the cap blocked is handed to the least-loaded eligible person
export function assignRemaining(s: DraftState): DraftState {
  const loads = { ...s.loads }
  const picks = { ...s.picks }
  const open = s.cells.filter((c) => !picks[c.id]).sort((a, b) => b.effort - a.effort)
  for (const c of open) {
    const eligible = s.players.filter((p) => c.category === 'FAMILY' || isAdult(p))
    if (eligible.length === 0) continue
    let best = eligible[0]
    for (const p of eligible) if (loads[p.id] < loads[best.id]) best = p
    picks[c.id] = { member: best.id, source: 'AUTO' }
    loads[best.id] += c.effort
  }
  return { ...s, picks, loads }
}

function finish(s: DraftState): DraftState {
  return { ...assignRemaining(s), current: null, done: true }
}

// Move to the next player in snake order who still has a legal cell. Players with
// none are skipped. 2n steps is enough to see every player at least once.
export function advance(s: DraftState): DraftState {
  if (openCells(s).length === 0) return finish(s)
  const n = s.order.length
  for (let step = 1; step <= 2 * n; step++) {
    const idx = s.turnIndex + step
    const id = snakePlayer(s.order, idx)
    if (legalCells(s, id).length > 0) return { ...s, turnIndex: idx, current: id }
  }
  return finish(s)
}

export function createDraft(a: {
  players: Player[]
  cells: Cell[]
  loadCapPercent: number
  seed: number
}): DraftState {
  const shares = fairShares(a.players, a.cells)
  const caps = Object.fromEntries(
    Object.entries(shares).map(([id, v]) => [id, (v * a.loadCapPercent) / 100])
  )
  const start: DraftState = {
    players: a.players,
    cells: a.cells,
    order: shuffle(a.players.map((p) => p.id), a.seed),
    turnIndex: -1,
    current: null,
    picks: {},
    loads: Object.fromEntries(a.players.map((p) => [p.id, 0])),
    shares,
    caps,
    done: false,
  }
  return advance(start)
}

export function pick(s: DraftState, playerId: string, cellId: string, source: Source = 'DRAFT'): DraftState {
  if (s.done) throw new Error('The draft is finished')
  if (s.current !== playerId) throw new Error('Not your turn')
  const cell = openCells(s).find((c) => c.id === cellId)
  if (!cell) throw new Error('That cell is already taken')
  if (!legalCells(s, playerId).some((c) => c.id === cellId)) throw new Error('You can’t take that one')
  return advance({
    ...s,
    picks: { ...s.picks, [cellId]: { member: playerId, source } },
    loads: { ...s.loads, [playerId]: s.loads[playerId] + cell.effort },
  })
}

// Pick the legal cell that lands the player closest to their fair share; ties are random.
export function autoPick(s: DraftState, playerId: string, seed: number): string | null {
  const legal = legalCells(s, playerId)
  if (legal.length === 0) return null
  const gap = (c: Cell) => Math.abs(s.loads[playerId] + c.effort - s.shares[playerId])
  const best = Math.min(...legal.map(gap))
  const pool = legal.filter((c) => gap(c) <= best + EPS)
  const r = rng(seed + Object.keys(s.picks).length)
  return pool[Math.floor(r() * pool.length)].id
}