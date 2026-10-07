import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MEMBER_COLS, type Member } from '../lib/columns'
import { ASSIGN_COLS, dayParts, token, type Assignment } from '../lib/week'

type Row = Assignment & { completed_at: string | null; on_time: boolean | null }

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '?'

export default function ApprovalsInbox({ householdId }: { householdId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [a, m] = await Promise.all([
      supabase.from('assignments').select(ASSIGN_COLS + ',completed_at,on_time')
        .eq('household_id', householdId).eq('status', 'DONE').order('date'),
      supabase.from('members').select(MEMBER_COLS).eq('household_id', householdId),
    ])
    setRows((a.data as unknown as Row[]) ?? [])
    setMembers((m.data as Member[]) ?? [])
  }, [householdId])
  useEffect(() => { load() }, [load])

  const approve = async (id: string) => {
    setBusy(id)
    const { data, error } = await supabase.rpc('approve_assignment', { p_assignment: id })
    setBusy(null)
    setMsg(error ? error.message : `Approved, ${data} points awarded 🎉`)
    load()
  }

  return (
    <>
      <h2>Approvals</h2>
      <button onClick={load} style={{ minHeight: 48, padding: '0 14px', borderRadius: 12, border: 'none', background: '#fff' }}>🔄 Refresh</button>
      {rows.length === 0 && <p>Nothing waiting 🎉</p>}
      {rows.map((a) => {
        const m = members.find((x) => x.id === a.member_id)
        return (
          <div key={a.id} style={{ background: '#fff', borderRadius: 16, padding: 12, margin: '10px 0' }}>
            <b>{token(m)} {m?.display_name}</b>: {a.chore_name}
            <div style={{ fontSize: 14, color: '#555' }}>{dayParts(a.date).join(' ')} · effort {a.chore_effort}
              <br />Done {when(a.completed_at)} · {a.on_time ? 'on time' : '⏰ late'}
            </div>
            <button disabled={busy === a.id} onClick={() => approve(a.id)}
              style={{ minHeight: 48, marginTop: 8, padding: '0 16px', fontSize: 16, fontWeight: 700, borderRadius: 12, border: 'none', background: '#CDEFE0' }}>
              👍 Approve
            </button>
          </div>
        )
      })}
      <p>{msg}</p>
    </>
  )
}