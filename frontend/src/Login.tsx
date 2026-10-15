import { useState } from 'react'
import { post } from './api'
import type { User } from './api'

/** Log in, or create an account. A new account starts with an empty tracker of its own. */
export default function Login(props: { onDone: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const out =
        mode === 'login'
          ? await post<{ user: User }>('/api/login', { email, password })
          : await post<{ user: User }>('/api/signup', { email, name, password })
      props.onDone(out.user)
    } catch (err) {
      setError((err as Error).message || 'Could not reach the server. Try again in a minute.')
    } finally {
      setBusy(false)
    }
  }

  const signup = mode === 'signup'
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <span className="brand-mark big">R</span>
        <h1>Recruiting HQ</h1>
        <p className="muted">{signup ? 'Create your account. Your tracker is private to you.' : 'Log in to your tracker.'}</p>
        {signup && (
          <label className="field">
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        )}
        <label className="field">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
        </label>
        <label className="field">
          Password{signup && <small> (at least 8 characters)</small>}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} />
        </label>
        {error && <p className="notice error">{error}</p>}
        <button className="primary" disabled={busy || !email || !password || (signup && !name)}>
          {busy ? 'One moment…' : signup ? 'Create account' : 'Log in'}
        </button>
        <button type="button" className="link" onClick={() => { setMode(signup ? 'login' : 'signup'); setError('') }}>
          {signup ? 'I already have an account' : 'New here? Create an account'}
        </button>
        <p className="fine">The free server sleeps when unused, so the first load after a while can take about a minute.</p>
      </form>
    </div>
  )
}
