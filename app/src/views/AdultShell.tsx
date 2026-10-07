import { useState } from 'react'
import AdultHome from './AdultHome'
import ChoreList from './ChoreList'
import WeekBoard from './WeekBoard'

type Tab = 'family' | 'chores' | 'week'

export default function AdultShell() {
  const [tab, setTab] = useState<Tab>('week')
  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        minHeight: 48, flex: 1, fontSize: 15, borderRadius: 12, border: 'none',
        background: tab === t ? '#CDEFE0' : '#fff', fontWeight: tab === t ? 700 : 400,
      }}
    >
      {label}
    </button>
  )
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabBtn('week', '📅 Week')}
        {tabBtn('chores', '🧽 Chores')}
        {tabBtn('family', '👨‍👩‍👧 Family')}
      </div>
      {tab === 'family' ? <AdultHome /> : tab === 'chores' ? <ChoreList /> : <WeekBoard />}
    </>
  )
}