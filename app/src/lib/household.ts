// Week start days use the same numbering as the database (0 = Sunday ... 6 = Saturday).
export const WEEK_START_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

const FALLBACK_ZONES = [
  'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Australia/Sydney',
  'Pacific/Auckland', 'Asia/Kolkata', 'Asia/Tokyo', 'UTC',
]

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'
  } catch {
    return 'Europe/London'
  }
}

// Every zone this browser knows about, plus the current choice so it is always in the list.
export function timeZoneList(current?: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  let zones: string[] = FALLBACK_ZONES
  try {
    zones = intl.supportedValuesOf?.('timeZone') ?? FALLBACK_ZONES
  } catch {
    zones = FALLBACK_ZONES
  }
  const all = new Set<string>(zones)
  all.add('UTC')
  all.add(deviceTimeZone())
  if (current) all.add(current)
  return [...all].sort()
}
