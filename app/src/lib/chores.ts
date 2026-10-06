export type Chore = {
  id: string
  household_id: string
  name: string
  icon: string | null
  category: 'FAMILY' | 'ADULT_ONLY'
  effort: number
  active_days: number[]
  deadline_time: string | null
  is_active: boolean
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const CHORE_COLS =
  'id,household_id,name,icon,category,effort,active_days,deadline_time,is_active'