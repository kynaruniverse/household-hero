import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')

  const sendLink = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL },
    })
    setMsg(error ? error.message : 'Check your email for the link ✉️')
  }

  const joinAsChild = async () => {
    const { error } = await supabase.auth.signInAnonymously()
    if (error) setMsg(error.message)
  }

  return (
    <>
      <h2>Grown-ups</h2>
      <input
        type="email" placeholder="you@email.com" value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ padding: 12, fontSize: 16, width: '100%', boxSizing: 'border-box' }}
      />
      <button onClick={sendLink} style={{ padding: 12, marginTop: 8 }}>Send magic link</button>
      <h2 style={{ marginTop: 32 }}>Kids</h2>
      <button onClick={joinAsChild} style={{ padding: 12 }}>I have a join code</button>
      <p>{msg}</p>
    </>
  )
}