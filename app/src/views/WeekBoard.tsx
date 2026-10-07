import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MEMBER_COLS, type Member } from '../lib/columns'
import { CHORE_COLS, type Chore } from '../lib/chores'
import {
  ASSIGN_COLS, WEEK_COLS, dayParts, token, weekDates,
  type Assignment, type Week,
} from '../lib/week'
import GameScreen from './GameScreen'

const btn = {
  minHeight: 48, padding: '0 14px', fontSize: 16, borderRadius: 12, border: 'none', background: '#fff',
} as const

type Outcome = PromiseLike<{ data: unknown; error: { message: string } | null }>

export default function WeekBoard() {
  const [houseId, setHouseId] = useState<string | null | undefined>(undefined)
  const [offset, setOffset] = useState(0)
  const [week, setWeek] = useState<Week | null>(null)
  const [cells, setCells] = useState<Assignment[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<Assignment | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [gameOpen, setGameOpen] = useState(false)

  const loadWeek = useCallback(async (hid: string, off: number) => {
    const { data: start, error } = await supabase.rpc('get_week_start', { p_household: hid, p_offset: off })
    if (error) return setMsg(error.message)
    const { data: w } = await supabase
      .from('weeks').select(WEEK_COLS).eq('household_id', hid).eq('week_start', start).maybeSingle()
    setWeek((w as Week | null) ?? null)
    if (w) {
      const { data: a } = await supabase.from('assignments').select(ASSIGN_COLS).eq('week_id', w.id)
      setCells((a as Assignment[]) ?? [])
    } else {
      setCells([])
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      const { data: hs } = await supabase.from('households').select('id').limit(1)
      const id: string | null = hs?.[0]?.id ?? null
      setHouseId(id)
      if (!id) return
      const [{ data: ms }, { data: cs }] = await Promise.all([
        supabase.from('members').select(MEMBER_COLS).eq('household_id', id).order('display_name'),
        supabase.from('chores').select(CHORE_COLS).eq('household_id', id),
      ])
      setMembers((ms as Member[]) ?? [])
      setIcons(Object.fromEntries(((cs as Chore[]) ?? []).map((c) => [c.id, c.icon ?? '🧽'])))
    })()
  }, [])

  useEffect(() => {
    if (houseId) loadWeek(houseId, offset)
  }, [houseId, offset, loadWeek])

  const act = async (p: Outcome, ok: string | ((d: unknown) => string) = '') => {
    setBusy(true)
    const { data, error } = await p
    setBusy(false)
    setMsg(error ? error.message : typeof ok === 'function' ? ok(data) : ok)
    setPicked(null)
    if (houseId) await loadWeek(houseId, offset)
  }

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  const rows = useMemo(() => {
    const map = new Map<string, { key: string; name: string; icon: string; byDate: Record<string, Assignment> }>()
    for (const c of cells) {
      const key = c.chore_id ?? 'x:' + c.chore_name
      if (!map.has(key)) {
        map.set(key, { key, name: c.chore_name, icon: (c.chore_id && icons[c.chore_id]) || '🧽', byDate: {} })
      }
      map.get(key)!.byDate[c.date] = c
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [cells, icons])

  if (houseId === undefined) return <p>Loading…</p>
  if (houseId === null) return <p>Create your household on the Family tab first.</p>
  
  if (week && (week.status === 'DRAFTING' || (gameOpen && week.status === 'SETUP'))) {
    return (
      <GameScreen
        week={week} members={members} cells={cells}
        onExit={() => { setGameOpen(false); if (houseId) loadWeek(houseId, offset) }}
      />
    )
  }  

  const dates = week ? weekDates(week.week_start) : []
  const total = cells.reduce((s, c) => s + c.chore_effort, 0)
  const avg = members.length ? total / members.length : 0
  const loads = members.map((m) => ({
    m,
    v: cells.filter((c) => c.member_id === m.id).reduce((s, c) => s + c.chore_effort, 0),
  }))
  const open = cells.filter((c) => !c.member_id).length
  const editable = week?.status === 'SETUP' || week?.status === 'REVIEW'
  const setup = week?.status === 'SETUP'

  return (
    <div style={{ paddingBottom: picked ? 240 : 0 }}>
      <h2>Week board</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[0, 1].map((o) => (
          <button key={o} onClick={() => setOffset(o)}
            style={{ ...btn, flex: 1, background: offset === o ? '#E6DFFA' : '#fff', fontWeight: offset === o ? 700 : 400 }}>
            {o === 0 ? 'This week' : 'Next week'}
          </button>
        ))}
      </div>

      {!week && (
        <button disabled={busy} style={{ ...btn, background: '#CDEFE0', fontWeight: 700 }}
          onClick={() => act(supabase.rpc('create_week', { p_household: houseId, p_offset: offset, p_mode: 'NORMAL' }))}>
          Start this board
        </button>
      )}

      {week && (
        <>
          <p style={{ margin: '4px 0' }}>
            {week.status === 'LOCKED' ? '🔒 Locked. Everyone can see their week.'
              : open > 0 ? `${open} cell${open === 1 ? '' : 's'} still need an owner`
              : '✅ Every cell has an owner. Ready to lock.'}
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
            {loads.map(({ m, v }) => (
              <span key={m.id} style={{ padding: '6px 10px', borderRadius: 999, background: '#fff', fontSize: 14 }}>
                {token(m)} {m.display_name}: {v}{avg > 0 && v > avg * 1.25 ? ' ⚠️' : ''}
              </span>
            ))}
          </div>

          {week.status === 'REVIEW' && (
            <p style={{ background: '#E6DFFA', padding: 8, borderRadius: 10 }}>
              🎲 Draft finished. Swap any cells, then lock the week.{' '}
              <button disabled={busy} onClick={() => {
                if (confirm('Throw away this draft and start again?')) {
                  act(supabase.rpc('cancel_game', { p_week: week.id }))
                }
              }}>Redo draft</button>
            </p>
          )}
          {editable && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' }}>
              {setup && (
                <>
                  <button disabled={busy} style={btn}
                    onClick={() => act(supabase.rpc('copy_last_week', { p_week: week.id }), (d) => `Copied ${d} cells`)}>
                    📋 Copy last week
                  </button>
                  <button disabled={busy} style={btn}
                    onClick={() => act(supabase.rpc('suggest_assignments', { p_week: week.id }), (d) => `Filled ${d} cells`)}>
                    ✨ Auto-suggest
                  </button>
                  <button disabled={busy} style={btn}
                    onClick={() => {
                      if (cells.some((c) => c.member_id)) setMsg('Clear the board first (🧹), then start the game.')
                      else setGameOpen(true)
                    }}>
                    🎲 Start Game Week
                  </button>
                  <button disabled={busy} style={btn}
                    onClick={() => act(supabase.rpc('clear_board', { p_week: week.id }), 'Board cleared')}>
                    🧹 Clear board
                  </button>
                </>
              )}
              <button disabled={busy || open > 0} style={{ ...btn, background: '#CDEFE0', fontWeight: 700 }}
                onClick={() => {
                  if (confirm('Lock this week? Everyone will see their chores and cells can’t be edited.')) {
                    act(supabase.rpc('lock_week', { p_week: week.id }))
                  }
                }}>
                🔒 Lock week
              </button>
            </div>
          )}

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
                    {r.icon} {r.name}
                  </div>
                  {dates.map((d) => {
                    const c = r.byDate[d]
                    if (!c) {
                      return <div key={d} aria-label="not needed this day"
                        style={{ height: 48, borderRadius: 10, background: '#e9e4dc', opacity: 0.5 }} />
                    }
                    const m = c.member_id ? memberById.get(c.member_id) : undefined
                    return (
                      <button key={d} onClick={() => editable && setPicked(c)}
                        aria-label={`${c.chore_name} ${d}: ${m ? m.display_name : 'unassigned'}`}
                        style={{
                          height: 48, borderRadius: 10, fontSize: 22, padding: 0,
                          border: m ? `2px solid ${m.token_colour || '#cfc6e8'}` : '2px dashed #b9b0d6',
                          background: m ? '#fff' : 'transparent',
                        }}>
                        {m ? token(m) : '+'}
                      </button>
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </>
      )}

      {picked && editable && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10, padding: 16,
          background: '#fff', borderRadius: '20px 20px 0 0', boxShadow: '0 -4px 20px rgba(0,0,0,.15)',
        }}>
          <b>{picked.chore_name} · {dayParts(picked.date).join(' ')}</b>
          {picked.chore_category === 'ADULT_ONLY' && <div>🔒 Adults only</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
            {members.map((m) => {
              const blocked = picked.chore_category === 'ADULT_ONLY' && m.role === 'CHILD'
              return (
                <button key={m.id} disabled={blocked || busy}
                  onClick={() => act(supabase.rpc('assign_cell', { p_assignment: picked.id, p_member: m.id }))}
                  style={{ ...btn, border: `2px solid ${m.token_colour || '#cfc6e8'}`, opacity: blocked ? 0.4 : 1 }}>
                  {token(m)} {m.display_name}
                </button>
              )
            })}
          </div>
          <button disabled={busy} style={btn}
            onClick={() => act(supabase.rpc('assign_cell', { p_assignment: picked.id, p_member: null }))}>
            Clear
          </button>{' '}
          <button style={btn} onClick={() => setPicked(null)}>Close</button>
        </div>
      )}
      <p>{msg}</p>
    </div>
  )
}