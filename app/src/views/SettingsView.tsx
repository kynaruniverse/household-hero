import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { WEEK_START_OPTIONS, timeZoneList } from '../lib/household'

type Settings = { loadCapPercent?: number; turnTimeoutHours?: number; requireApproval?: boolean }

const box = { minHeight: 48, padding: '0 14px', fontSize: 16, borderRadius: 12, width: 120 } as const
const wide = { ...box, width: '100%', boxSizing: 'border-box' } as const
const label = { display: 'block', margin: '16px 0 6px', fontWeight: 700 } as const
const saveBtn = { ...box, width: 'auto', background: '#CDEFE0', border: 'none', fontWeight: 700 } as const
const hint = { fontSize: 14, color: '#555' } as const

export default function SettingsView({ householdId, isHead }: { householdId: string; isHead: boolean }) {
  const [houseName, setHouseName] = useState('')
  const [tz, setTz] = useState('Europe/London')
  const [startDay, setStartDay] = useState(1)
  const [reward, setReward] = useState('')
  const [hasWeeks, setHasWeeks] = useState(false)
  const [cap, setCap] = useState(125)
  const [hours, setHours] = useState(12)
  const [approval, setApproval] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    ;(async () => {
      const [hh, wk] = await Promise.all([
        supabase.from('households').select('name,timezone,week_start_day,reward_note,settings')
          .eq('id', householdId).maybeSingle(),
        supabase.from('weeks').select('id').eq('household_id', householdId).limit(1),
      ])
      const h = hh.data
      if (h) {
        const s = (h.settings ?? {}) as Settings
        setHouseName(h.name ?? '')
        setTz(h.timezone ?? 'Europe/London')
        setStartDay(h.week_start_day ?? 1)
        setReward(h.reward_note ?? '')
        setCap(s.loadCapPercent ?? 125)
        setHours(s.turnTimeoutHours ?? 12)
        setApproval(s.requireApproval ?? true)
      }
      setHasWeeks((wk.data?.length ?? 0) > 0)
      setLoaded(true)
    })()
  }, [householdId])

  const zones = useMemo(() => timeZoneList(tz), [tz])

  const saveHousehold = async () => {
    const { error } = await supabase.rpc('update_household', {
      p_household: householdId, p_name: houseName, p_timezone: tz,
      p_week_start_day: startDay, p_reward_note: reward,
    })
    setMsg(error ? error.message : 'Household saved ✅')
  }

  const saveGame = async () => {
    const { error } = await supabase.rpc('update_settings', {
      p_household: householdId, p_cap: cap, p_timeout: hours, p_approval: approval,
    })
    setMsg(error ? error.message : 'Saved ✅')
  }

  if (!loaded) return <p>Loading…</p>

  return (
    <>
      <h2>Settings</h2>
      {!isHead && <p style={hint}>Only the household head can change these.</p>}

      <h3>Household</h3>
      <span style={label}>Name</span>
      <input value={houseName} onChange={(e) => setHouseName(e.target.value)} maxLength={60}
        disabled={!isHead} style={wide} />

      <span style={label}>Timezone</span>
      <select value={tz} onChange={(e) => setTz(e.target.value)} disabled={!isHead} style={wide}>
        {zones.map((z) => <option key={z} value={z}>{z}</option>)}
      </select>
      <div style={hint}>Decides when each day starts and ends for chores.</div>

      <span style={label}>Week starts on</span>
      <select value={startDay} onChange={(e) => setStartDay(Number(e.target.value))}
        disabled={!isHead || hasWeeks} style={wide}>
        {WEEK_START_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hasWeeks && <div style={hint}>Fixed now that you have a week board.</div>}

      <span style={label}>Reward note</span>
      <input value={reward} onChange={(e) => setReward(e.target.value)} maxLength={140}
        placeholder="Hero picks Friday's takeaway" disabled={!isHead} style={wide} />
      <div style={hint}>Shown to everyone on the Scores tab.</div>

      {isHead && <p><button onClick={saveHousehold} style={saveBtn}>Save household</button></p>}

      <h3 style={{ marginTop: 32 }}>Game and approvals</h3>
      <span style={label}>Load cap % (100–200)</span>
      <input type="number" value={cap} onChange={(e) => setCap(Number(e.target.value))}
        disabled={!isHead} style={box} />
      <div style={hint}>How far above their fair share anyone can go in a draft.</div>

      <span style={label}>Turn time limit (hours, 1–72)</span>
      <input type="number" value={hours} onChange={(e) => setHours(Number(e.target.value))}
        disabled={!isHead} style={box} />
      <div style={hint}>Phone-by-phone drafts only. After this, the app picks for them.</div>

      <label style={{ ...label, fontWeight: 400 }}>
        <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)}
          disabled={!isHead} style={{ width: 24, height: 24, marginRight: 8 }} />
        Grown-up approves children’s chores
      </label>

      {isHead && <button onClick={saveGame} style={saveBtn}>Save</button>}
      <p>{msg}</p>
    </>
  )
}
