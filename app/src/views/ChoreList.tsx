import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CHORE_COLS, DAYS, type Chore } from '../lib/chores'
import ChoreForm from './ChoreForm'

export default function ChoreList() {
  const [houseId, setHouseId] = useState<string | null | undefined>(undefined)
  const [chores, setChores] = useState<Chore[]>([])
  const [editing, setEditing] = useState<Chore | 'new' | null>(null)
  const [msg, setMsg] = useState('')

  const load = async () => {
    const { data: hs } = await supabase.from('households').select('id').limit(1)
    const id = hs?.[0]?.id ?? null
    setHouseId(id)
    if (!id) return
    const { data, error } = await supabase
      .from('chores').select(CHORE_COLS).eq('household_id', id).order('name')
    if (error) setMsg(error.message)
    setChores((data as Chore[]) ?? [])
  }
  useEffect(() => { load() }, [])

  const addStarters = async () => {
    const { error } = await supabase.rpc('add_starter_chores', { p_household: houseId })
    setMsg(error ? error.message : '')
    load()
  }

  const closeForm = () => { setEditing(null); load() }

  if (houseId === undefined) return <p>Loading…</p>
  if (houseId === null) return <p>Create your household on the Family tab first.</p>

  if (editing) {
    return (
      <ChoreForm
        householdId={houseId}
        chore={editing === 'new' ? null : editing}
        onDone={closeForm}
      />
    )
  }

  const daysText = (d: number[]) => (d.length === 7 ? 'Every day' : d.map((i) => DAYS[i]).join(' '))

  return (
    <>
      <h2>Chores</h2>
      {chores.length === 0 && (
        <button onClick={addStarters} style={{ minHeight: 48, padding: '0 16px', fontSize: 16 }}>
          ✨ Add starter chores
        </button>
      )}
      {chores.map((c) => (
        <button
          key={c.id}
          onClick={() => setEditing(c)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', minHeight: 64, margin: '8px 0',
            padding: 12, fontSize: 16, borderRadius: 16, border: 'none', background: '#fff',
            opacity: c.is_active ? 1 : 0.5,
          }}
        >
          <b>{c.icon ?? '🧽'} {c.name}</b>{!c.is_active && ' (paused)'}
          <div style={{ fontSize: 14, color: '#555' }}>
            Effort {c.effort}/5 · {daysText(c.active_days)}
            {c.category === 'ADULT_ONLY' && ' · 🔒 Adults only'}
            {c.deadline_time && ` · by ${c.deadline_time.slice(0, 5)}`}
          </div>
        </button>
      ))}
      <button onClick={() => setEditing('new')} style={{ minHeight: 48, padding: '0 16px', fontSize: 16, marginTop: 8 }}>
        ➕ Add chore
      </button>
      <p>{msg}</p>
    </>
  )
}