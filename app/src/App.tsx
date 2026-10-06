import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import SignIn from './views/SignIn'
import AdultShell from './views/AdultShell'
import ChildGate from './views/ChildGate'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, background: '#FFF9F0', minHeight: '100vh' }}>
      <h1>🦸 Household Hero</h1>
      {session === undefined ? <p>Loading…</p>
        : !session ? <SignIn />
        : session.user.is_anonymous ? <ChildGate userId={session.user.id} />
        : <AdultShell />}
      {session && (
        <p><button onClick={() => supabase.auth.signOut()} style={{ padding: 8 }}>Sign out</button></p>
      )}
    </main>
  )
}