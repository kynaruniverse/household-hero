import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MEMBER_COLS, type Member } from '../lib/columns'

type House = { id: string; name: string }

export default function AdultHome() {
  const [house, setHouse] = useState<House | null | undefined>(undefined)
  const [members, setMembers] = useState<Member[]>([])
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🦊')
  const [msg, setMsg] = useState('')

  const loadAll = async () => {
    const { data: hs } = await supabase.from('households').select('id,name').limit(1)
    const h = (hs?.[0] as House | undefined) ?? null
    setHouse(h)
    if (!h) return
    const { data: ms } = await supabase
      .from('members').select(MEMBER_COLS).eq('household_id', h.id).order('display_name')
    setMembers((ms as Member[]) ?? [])
    const { data: cs } = await supabase.rpc('get_join_codes', { p_household: h.id })
    setCodes(Object.fromEntries((cs ?? []).map((c: { member_id: string; code: string }) => [c.member_id, c.code])))
  }
  useEffect(() => { loadAll() }, [])

  const createHouse = async () => {
    const { error } = await supabase.rpc('create_household', { p_name: 'Test House', p_display_name: 'Me' })
    setMsg(error ? error.message : '')
    loadAll()
  }

  const addChild = async () => {
    if (!house) return
    const { error } = await supabase.rpc('add_member', {
      p_household: house.id, p_display_name: name, p_role: 'CHILD', p_token_emoji: emoji,
    })
    setMsg(error ? error.message : '')
    setName('')
    loadAll()
  }

  const newCode = async (id: string) => {
    const { error } = await supabase.rpc('regenerate_join_code', { p_member: id })
    setMsg(error ? error.message : '')
    loadAll()
  }

  if (house === undefined) return <p>Loading…</p>
  if (house === null) return <button onClick={createHouse} style={{ padding: 12 }}>Create test household</button>

  return (
    <>
      <h2>{house.name}</h2>
      <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
        {members.map((m) => (
          <li key={m.id} style={{ margin: '12px 0' }}>
            {m.token_emoji ?? '🙂'} <b>{m.display_name}</b> ({m.role})
            {m.role === 'CHILD' && (
              <div>
                {codes[m.id] ? <>Join code: <code style={{ fontSize: 20 }}>{codes[m.id]}</code></> : 'Joined ✅'}{' '}
                <button onClick={() => newCode(m.id)}>New code</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <h3>Add a child</h3>
      <input value={emoji} onChange={(e) => setEmoji(e.target.value)} style={{ width: 48, padding: 8, fontSize: 20 }} />{' '}
      <input placeholder="First name" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: 8, fontSize: 16 }} />{' '}
      <button onClick={addChild} style={{ padding: 8 }}>Add</button>
      <p>{msg}</p>
    </>
  )
}