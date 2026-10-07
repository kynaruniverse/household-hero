import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import AdultHome from './AdultHome'
import ApprovalsInbox from './ApprovalsInbox'
import ChoreList from './ChoreList'
import DraftPanel from './DraftPanel'
import ScoresView from './ScoresView'
import SettingsView from './SettingsView'
import TodayView from './TodayView'
import WeekBoard from './WeekBoard'

type Tab = 'today' | 'week' | 'approve' | 'scores' | 'chores' | 'family' | 'settings'
type Me = { id: string; household_id: string; role: string }

export default function AdultShell({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('today')
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    supabase.from('members').select('id,household_id,role').eq('auth_uid', userId).maybeSingle()
      .then(({ data }) => setMe((data as Me | null) ?? null))
  }, [userId, tab])

  const tabBtn = (t: Tab, icon: string, label: string) => (
    <button
      onClick={() => setTab(t)}
      aria-label={label}
      style={{
        minHeight: 56, minWidth: 0, fontSize: 13, padding: '0 2px', borderRadius: 12, border: 'none',
        background: tab === t ? '#CDEFE0' : '#fff', fontWeight: tab === t ? 700 : 400,
      }}
    >
      <span style={{ fontSize: 18, display: 'block' }}>{icon}</span>
      {label}
    </button>
  )

  const needHouse = <p>Create or join a household on the Family tab first.</p>

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 16 }}>
        {tabBtn('today', '✅', 'Today')}
        {tabBtn('week', '📅', 'Week')}
        {tabBtn('approve', '👍', 'Approve')}
        {tabBtn('scores', '🏆', 'Scores')}
        {tabBtn('chores', '🧽', 'Chores')}
        {tabBtn('family', '👨‍👩‍👧', 'Family')}
        {tabBtn('settings', '⚙️', 'Settings')}
      </div>
      {tab === 'today' ? (me ? (
          <>
            <DraftPanel householdId={me.household_id} memberId={me.id} isAdult />
            <TodayView householdId={me.household_id} memberId={me.id} />
          </>
        ) : needHouse)
        : tab === 'approve' ? (me ? <ApprovalsInbox householdId={me.household_id} /> : needHouse)
        : tab === 'scores' ? (me ? <ScoresView householdId={me.household_id} memberId={me.id} /> : needHouse)
        : tab === 'week' ? <WeekBoard meId={me?.id ?? null} />
        : tab === 'chores' ? <ChoreList />
        : tab === 'settings' ? (me ? <SettingsView householdId={me.household_id} isHead={me.role === 'HEAD'} /> : needHouse)
        : <AdultHome userId={userId} />}
    </>
  )
}