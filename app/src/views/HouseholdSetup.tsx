import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { WEEK_START_OPTIONS, deviceTimeZone, timeZoneList } from '../lib/household'

const field = {
  display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 48,
  padding: '0 12px', fontSize: 16, borderRadius: 12, margin: '4px 0 14px',
} as const
const label = { display: 'block', fontWeight: 700 } as const
const primary = {
  minHeight: 48, padding: '0 20px', fontSize: 16, fontWeight: 700,
  borderRadius: 12, border: 'none', background: '#CDEFE0',
} as const

type Mode = 'create' | 'join'

export default function HouseholdSetup({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('create')
  const [houseName, setHouseName] = useState('')
  const [myName, setMyName] = useState('')
  const [tz, setTz] = useState(deviceTimeZone())
  const [startDay, setStartDay] = useState(1)
  const [reward, setReward] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const zones = useMemo(() => timeZoneList(deviceTimeZone()), [])

  const create = async () => {
    setBusy(true)
    setMsg('')
    const { error } = await supabase.rpc('create_household', {
      p_name: houseName, p_display_name: myName, p_timezone: tz,
      p_week_start_day: startDay, p_reward_note: reward,
    })
    setBusy(false)
    if (error) setMsg(error.message)
    else onDone()
  }

  const join = async () => {
    setBusy(true)
    setMsg('')
    const { data, error } = await supabase.rpc('join_household', { p_code: code, p_display_name: myName })
    setBusy(false)
    if (error) setMsg(error.message)
    else if (!data) setMsg("That code didn't work. Ask for a fresh one.")
    else onDone()
  }

  const tab = (m: Mode, text: string) => (
    <button onClick={() => { setMode(m); setMsg('') }}
      style={{
        minHeight: 48, flex: 1, fontSize: 16, borderRadius: 12, border: 'none',
        background: mode === m ? '#CDEFE0' : '#fff', fontWeight: mode === m ? 700 : 400,
      }}>
      {text}
    </button>
  )

  return (
    <>
      <h2>Set up your household</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tab('create', 'Start a household')}
        {tab('join', 'Join with a code')}
      </div>

      {mode === 'create' ? (
        <>
          <label style={label}>Household name</label>
          <input value={houseName} onChange={(e) => setHouseName(e.target.value)} maxLength={60}
            placeholder="The Smiths" style={field} />

          <label style={label}>Your name</label>
          <input value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={40}
            placeholder="Sam" style={field} />

          <label style={label}>Timezone</label>
          <select value={tz} onChange={(e) => setTz(e.target.value)} style={field}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>

          <label style={label}>Week starts on</label>
          <select value={startDay} onChange={(e) => setStartDay(Number(e.target.value))} style={field}>
            {WEEK_START_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div style={{ fontSize: 14, color: '#555', margin: '-8px 0 14px' }}>
            This is fixed once your first week board exists.
          </div>

          <label style={label}>Reward note (optional)</label>
          <input value={reward} onChange={(e) => setReward(e.target.value)} maxLength={140}
            placeholder="Hero picks Friday's takeaway" style={field} />

          <button onClick={create} disabled={busy || !houseName.trim() || !myName.trim()} style={primary}>
            Create household
          </button>
        </>
      ) : (
        <>
          <label style={label}>Invite code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={8}
            autoCapitalize="characters" style={{ ...field, fontSize: 24, letterSpacing: 4 }} />

          <label style={label}>Your name</label>
          <input value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={40}
            placeholder="Alex" style={field} />

          <button onClick={join} disabled={busy || !code.trim() || !myName.trim()} style={primary}>
            Join household
          </button>
        </>
      )}
      <p>{msg}</p>
    </>
  )
}
