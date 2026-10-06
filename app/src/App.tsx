import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [houses, setHouses] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const load = async () => {
    const { data, error } = await supabase.from('households').select('id,name')
    if (error) setMsg(error.message)
    else setHouses(data ?? [])
  }

  useEffect(() => {
    if (session) load()
  }, [session])

  const signIn = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL },
    })
    setMsg(error ? error.message : 'Check your email for the link ✉️')
  }

  const create = async () => {
    const { error } = await supabase.rpc('create_household', {
      p_name: 'Test House',
      p_display_name: 'Me',
    })
    setMsg(error ? error.message : 'Created!')
    load()
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, background: '#FFF9F0', minHeight: '100vh' }}>
      <h1>🦸 Household Hero</h1>
      {!session ? (
        <>
          <input
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 12, fontSize: 16, width: '100%', boxSizing: 'border-box' }}
          />
          <button onClick={signIn} style={{ padding: 12, marginTop: 8 }}>Send magic link</button>
        </>
      ) : (
        <>
          <p>Signed in as {session.user.email}</p>
          <button onClick={create} style={{ padding: 12 }}>Create test household</button>
          <ul>{houses.map((h) => <li key={h.id}>{h.name}</li>)}</ul>
          <button onClick={() => supabase.auth.signOut()} style={{ padding: 12 }}>Sign out</button>
        </>
      )}
      <p>{msg}</p>
    </main>
  )
}