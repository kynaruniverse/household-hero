import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Member } from '../lib/columns'
import { cacheGet, cachePut } from '../lib/offline'
import { dayParts, token, weekDates, type Assignment, type Week } from '../lib/week'
import { autoPick, createDraft, legalCells, pick, type DraftState } from '../domain/draft'

type Phase = 'loading' | 'lobby' | 'handoff' | 'turn' | 'finished' | 'lost'
type Props = { week: Week; members: Member[]; cells: Assignment[]; onExit: () => void }

const btn = {
  minHeight: 48, padding: '0 16px', fontSize: 16, borderRadius: 12, border: 'none', background: '#fff',
} as const
const bigBtn = { ...btn, minHeight: 56, width: '100%', fontSize: 20, fontWeight: 700, background: '#CDEFE0' } as const

const CSS = `
@keyframes hh-drop { 0% { transform: translateY(-48px) scale(1.7); opacity: 0 }
  60% { transform: translateY(4px) scale(.9); opacity: 1 } 100% { transform: translateY(0) scale(1) } }
@keyframes hh-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(108,92,231,.5) } 50% { box-shadow: 0 0 0 6px rgba(108,92,231,0) } }
.hh-drop { display: inline-block; animation: hh-drop .5s ease-out }
.hh-legal { animation: hh-pulse 1.4s infinite }
@media (prefers-reduced-motion: reduce) { .hh-drop, .hh-legal { animation: none } }
`

export default function GameScreen({ week, members, cells, onExit }: Props) {
  const key = `draft:${week.id}`
  const [phase, setPhase] = useState<Phase>('loading')
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [chosen, setChosen] = useState<string[]>(members.map((m) => m.id))
  const [active, setActive] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [justPlaced, setJustPlaced] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [joined, setJoined] = useState<Set<string>>(new Set())

  useEffect(() => {
    ;(async () => {
      const saved = await cacheGet<DraftState | null>(key)
      if (saved && week.status === 'DRAFTING') {
        setDraft(saved)
        setPhase(saved.done ? 'finished' : 'handoff')
      } else if (week.status === 'DRAFTING') setPhase('lost')
      else setPhase('lobby')
    })()
  }, [key, week.status])
  
  useEffect(() => {
    supabase.from('members').select('id,auth_uid').eq('household_id', week.household_id)
      .then(({ data }) =>
        setJoined(new Set((data ?? []).filter((m) => m.auth_uid).map((m) => m.id as string))))
  }, [week.household_id])  

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const dates = weekDates(week.week_start)

  const rows = useMemo(() => {
    const map = new Map<string, { key: string; name: string; byDate: Record<string, Assignment> }>()
    for (const c of cells) {
      const k = c.chore_id ?? 'x:' + c.chore_name
      if (!map.has(k)) map.set(k, { key: k, name: c.chore_name, byDate: {} })
      map.get(k)!.byDate[c.date] = c
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [cells])

  const legalIds = useMemo(
    () => new Set(draft && active ? legalCells(draft, active).map((c) => c.id) : []),
    [draft, active]
  )

  const start = async () => {
    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc('start_game', { p_week: week.id, p_players: chosen })
    if (error) { setBusy(false); return setMsg(error.message) }
    const { data: hh } = await supabase.from('households').select('settings').eq('id', week.household_id).maybeSingle()
    const cap = Number((hh?.settings as { loadCapPercent?: number } | undefined)?.loadCapPercent ?? 125)
    const players = members.filter((m) => chosen.includes(m.id)).map((m) => ({ id: m.id, role: m.role }))
    const open = cells.map((c) => ({ id: c.id, effort: c.chore_effort, category: c.chore_category }))
    const s = createDraft({ players, cells: open, loadCapPercent: cap, seed: Math.floor(Math.random() * 2 ** 31) })
    await cachePut(key, s)
    setDraft(s)
    setPhase(s.done ? 'finished' : 'handoff')
    setBusy(false)
  }

  const startAsync = async () => {
    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc('start_async_game', { p_week: week.id, p_players: chosen })
    setBusy(false)
    if (error) return setMsg(error.message)
    onExit()
  }

  const place = async (cellId: string, source: 'DRAFT' | 'AUTO') => {
    if (!draft || !active) return
    try {
      const next = pick(draft, active, cellId, source)
      navigator.vibrate?.(40)
      setJustPlaced(cellId)
      setSelected(null)
      setDraft(next)
      await cachePut(key, next)
      setTimeout(() => {
        setJustPlaced(null)
        setPhase(next.done ? 'finished' : 'handoff')
      }, 700)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const submit = async () => {
    if (!draft) return
    setBusy(true)
    const picks = Object.entries(draft.picks).map(([assignment, v]) => ({
      assignment, member: v.member, source: v.source,
    }))
    const { error } = await supabase.rpc('submit_board', { p_week: week.id, p_picks: picks })
    setBusy(false)
    if (error) return setMsg(error.message)
    await cachePut(key, null)
    onExit()
  }

  const cancel = async () => {
    if (!confirm('Cancel this game? Nothing is saved and the board goes back to empty.')) return
    const { error } = await supabase.rpc('cancel_game', { p_week: week.id })
    if (error) return setMsg(error.message)
    await cachePut(key, null)
    onExit()
  }

  const chips = draft && (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
      {draft.players.map((p) => {
        const m = memberById.get(p.id)
        return (
          <span key={p.id} style={{ padding: '6px 10px', borderRadius: 999, background: '#fff', fontSize: 14 }}>
            {token(m)} {m?.display_name}: {draft.loads[p.id]} / {Math.floor(draft.caps[p.id] * 10) / 10}
          </span>
        )
      })}
    </div>
  )

  const renderBoard = (interactive: boolean) => (
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
              const info = draft?.picks[c.id]
              const owner = info ? memberById.get(info.member) : undefined
              const legal = interactive && !info && legalIds.has(c.id)
              const sel = selected === c.id
              return (
                <button key={d} disabled={!legal || justPlaced !== null}
                  className={legal ? 'hh-legal' : undefined}
                  onClick={() => setSelected(c.id)}
                  aria-label={`${c.chore_name} ${d}: ${owner ? owner.display_name : legal ? 'free, you can take it' : 'free'}`}
                  style={{
                    height: 48, borderRadius: 10, fontSize: 22, padding: 0,
                    border: owner ? `2px solid ${owner.token_colour || '#cfc6e8'}`
                      : sel ? '3px solid #6c5ce7' : legal ? '2px solid #6c5ce7' : '2px dashed #cfc6e8',
                    background: sel ? '#E6DFFA' : owner ? '#fff' : 'transparent',
                    opacity: interactive && !owner && !legal ? 0.35 : 1,
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
  )

  const activeMember = active ? memberById.get(active) : undefined
  const nextMember = draft?.current ? memberById.get(draft.current) : undefined
  const selectedCell = cells.find((c) => c.id === selected)
  const remaining = draft ? draft.cells.length - Object.keys(draft.picks).length : 0

  return (
    <div style={{ paddingBottom: phase === 'turn' ? 150 : 0 }}>
      <style>{CSS}</style>
      <h2>🎲 Game week</h2>

      {phase === 'loading' && <p>Loading…</p>}

      {phase === 'lobby' && (
        <>
          <p>Who’s playing? (at least 2)</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {members.map((m) => {
              const on = chosen.includes(m.id)
              return (
                <button key={m.id}
                  onClick={() => setChosen(on ? chosen.filter((x) => x !== m.id) : [...chosen, m.id])}
                  style={{ ...btn, border: `3px solid ${on ? '#6c5ce7' : '#e0dcea'}`, fontWeight: on ? 700 : 400 }}>
                  {token(m)} {m.display_name}{joined.has(m.id) ? '' : ' ⚠️'}
                </button>
              )
            })}
          </div>
          <p style={{ fontSize: 14 }}>
            ⚠️ = hasn’t joined on their own phone yet. Fine for pass-and-play, but in a phone-by-phone game their turns get auto-picked.
          </p>
          <p style={{ margin: '16px 0 8px' }}>
            Take turns picking a cell. Children can’t pick adult-only chores, and nobody can take far more than their fair share.
          </p>
          <button disabled={busy || chosen.length < 2} style={bigBtn} onClick={start}>🎲 Pass-and-play (one phone)</button>
          <button disabled={busy || chosen.length < 2} style={{ ...bigBtn, marginTop: 8, background: '#E6DFFA' }} onClick={startAsync}>
            📱 Everyone on their own phone
          </button>
          <button style={{ ...btn, marginTop: 8 }} onClick={onExit}>Back</button>
        </>
      )}

      {phase === 'handoff' && draft && (
        <>
          <div style={{ textAlign: 'center', padding: 24, background: '#fff', borderRadius: 20 }}>
            <div style={{ fontSize: 64 }}>{token(nextMember)}</div>
            <h2>Pass the phone to {nextMember?.display_name}</h2>
            <p>{remaining} cell{remaining === 1 ? '' : 's'} left to give out</p>
            <button style={bigBtn} onClick={() => { setActive(draft.current); setSelected(null); setMsg(''); setPhase('turn') }}>
              I’m {nextMember?.display_name}, start my turn
            </button>
          </div>
          {chips}
          {renderBoard(false)}
        </>
      )}

      {phase === 'turn' && draft && (
        <>
          <div style={{ padding: 12, background: '#E6DFFA', borderRadius: 16, fontSize: 18 }}>
            {token(activeMember)} <b>{activeMember?.display_name}’s turn</b>. Tap a glowing cell.
          </div>
          {chips}
          {renderBoard(true)}
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10, padding: 16,
            background: '#fff', borderRadius: '20px 20px 0 0', boxShadow: '0 -4px 20px rgba(0,0,0,.15)',
          }}>
            {selectedCell ? (
              <button disabled={justPlaced !== null} style={bigBtn} onClick={() => place(selectedCell.id, 'DRAFT')}>
                Place my token: {selectedCell.chore_name} · {dayParts(selectedCell.date).join(' ')}
              </button>
            ) : (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>Pick a cell…</div>
            )}
            <button disabled={justPlaced !== null} style={{ ...btn, marginTop: 8, background: '#f3f0fa' }}
              onClick={() => {
                if (!draft || !active) return
                const id = autoPick(draft, active, Date.now() % 1000000)
                if (id) place(id, 'AUTO')
              }}>
              🎲 Pick for me
            </button>
          </div>
        </>
      )}

      {phase === 'finished' && draft && (
        <>
          <h3>🎉 Board complete!</h3>
          <p>
            {remaining > 0
              ? `${remaining} cell${remaining === 1 ? '' : 's'} couldn’t be given out. You can assign them in review.`
              : 'Every chore has an owner.'}
          </p>
          {chips}
          {renderBoard(false)}
          <button disabled={busy} style={bigBtn} onClick={submit}>Send to review</button>
        </>
      )}

      {phase === 'lost' && (
        <>
          <p>This game was started on another device, or its data was cleared on this phone. You can cancel it and start again.</p>
        </>
      )}

      {(phase === 'handoff' || phase === 'turn' || phase === 'finished' || phase === 'lost') && (
        <p><button style={{ ...btn, color: '#b00020' }} onClick={cancel}>Cancel game</button></p>
      )}
      <p>{msg}</p>
    </div>
  )
}