import { useState } from 'react'
import AdultHome from './AdultHome'
import ChoreList from './ChoreList'

export default function AdultShell() {
  const [tab, setTab] = useState<'family' | 'chores'>('family')
  const tabBtn = (t: 'family' | 'chores', label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        minHeight: 48, flex: 1, fontSize: 16, borderRadius: 12, border: 'none',
        background: tab === t ? '#CDEFE0' : '#fff', fontWeight: tab === t ? 700 : 400,
      }}
    >
      {label}
    </button>
  )
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabBtn('family', '👨‍👩‍👧 Family')}
        {tabBtn('chores', '🧽 Chores')}
      </div>
      {tab === 'family' ? <AdultHome /> : <ChoreList />}
    </>
  )
}