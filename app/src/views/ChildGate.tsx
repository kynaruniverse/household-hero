import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MEMBER_COLS, type Member } from '../lib/columns'
import TodayView from './TodayView'
import DraftPanel from './DraftPanel'
import ScoresView from './ScoresView'

export default function ChildGate({ userId }: { userId: string }) {
  const [member, setMember] = useState<Member | null | undefined>(undefined)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [tab, setTab] = useState<'today' | 'scores'>('today')

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
  
  const tabStyle = (on: boolean) => ({
    minHeight: 48, flex: 1, fontSize: 16, borderRadius: 12, border: 'none',
    background: on ? '#CDEFE0' : '#fff', fontWeight: on ? 700 : 400,
  }) as const  

  return member ? (
    <>
      <h2>{member.token_emoji ?? '🙂'} Hi {member.display_name}!</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab('today')} style={tabStyle(tab === 'today')}>✅ Today</button>
        <button onClick={() => setTab('scores')} style={tabStyle(tab === 'scores')}>🏆 Scores</button>
      </div>
      {tab === 'today' ? (
        <>
          <DraftPanel householdId={member.household_id} memberId={member.id} />
          <TodayView householdId={member.household_id} memberId={member.id} />
        </>
      ) : (
        <ScoresView householdId={member.household_id} memberId={member.id} />
      )}
      <p>{msg}</p>
    </>
  ) : (
    <>
      <h2>Enter your join code</h2>
      <input
        value={code} onChange={(e) => setCode(e.target.value)} maxLength={8}
        autoCapitalize="characters"
        style={{ padding: 12, fontSize: 24, letterSpacing: 4, width: '100%', boxSizing: 'border-box' }}
      />
      <button onClick={claim} style={{ padding: 12, marginTop: 8 }}>Join</button>
      <p>{msg}</p>
    </>
  )
}