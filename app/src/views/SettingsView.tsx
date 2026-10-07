import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Settings = { loadCapPercent?: number; turnTimeoutHours?: number; requireApproval?: boolean }

const box = { minHeight: 48, padding: '0 14px', fontSize: 16, borderRadius: 12, width: 120 } as const
const label = { display: 'block', margin: '16px 0 6px', fontWeight: 700 } as const

export default function SettingsView({ householdId }: { householdId: string }) {
  const [cap, setCap] = useState(125)
  const [hours, setHours] = useState(12)
  const [approval, setApproval] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('households').select('settings').eq('id', householdId).maybeSingle()
      .then(({ data }) => {
        const s = (data?.settings ?? {}) as Settings
        setCap(s.loadCapPercent ?? 125)
        setHours(s.turnTimeoutHours ?? 12)
        setApproval(s.requireApproval ?? true)
      })
  }, [householdId])

  const save = async () => {
    const { error } = await supabase.rpc('update_settings', {
      p_household: householdId, p_cap: cap, p_timeout: hours, p_approval: approval,
    })
    setMsg(error ? error.message : 'Saved ✅')
  }

  return (
    <>
      <h2>Settings</h2>
      <span style={label}>Load cap % (100–200)</span>
      <input type="number" value={cap} onChange={(e) => setCap(Number(e.target.value))} style={box} />
      <div style={{ fontSize: 14, color: '#555' }}>How far above their fair share anyone can go in a draft.</div>

      <span style={label}>Turn time limit (hours, 1–72)</span>
      <input type="number" value={hours} onChange={(e) => setHours(Number(e.target.value))} style={box} />
      <div style={{ fontSize: 14, color: '#555' }}>Phone-by-phone drafts only. After this, the app picks for them.</div>

      <label style={{ ...label, fontWeight: 400 }}>
        <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)}
          style={{ width: 24, height: 24, marginRight: 8 }} />
        Grown-up approves children’s chores
      </label>

      <button onClick={save} style={{ ...box, width: 'auto', background: '#CDEFE0', border: 'none', fontWeight: 700 }}>Save</button>
      <p>{msg}</p>
    </>
  )
}