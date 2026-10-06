import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MEMBER_COLS, type Member } from '../lib/columns'

export default function ChildGate({ userId }: { userId: string }) {
  const [member, setMember] = useState<Member | null | undefined>(undefined)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')

  const load = async () => {
    const { data } = await supabase
      .from('members').select(MEMBER_COLS).eq('auth_uid', userId).maybeSingle()
    setMember(data as Member | null)
  }
  useEffect(() => { load() }, [userId])

  const claim = async () => {
    const { data, error } = await supabase.rpc('claim_join_code', { p_code: code })
    if (error) setMsg(error.message)
    else if (!data) setMsg("That code didn't work. Check it and try again.")
    else load()
  }

  if (member === undefined) return <p>Loading…</p>

  return member ? (
    <>
      <h2>{member.token_emoji ?? '🙂'} Hi {member.display_name}!</h2>
      <p>You're all set up. Chores are coming soon.</p>
    </>
  ) : (
    <>
      <h2>Enter your join code</h2>
      <input
        value={code} onChange={(e) => setCode(e.target.value)} maxLength={6}
        autoCapitalize="characters"
        style={{ padding: 12, fontSize: 24, letterSpacing: 4, width: '100%', boxSizing: 'border-box' }}
      />
      <button onClick={claim} style={{ padding: 12, marginTop: 8 }}>Join</button>
      <p>{msg}</p>
    </>
  )
}