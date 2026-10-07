import { openDB } from 'idb'
import { supabase } from './supabase'

const dbPromise = openDB('hh-offline', 1, {
  upgrade(d) {
    d.createObjectStore('cache')
    d.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
  },
})

export type OutboxItem = {
  id?: number
  assignment_id: string
  client_completed_at: string
  chore_name: string
}

export async function cachePut(key: string, value: unknown) {
  await (await dbPromise).put('cache', value, key)
}
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  return (await dbPromise).get('cache', key)
}

export async function queueDone(item: OutboxItem) {
  await (await dbPromise).add('outbox', item)
  window.dispatchEvent(new Event('outbox-changed'))
}
export async function pendingIds(): Promise<Set<string>> {
  const items = (await (await dbPromise).getAll('outbox')) as OutboxItem[]
  return new Set(items.map((i) => i.assignment_id))
}

export async function getRejections(): Promise<string[]> {
  return (await cacheGet<string[]>('rejections')) ?? []
}
export async function clearRejections() {
  await cachePut('rejections', [])
}

// Sign-out wipes local data (children's data shouldn't linger on shared phones)
export async function clearAll() {
  const d = await dbPromise
  await d.clear('cache')
  await d.clear('outbox')
}

// Expired or missing token (or any 401): not a verdict on the chore, so retry later
export function isAuthError(code?: string, status?: number) {
  return status === 401 || !!code?.startsWith('PGRST30')
}

let flushing = false

// Replays queued "mark done" actions in order. Server wins: rejected actions
// are removed and reported. Network problems leave the queue untouched.
export async function flushOutbox() {
  if (flushing) return
  flushing = true
  try {
    const d = await dbPromise
    const items = (await d.getAll('outbox')) as OutboxItem[]
    for (const it of items) {
      const { error, status } = await supabase.rpc('complete_assignment', {
        p_assignment: it.assignment_id,
        p_client_completed_at: it.client_completed_at,
      })
      if (error && (!error.code || isAuthError(error.code, status))) break // offline or token expired: retry later
      if (error) {
        const rej = await getRejections()
        rej.push(`${it.chore_name}: ${error.message}`)
        await cachePut('rejections', rej)
      }
      await d.delete('outbox', it.id!)
    }
  } finally {
    flushing = false
    window.dispatchEvent(new Event('outbox-changed'))
  }
}