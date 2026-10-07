import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MEMBER_COLS, type Member } from '../lib/columns'
import HouseholdSetup from './HouseholdSetup'

type House = { id: string; name: string }

export default function AdultHome({ userId }: { userId: string }) {
  const [house, setHouse] = useState<House | null | undefined>(undefined)
  const [members, setMembers] = useState<Member[]>([])
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [invite, setInvite] = useState<string | null>(null)
  const [isHead, setIsHead] = useState(false)
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
    const { data: me } = await supabase
      .from('members').select('role').eq('household_id', h.id).eq('auth_uid', userId).maybeSingle()
    const head = me?.role === 'HEAD'
    setIsHead(head)
    if (!head) return
    const { data: cs } = await supabase.rpc('get_join_codes', { p_household: h.id })
    setCodes(Object.fromEntries((cs ?? []).map((c: { member_id: string; code: string }) => [c.member_id, c.code])))
    const { data: ic } = await supabase.rpc('get_invite_code', { p_household: h.id })
    setInvite((ic as string | null) ?? null)
  }
  useEffect(() => { loadAll() }, [])

  const addChild = async () => {
    if (!house || !name.trim()) return
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

  const newInvite = async () => {
    if (!house) return
    const { error } = await supabase.rpc('regenerate_invite_code', { p_household: house.id })
    setMsg(error ? error.message : '')
    loadAll()
  }

  if (house === undefined) return <p>Loading…</p>
  if (house === null) return <HouseholdSetup onDone={loadAll} />

  return (
    <>
      <h2>{house.name}</h2>
      <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
        {members.map((m) => (
          <li key={m.id} style={{ margin: '12px 0' }}>
            {m.token_emoji ?? '🙂'} <b>{m.display_name}</b> ({m.role})
            {isHead && m.role === 'CHILD' && (
              <div>
                {codes[m.id] ? <>Join code: <code style={{ fontSize: 20 }}>{codes[m.id]}</code></> : 'Joined ✅'}{' '}
                <button onClick={() => newCode(m.id)}>New code</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {isHead && (
        <>
          <h3>Add a child</h3>
          <input value={emoji} onChange={(e) => setEmoji(e.target.value)} style={{ width: 48, padding: 8, fontSize: 20 }} />{' '}
          <input placeholder="First name" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: 8, fontSize: 16 }} />{' '}
          <button onClick={addChild} style={{ padding: 8 }}>Add</button>

          <h3>Invite another grown-up</h3>
          <div>
            They sign in with their email, choose “Join with a code”, and enter this. It works once,
            then a new code appears here.
          </div>
          <p>
            {invite ? <code style={{ fontSize: 24, letterSpacing: 3 }}>{invite}</code> : 'No code yet.'}{' '}
            <button onClick={newInvite}>New code</button>
          </p>
        </>
      )}
      <p>{msg}</p>
    </>
  )
}
