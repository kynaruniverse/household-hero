import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Row = {
  r_member: string; r_name: string; r_emoji: string | null; r_role: string
  r_week_pts: number; r_total: number; r_streak: number; r_best: number
}
type Ach = { key: string; name: string; description: string }
type Hero = { member_id: string; points: number; week_start: string }

const ICONS: Record<string, string> = {
  first_steps: '👣', early_bird: '🐦', bin_boss: '🗑️', perfect_week: '💯', on_a_roll: '🔥',
  unstoppable: '🚀', heavy_lifter: '🏋️', team_player: '🤝', draft_champion: '🎲',
  comeback_kid: '💪', century: '🏆',
}

export default function ScoresView({ householdId, memberId }: { householdId: string; memberId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [ach, setAch] = useState<Ach[]>([])
  const [earned, setEarned] = useState<Set<string>>(new Set())
  const [heroes, setHeroes] = useState<Hero[]>([])
  const [reward, setReward] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [lb, ac, ea, hr, hh] = await Promise.all([
      supabase.rpc('get_leaderboard', { p_household: householdId }),
      supabase.from('achievements').select('key,name,description').order('name'),
      supabase.from('member_achievements').select('key').eq('member_id', memberId),
      supabase.from('week_results').select('member_id,points,week_start')
        .eq('household_id', householdId).eq('hero', true)
        .order('week_start', { ascending: false }).limit(4),
      supabase.from('households').select('reward_note').eq('id', householdId).maybeSingle(),
    ])
    if (lb.error) return setMsg(lb.error.message)
    setRows((lb.data as Row[]) ?? [])
    setAch((ac.data as Ach[]) ?? [])
    setEarned(new Set(((ea.data as { key: string }[]) ?? []).map((e) => e.key)))
    const hs = (hr.data as Hero[]) ?? []
    setHeroes(hs.filter((h) => h.week_start === hs[0]?.week_start))
    setReward((hh.data?.reward_note as string | null) ?? '')
  }, [householdId, memberId])

  useEffect(() => {
    load()
    const vis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [load])

  const top = Math.max(0, ...rows.map((r) => r.r_week_pts))
  const nameOf = (id: string) => rows.find((r) => r.r_member === id)?.r_name ?? 'Someone'

  return (
    <>
      <h2>🏆 This week</h2>
      {reward && <p style={{ background: '#E6DFFA', padding: 10, borderRadius: 12 }}>🎁 {reward}</p>}
      {rows.map((r) => (
        <div key={r.r_member}
          style={{
            background: r.r_member === memberId ? '#E6DFFA' : '#fff', borderRadius: 16,
            padding: 12, margin: '8px 0', display: 'flex', alignItems: 'center', gap: 10,
          }}>
          <span style={{ fontSize: 28 }}>{r.r_emoji ?? '🙂'}</span>
          <div style={{ flex: 1 }}>
            <b>{top > 0 && r.r_week_pts === top ? '👑 ' : ''}{r.r_name}</b>
            <div style={{ fontSize: 13, color: '#555' }}>
              ⭐ {r.r_total} total{r.r_streak > 0 ? ` · 🔥 ${r.r_streak}-week streak` : ''}
            </div>
          </div>
          <b style={{ fontSize: 20 }}>{r.r_week_pts}</b>
        </div>
      ))}

      {heroes.length > 0 && (
        <p style={{ background: '#FFF1B8', padding: 10, borderRadius: 12 }}>
          👑 Last week’s Hero: <b>{heroes.map((h) => nameOf(h.member_id)).join(' & ')}</b> ({heroes[0].points} pts)
        </p>
      )}

      <h2 style={{ marginTop: 28 }}>🎖️ My trophies</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {ach.map((a) => {
          const got = earned.has(a.key)
          return (
            <div key={a.key}
              style={{ background: got ? '#CDEFE0' : '#fff', opacity: got ? 1 : 0.5, borderRadius: 14, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 32, filter: got ? 'none' : 'grayscale(1)' }}>{ICONS[a.key] ?? '🏅'}</div>
              <b style={{ fontSize: 14 }}>{a.name}</b>
              <div style={{ fontSize: 12 }}>{a.description}</div>
            </div>
          )
        })}
      </div>
      <p>{msg}</p>
    </>
  )
}