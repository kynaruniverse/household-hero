import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import AsyncGame from './AsyncGame'

type Props = { householdId: string; memberId: string; isAdult?: boolean }

export default function DraftPanel({ householdId, memberId, isAdult = false }: Props) {
  const [weeks, setWeeks] = useState<{ id: string }[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('weeks').select('id')
      .eq('household_id', householdId).eq('status', 'DRAFTING')
      .not('draft_order', 'is', null).order('week_start')
    setWeeks((data as { id: string }[]) ?? [])
  }, [householdId])

  useEffect(() => {
    load()
    const poll = window.setInterval(load, 30000)
    const vis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', vis)
    return () => { window.clearInterval(poll); document.removeEventListener('visibilitychange', vis) }
  }, [load])

  return (
    <>
      {weeks.map((w) => (
        <AsyncGame key={w.id} weekId={w.id} memberId={memberId} isAdult={isAdult} onDone={load} />
      ))}
    </>
  )
}