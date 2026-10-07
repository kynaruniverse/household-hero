import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import AdultHome from './AdultHome'
import ApprovalsInbox from './ApprovalsInbox'
import ChoreList from './ChoreList'
import TodayView from './TodayView'
import WeekBoard from './WeekBoard'

type Tab = 'today' | 'week' | 'approve' | 'chores' | 'family'
type Me = { id: string; household_id: string }

export default function AdultShell({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('today')
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    supabase.from('members').select('id,household_id').eq('auth_uid', userId).maybeSingle()
      .then(({ data }) => setMe((data as Me | null) ?? null))
  }, [userId, tab])

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        minHeight: 48, flex: 1, fontSize: 12, padding: '0 2px', borderRadius: 12, border: 'none',
        background: tab === t ? '#CDEFE0' : '#fff', fontWeight: tab === t ? 700 : 400,
      }}
    >
      {label}
    </button>
  )

  const needHouse = <p>Create your household on the Family tab first.</p>

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {tabBtn('today', '✅ Today')}
        {tabBtn('week', '📅 Week')}
        {tabBtn('approve', '👍 Approve')}
        {tabBtn('chores', '🧽 Chores')}
        {tabBtn('family', '👨‍👩‍👧 Family')}
      </div>
      {tab === 'today' ? (me ? <TodayView householdId={me.household_id} memberId={me.id} /> : needHouse)
        : tab === 'approve' ? (me ? <ApprovalsInbox householdId={me.household_id} /> : needHouse)
        : tab === 'week' ? <WeekBoard />
        : tab === 'chores' ? <ChoreList />
        : <AdultHome />}
    </>
  )
}