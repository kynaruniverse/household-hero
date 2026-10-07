import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MEMBER_COLS, type Member } from '../lib/columns'
import TodayView from './TodayView'

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
  
    const cheatTest = async () => {
    if (!member) return
    const bump = await supabase.from('members')
      .update({ total_points: 99999 }).eq('id', member.id).select('id')
    const edit = await supabase.from('assignments')
      .update({ status: 'APPROVED', points_awarded: 999 })
      .eq('member_id', member.id).select('id')
    const mine = await supabase.from('assignments').select('id').eq('member_id', member.id).limit(1)
    const appr = await supabase.rpc('approve_assignment', { p_assignment: mine.data?.[0]?.id })
    setMsg(
      `Points edit: ${bump.error || !bump.data?.length ? 'blocked ✅' : 'ALLOWED ❌'}. ` +
      `Status edit: ${edit.error || !edit.data?.length ? 'blocked ✅' : 'ALLOWED ❌'}. ` +
      `Self-approve: ${appr.error ? 'blocked ✅' : 'ALLOWED ❌'}`
    )
  }

  if (member === undefined) return <p>Loading…</p>

  return member ? (
    <>
      <h2>{member.token_emoji ?? '🙂'} Hi {member.display_name}!</h2>
      <TodayView householdId={member.household_id} memberId={member.id} />
      <button onClick={cheatTest} style={{ minHeight: 48, marginTop: 24 }}>Test: cheating</button>
      <p>{msg}</p>
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