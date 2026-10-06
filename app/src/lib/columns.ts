// Must match the columns granted in 0002. Never use select('*') on members.
export const MEMBER_COLS =
  'id,household_id,display_name,role,token_emoji,token_colour,total_points,current_streak,best_streak'

export type Member = {
  id: string
  household_id: string
  display_name: string
  role: 'HEAD' | 'ADULT' | 'CHILD'
  token_emoji: string | null
  token_colour: string | null
  total_points: number
  current_streak: number
  best_streak: number
}