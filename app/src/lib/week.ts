import type { Member } from './columns'

export type Week = {
  id: string
  household_id: string
  week_start: string
  mode: 'GAME' | 'NORMAL'
  status: 'SETUP' | 'DRAFTING' | 'REVIEW' | 'LOCKED' | 'CLOSED'
}

export type Assignment = {
  id: string
  chore_id: string | null
  chore_name: string
  chore_effort: number
  chore_category: 'FAMILY' | 'ADULT_ONLY'
  date: string
  member_id: string | null
  status: string
}

export const WEEK_COLS = 'id,household_id,week_start,mode,status'
export const ASSIGN_COLS = 'id,chore_id,chore_name,chore_effort,chore_category,date,member_id,status'

export function weekDates(start: string): string[] {
  const [y, m, d] = start.split('-').map(Number)
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10))
}

export function dayParts(iso: string): [string, string] {
  const dt = new Date(iso + 'T00:00:00Z')
  return [
    dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    String(dt.getUTCDate()),
  ]
}

export function token(m: Member | undefined): string {
  return m ? m.token_emoji || m.display_name.slice(0, 1).toUpperCase() : ''
}