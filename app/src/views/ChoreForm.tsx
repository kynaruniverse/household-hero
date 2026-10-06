import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { DAYS, type Chore } from '../lib/chores'

const box = { minHeight: 48, padding: '0 14px', fontSize: 16, borderRadius: 12 } as const
const pill = (on: boolean) => ({
  ...box, minWidth: 48, border: '2px solid #cfc6e8', background: on ? '#E6DFFA' : '#fff',
  fontWeight: on ? 700 : 400,
}) as const

type Props = { householdId: string; chore: Chore | null; onDone: () => void }

export default function ChoreForm({ householdId, chore, onDone }: Props) {
  const [name, setName] = useState(chore?.name ?? '')
  const [icon, setIcon] = useState(chore?.icon ?? '🧽')
  const [category, setCategory] = useState<Chore['category']>(chore?.category ?? 'FAMILY')
  const [effort, setEffort] = useState(chore?.effort ?? 2)
  const [days, setDays] = useState<number[]>(chore?.active_days ?? [])
  const [deadline, setDeadline] = useState(chore?.deadline_time?.slice(0, 5) ?? '')
  const [active, setActive] = useState(chore?.is_active ?? true)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const toggleDay = (d: number) =>
    setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b))

  const save = async () => {
    if (!name.trim()) return setMsg('Give the chore a name.')
    if (days.length === 0) return setMsg('Pick at least one day.')
    setBusy(true)
    const row = {
      name: name.trim(), icon: icon || null, category, effort,
      active_days: days, deadline_time: deadline || null, is_active: active,
    }
    const res = chore
      ? await supabase.from('chores').update(row).eq('id', chore.id).select('id')
      : await supabase.from('chores').insert({ ...row, household_id: householdId }).select('id')
    setBusy(false)
    if (res.error) return setMsg(res.error.message)
    // RLS blocks updates silently (0 rows, no error), so check the row count
    if (!res.data || res.data.length === 0) return setMsg('Not allowed.')
    onDone()
  }

  const remove = async () => {
    if (!chore || !confirm(`Delete "${chore.name}"? This can't be undone.`)) return
    const res = await supabase.from('chores').delete().eq('id', chore.id).select('id')
    if (res.error) return setMsg(res.error.message)
    if (!res.data || res.data.length === 0) return setMsg('Not allowed.')
    onDone()
  }

  const label = { display: 'block', margin: '16px 0 6px', fontWeight: 700 } as const

  return (
    <>
      <h2>{chore ? 'Edit chore' : 'New chore'}</h2>

      <span style={label}>Name</span>
      <input value={icon} onChange={(e) => setIcon(e.target.value)} style={{ ...box, width: 56 }} />{' '}
      <input
        value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
        placeholder="e.g. Take the bins out" style={{ ...box, width: 'calc(100% - 72px)', boxSizing: 'border-box' }}
      />

      <span style={label}>Who can do it?</span>
      <button onClick={() => setCategory('FAMILY')} style={pill(category === 'FAMILY')}>👨‍👩‍👧 Family</button>{' '}
      <button onClick={() => setCategory('ADULT_ONLY')} style={pill(category === 'ADULT_ONLY')}>🔒 Adults only</button>

      <span style={label}>Effort (1 quick – 5 heavy)</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => setEffort(n)} style={{ ...pill(effort === n), marginRight: 6 }}>{n}</button>
      ))}

      <span style={label}>Days it needs doing</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {DAYS.map((d, i) => (
          <button key={d} onClick={() => toggleDay(i)} style={pill(days.includes(i))}>{d}</button>
        ))}
      </div>

      <span style={label}>Deadline (optional)</span>
      <input type="time" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={box} />

      <label style={{ ...label, fontWeight: 400 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)}
          style={{ width: 24, height: 24, marginRight: 8 }} />
        Active (untick to pause)
      </label>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={save} disabled={busy} style={{ ...box, background: '#CDEFE0', border: 'none', fontWeight: 700 }}>Save</button>
        <button onClick={onDone} style={box}>Cancel</button>
        {chore && <button onClick={remove} style={{ ...box, color: '#b00020' }}>Delete</button>}
      </div>
      <p>{msg}</p>
    </>
  )
}