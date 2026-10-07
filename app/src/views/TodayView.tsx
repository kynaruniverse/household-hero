import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ASSIGN_COLS, dayParts, type Assignment } from '../lib/week'
import {
  cacheGet, cachePut, clearRejections, flushOutbox, getRejections, pendingIds, queueDone,
} from '../lib/offline'

type Row = Assignment & { points_awarded: number }
type Snapshot = { today: string; rows: Row[]; points: number }

function prevDay(iso: string) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default function TodayView({ householdId, memberId }: { householdId: string; memberId: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [offline, setOffline] = useState(false)
  const [queued, setQueued] = useState<Set<string>>(new Set())
  const [rejections, setRejections] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const syncLocal = useCallback(async () => {
    setQueued(await pendingIds())
    setRejections(await getRejections())
  }, [])

  const load = useCallback(async () => {
    const key = `today:${memberId}`
    try {
      const { data: today, error: e1 } = await supabase.rpc('household_today', { p_household: householdId })
      if (e1 || !today) throw e1 ?? new Error('no date')
      const [rowsRes, meRes] = await Promise.all([
        supabase.from('assignments').select(ASSIGN_COLS + ',points_awarded')
          .eq('member_id', memberId).gte('date', prevDay(today)).lte('date', today).order('date', { ascending: false }),
        supabase.from('members').select('total_points').eq('id', memberId).maybeSingle(),
      ])
      if (rowsRes.error || meRes.error) throw rowsRes.error ?? meRes.error
      const s: Snapshot = {
        today, rows: (rowsRes.data as unknown as Row[]) ?? [], points: meRes.data?.total_points ?? 0,
      }
      await cachePut(key, s)
      setSnap(s)
      setOffline(false)
    } catch {
      const cached = await cacheGet<Snapshot>(key)
      if (cached) { setSnap(cached); setOffline(true) }
      else setMsg("Can't load your chores. Check your connection.")
    }
    await syncLocal()
  }, [householdId, memberId, syncLocal])

  useEffect(() => {
    const refresh = async () => { await flushOutbox(); await load() }
    refresh()
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    const onOutbox = () => { syncLocal() }
    window.addEventListener('online', refresh)
    window.addEventListener('outbox-changed', onOutbox)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('outbox-changed', onOutbox)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load, syncLocal])

  const markDone = async (a: Row) => {
    setBusy(a.id)
    setMsg('')
    const at = new Date().toISOString()
    if (navigator.onLine) {
      const { data, error } = await supabase.rpc('complete_assignment', {
        p_assignment: a.id, p_client_completed_at: at,
      })
      if (!error) {
        navigator.vibrate?.(40)
        const r = data as { status: string; points: number }
        setMsg(r.status === 'APPROVED' ? `+${r.points} points! 🎉` : 'Nice one! Waiting for a grown-up to approve ⏳')
        setBusy(null)
        await load()
        return
      }
      if (error.code) { // a real rejection from the server
        setMsg(error.message)
        setBusy(null)
        return
      }
    }
    // offline, or the network dropped mid-request: keep it on the phone and sync later
    await queueDone({ assignment_id: a.id, client_completed_at: at, chore_name: a.chore_name })
    navigator.vibrate?.(40)
    setMsg('Saved on this phone. It will sync when you’re back online.')
    setBusy(null)
  }

  if (!snap) return <p>{msg || 'Loading…'}</p>

  const rows = snap.rows.filter((r) => r.status !== 'OPEN' && r.status !== 'SKIPPED')

  return (
    <>
      <h2>Today</h2>
      <p style={{ fontSize: 20 }}>⭐ {snap.points} points</p>
      {offline && <p style={{ background: '#FFF1B8', padding: 8, borderRadius: 10 }}>📴 Offline. Showing your last saved chores.</p>}
      {rejections.map((r, i) => (
        <p key={i} style={{ background: '#FFD9D9', padding: 8, borderRadius: 10 }}>
          ⚠️ Couldn’t save: {r}{' '}
          <button onClick={async () => { await clearRejections(); syncLocal() }}>OK</button>
        </p>
      ))}
      {rows.length === 0 && <p>No chores today 🎉</p>}
      {rows.map((a) => {
        const late = a.status === 'PENDING' && a.date < snap.today
        const waiting = queued.has(a.id)
        return (
          <div key={a.id} style={{ background: '#fff', borderRadius: 16, padding: 12, margin: '10px 0' }}>
            <b style={{ fontSize: 18 }}>{a.chore_name}</b>
            <div style={{ fontSize: 14, color: '#555' }}>
              {a.date === snap.today ? 'Today' : `${dayParts(a.date).join(' ')} (yesterday)`} · effort {a.chore_effort}
              {late && ' · late = half points'}
            </div>
            <div style={{ marginTop: 8 }}>
              {waiting ? <span>⏳ Waiting to sync</span>
                : a.status === 'PENDING' || (a.status === 'MISSED' && a.date >= prevDay(snap.today)) ? (
                  <button disabled={busy === a.id} onClick={() => markDone(a)}
                    style={{ minHeight: 56, width: '100%', fontSize: 20, fontWeight: 700, borderRadius: 14, border: 'none', background: '#CDEFE0' }}>
                    ✅ Done
                  </button>
                ) : a.status === 'DONE' ? <span>⏳ Waiting for approval</span>
                : a.status === 'APPROVED' ? <span>✅ +{a.points_awarded} points</span>
                : <span>😬 Missed</span>}
            </div>
          </div>
        )
      })}
      <p>{msg}</p>
    </>
  )
}