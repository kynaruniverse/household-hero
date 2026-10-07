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
  
    const cheatTest = async () => {
    if (!member) return
    const bump = await supabase.from('members')
      .update({ total_points: 99999 }).eq('id', member.id).select('id')
    const edit = await supabase.from('assignments')
      .update({ status: 'APPROVED', points_awarded: 999 })
      .eq('member_id', member.id).select('id')
    const wk = await supabase.from('weeks').select('id').limit(1)
    const wid = wk.data?.[0]?.id
    const sg = await supabase.rpc('start_game', { p_week: wid, p_players: [member.id, member.id] })
    const sb = await supabase.rpc('submit_board', { p_week: wid, p_picks: [] })      
    const mine = await supabase.from('assignments').select('id').eq('member_id', member.id).limit(1)
    const appr = await supabase.rpc('approve_assignment', { p_assignment: mine.data?.[0]?.id })
    const trophy = await supabase.from('member_achievements').insert({ member_id: member.id, key: 'century' })
    const roll = await supabase.rpc('run_weekly_rollover')    
    setMsg(
      `Points edit: ${bump.error || !bump.data?.length ? 'blocked ✅' : 'ALLOWED ❌'}. ` +
      `Status edit: ${edit.error || !edit.data?.length ? 'blocked ✅' : 'ALLOWED ❌'}. ` +
      `Self-approve: ${appr.error ? 'blocked ✅' : 'ALLOWED ❌'}. ` +
      `Start game: ${sg.error ? 'blocked ✅' : 'ALLOWED ❌'}. ` +
      `Submit board: ${sb.error ? 'blocked ✅' : 'ALLOWED ❌'}. ` +
      ` Fake trophy: ${trophy.error ? 'blocked ✅' : 'ALLOWED ❌'}. Rollover: ${roll.error ? 'blocked ✅' : 'ALLOWED ❌'}`      
    )
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