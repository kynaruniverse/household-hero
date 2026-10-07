import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MEMBER_COLS, type Member } from '../lib/columns'
import {
  ASSIGN_COLS, WEEK_COLS, dayParts, token, weekDates, type Assignment, type Week,
} from '../lib/week'
import { autoPick, legalCells, type DraftState } from '../domain/draft'

type Props = { weekId: string; memberId: string; isAdult: boolean; onDone?: () => void }

const btn = {
  minHeight: 48, padding: '0 16px', fontSize: 16, borderRadius: 12, border: 'none', background: '#fff',
} as const
const bigBtn = { ...btn, minHeight: 56, width: '100%', fontSize: 18, fontWeight: 700, background: '#CDEFE0' } as const

const CSS = `
@keyframes hh-drop { 0% { transform: translateY(-48px) scale(1.7); opacity: 0 }
  60% { transform: translateY(4px) scale(.9); opacity: 1 } 100% { transform: translateY(0) scale(1) } }
@keyframes hh-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(108,92,231,.5) } 50% { box-shadow: 0 0 0 6px rgba(108,92,231,0) } }
.hh-drop { display: inline-block; animation: hh-drop .5s ease-out }
.hh-legal { animation: hh-pulse 1.4s infinite }
@media (prefers-reduced-motion: reduce) { .hh-drop, .hh-legal { animation: none } }
`

// Rebuild the draft engine's view of the world from what the server says
function toDraftState(w: Week, cells: Assignment[], members: Member[]): DraftState | null {
  if (!w.draft_players || !w.draft_order || !w.draft_shares || w.draft_cap_pct == null) return null
  const shares = w.draft_shares
  const pct = w.draft_cap_pct
  const roleOf = new Map(members.map((m) => [m.id, m.role]))
  const players = w.draft_players.map((id) => ({ id, role: roleOf.get(id) ?? ('CHILD' as const) }))
  const loads: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]))
  const picks: DraftState['picks'] = {}
  for (const c of cells) {
    if (c.member_id) {
      picks[c.id] = { member: c.member_id, source: 'DRAFT' }
      if (c.member_id in loads) loads[c.member_id] += c.chore_effort
    }
  }
  const caps: Record<string, number> = Object.fromEntries(
    players.map((p) => [p.id, ((shares[p.id] ?? 0) * pct) / 100])
  )
  return {
    players,
    cells: cells.map((c) => ({ id: c.id, effort: c.chore_effort, category: c.chore_category })),
    order: w.draft_order,
    turnIndex: w.turn_index ?? 0,
    current: w.current_member_id,
    picks, loads, shares, caps,
    done: false,
  }
}

function timeLeft(deadline: string | null, now: number): string {
  if (!deadline) return ''
  const ms = new Date(deadline).getTime() - now
  if (ms <= 0) return 'time’s up, auto-pick coming'
  const mins = Math.floor(ms / 60000)
  const h = Math.floor(mins / 60)
  return h > 0 ? `${h}h ${mins % 60}m left` : `${mins}m left`
}

export default function AsyncGame({ weekId, memberId, isAdult, onDone }: Props) {
  const [week, setWeek] = useState<Week | null>(null)
  const [cells, setCells] = useState<Assignment[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [justPlaced, setJustPlaced] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const load = useCallback(async () => {
    const { data: w } = await supabase.from('weeks').select(WEEK_COLS).eq('id', weekId).maybeSingle()
    if (!w) return
    const wk = w as Week
    setWeek(wk)
    setNow(Date.now())
    if (wk.status !== 'DRAFTING') { doneRef.current?.(); return }
    const [a, m] = await Promise.all([
      supabase.from('assignments').select(ASSIGN_COLS).eq('week_id', weekId),
      supabase.from('members').select(MEMBER_COLS).eq('household_id', wk.household_id),
    ])
    setCells((a.data as Assignment[]) ?? [])
    setMembers((m.data as Member[]) ?? [])
  }, [weekId])

  useEffect(() => {
    load()
    const kick = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(load, 300)
    }
    const ch = supabase
      .channel(`draft-${weekId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments', filter: `week_id=eq.${weekId}` }, kick)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'weeks', filter: `id=eq.${weekId}` }, kick)
      .subscribe()
    const poll = window.setInterval(load, 30000)
    const tick = window.setInterval(() => setNow(Date.now()), 30000)
    const vis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.clearTimeout(timer.current)
      supabase.removeChannel(ch)
      window.clearInterval(poll)
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [weekId, load])

  const state = useMemo(() => (week ? toDraftState(week, cells, members) : null), [week, cells, members])
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const myTurn = week?.current_member_id === memberId
  const isPlayer = !!week?.draft_players?.includes(memberId)

  const legalIds = useMemo(
    () => new Set(state && myTurn ? legalCells(state, memberId).map((c) => c.id) : []),
    [state, myTurn, memberId]
  )

  const rows = useMemo(() => {
    const map = new Map<string, { key: string; name: string; byDate: Record<string, Assignment> }>()
    for (const c of cells) {
      const k = c.chore_id ?? 'x:' + c.chore_name
      if (!map.has(k)) map.set(k, { key: k, name: c.chore_name, byDate: {} })
      map.get(k)!.byDate[c.date] = c
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [cells])

  const place = async (cellId: string) => {
    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc('pick_cell', { p_assignment: cellId })
    setBusy(false)
    setSelected(null)
    if (error) { setMsg(error.message); await load(); return }
    navigator.vibrate?.(40)
    setJustPlaced(cellId)
    await load()
    window.setTimeout(() => setJustPlaced(null), 800)
  }

  const pickForMe = () => {
    if (!state) return
    const id = autoPick(state, memberId, Date.now() % 1000000)
    if (id) place(id)
    else setMsg('No cells are available for you right now.')
  }

  const cancel = async () => {
    if (!confirm('Cancel this draft for everyone? The board goes back to empty.')) return
    const { error } = await supabase.rpc('cancel_game', { p_week: weekId })
    if (error) return setMsg(error.message)
    onDone?.()
  }

  if (!week || !state) return <p>Loading the draft…</p>

  const dates = weekDates(week.week_start)
  const turnName = memberById.get(week.current_member_id ?? '')
  const selectedCell = cells.find((c) => c.id === selected)

  return (
    <div style={{ paddingBottom: myTurn && isPlayer ? 160 : 0 }}>
      <style>{CSS}</style>
      <h3>🎲 Draft for the week of {dayParts(week.week_start).join(' ')}</h3>

      <div style={{ padding: 12, borderRadius: 16, background: myTurn ? '#E6DFFA' : '#fff', fontSize: 17 }}>
        {myTurn
          ? <>👉 <b>Your turn!</b> Tap a glowing cell. <span style={{ fontSize: 14 }}>({timeLeft(week.turn_deadline, now)})</span></>
          : <>⏳ Waiting for {token(turnName)} <b>{turnName?.display_name}</b> <span style={{ fontSize: 14 }}>({timeLeft(week.turn_deadline, now)})</span></>}
        {!isPlayer && <div style={{ fontSize: 14 }}>You’re watching this one.</div>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
        {state.players.map((p) => {
          const m = memberById.get(p.id)
          return (
            <span key={p.id} style={{ padding: '6px 10px', borderRadius: 999, background: '#fff', fontSize: 14 }}>
              {p.id === week.current_member_id ? '👉 ' : ''}{token(m)} {m?.display_name}: {state.loads[p.id]} / {Math.floor(state.caps[p.id] * 10) / 10}
            </span>
          )
        })}
      </div>

      <div style={{ overflowX: 'auto', margin: '12px -24px', padding: '0 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '104px repeat(7, 56px)', gap: 4, width: 'max-content', alignItems: 'center' }}>
          <div />
          {dates.map((d) => {
            const [wd, n] = dayParts(d)
            return <div key={d} style={{ textAlign: 'center', fontSize: 13 }}><b>{wd}</b><br />{n}</div>
          })}
          {rows.map((r) => (
            <Fragment key={r.key}>
              <div style={{ fontSize: 14, position: 'sticky', left: 0, zIndex: 1, background: '#FFF9F0', padding: '4px 4px 4px 0' }}>
                {r.name}
              </div>
              {dates.map((d) => {
                const c = r.byDate[d]
                if (!c) {
                  return <div key={d} aria-label="not needed this day"
                    style={{ height: 48, borderRadius: 10, background: '#e9e4dc', opacity: 0.5 }} />
                }
                const owner = c.member_id ? memberById.get(c.member_id) : undefined
                const legal = !owner && legalIds.has(c.id)
                const sel = selected === c.id
                return (
                  <button key={d} disabled={!legal || busy}
                    className={legal ? 'hh-legal' : undefined}
                    onClick={() => setSelected(c.id)}
                    aria-label={`${c.chore_name} ${d}: ${owner ? owner.display_name : legal ? 'free, you can take it' : 'free'}`}
                    style={{
                      height: 48, borderRadius: 10, fontSize: 22, padding: 0,
                      border: owner ? `2px solid ${owner.token_colour || '#cfc6e8'}`
                        : sel ? '3px solid #6c5ce7' : legal ? '2px solid #6c5ce7' : '2px dashed #cfc6e8',
                      background: sel ? '#E6DFFA' : owner ? '#fff' : 'transparent',
                      opacity: myTurn && !owner && !legal ? 0.35 : 1,
                    }}>
                    {owner ? <span className={justPlaced === c.id ? 'hh-drop' : undefined}>{token(owner)}</span>
                      : sel ? '👆' : ''}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {myTurn && isPlayer && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10, padding: 16,
          background: '#fff', borderRadius: '20px 20px 0 0', boxShadow: '0 -4px 20px rgba(0,0,0,.15)',
        }}>
          {selectedCell ? (
            <button disabled={busy} style={bigBtn} onClick={() => place(selectedCell.id)}>
              Place my token: {selectedCell.chore_name} · {dayParts(selectedCell.date).join(' ')}
            </button>
          ) : (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>Pick a cell…</div>
          )}
          <button disabled={busy} style={{ ...btn, marginTop: 8, background: '#f3f0fa' }} onClick={pickForMe}>
            🎲 Pick for me
          </button>
        </div>
      )}

      {isAdult && (
        <p><button style={{ ...btn, color: '#b00020' }} onClick={cancel}>Cancel draft</button></p>
      )}
      <p>{msg}</p>
    </div>
  )
}