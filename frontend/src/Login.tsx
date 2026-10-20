import { useState } from 'react'
import { post } from './api'
import type { User } from './api'

/** Log in, create an account, or reset a forgotten password with a code sent by email. */
export default function Login(props: { onDone: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function switchTo(m: typeof mode) {
    setMode(m)
    setError('')
    setPassword('')
    setCode('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'forgot') {
        await post('/api/password/forgot', { email })
        setMode('reset')
        return
      }
      const out =
        mode === 'login'
          ? await post<{ user: User }>('/api/login', { email, password })
          : mode === 'signup'
            ? await post<{ user: User }>('/api/signup', { email, name, password })
            : await post<{ user: User }>('/api/password/reset', { email, code, password })
      props.onDone(out.user)
    } catch (err) {
      setError((err as Error).message || 'Could not reach the server. Try again in a minute.')
    } finally {
      setBusy(false)
    }
  }

  const intro = {
    login: 'Log in to your tracker.',
    signup: 'Create your account. Your tracker is private to you.',
    forgot: "Enter your account's email and we'll send you a code to reset your password.",
    reset: `If there is an account for ${email}, a 6-digit code is on its way. Enter it with a new password.`,
  }[mode]
  const ready =
    mode === 'login' ? email && password : mode === 'signup' ? email && password && name : mode === 'forgot' ? email : code.length >= 6 && password

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <span className="brand-mark big">R</span>
        <h1>Recruiting HQ</h1>
        <p className="muted">{intro}</p>
        {mode === 'signup' && (
          <label className="field">
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        )}
        {mode !== 'reset' && (
          <label className="field">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
          </label>
        )}
        {mode === 'reset' && (
          <label className="field">
            Code from the email
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              autoFocus
            />
          </label>
        )}
        {mode !== 'forgot' && (
          <label className="field">
            {mode === 'reset' ? 'New password' : 'Password'}
            {mode !== 'login' && <small> (at least 8 characters)</small>}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>
        )}
        {error && <p className="notice error">{error}</p>}
        <button className="primary" disabled={busy || !ready}>
          {busy
            ? 'One moment…'
            : { login: 'Log in', signup: 'Create account', forgot: 'Send me a code', reset: 'Set new password and log in' }[mode]}
        </button>
        {mode === 'login' && (
          <>
            <button type="button" className="link" onClick={() => switchTo('signup')}>
              New here? Create an account
            </button>
            <button type="button" className="link" onClick={() => switchTo('forgot')}>
              Forgot your password?
            </button>
          </>
        )}
        {mode === 'signup' && (
          <>
            <button type="button" className="link" onClick={() => switchTo('login')}>
              I already have an account
            </button>
            <p className="fine">
              By creating an account you agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and{' '}
              <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
            </p>
          </>
        )}
        {mode === 'reset' && (
          <button type="button" className="link" onClick={() => switchTo('forgot')}>
            Didn't get it? Send a new code
          </button>
        )}
        {(mode === 'forgot' || mode === 'reset') && (
          <button type="button" className="link" onClick={() => switchTo('login')}>
            Back to log in
          </button>
        )}
      </form>
    </div>
  )
}

/** After sign-up: enter the 6-digit code emailed to the new account's address. */
export function VerifyEmail({ user, onDone, onSignOut }: { user: User; onDone: () => void; onSignOut: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await post('/api/verify-email', { code })
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError('')
    setNote('')
    try {
      await post('/api/verify-email/resend', {})
      setNote('A new code is on its way.')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <span className="brand-mark big">R</span>
        <h1>Check your email</h1>
        <p className="muted">
          We sent a 6-digit code to <strong>{user.email}</strong>. Enter it to confirm this is your address.
        </p>
        <label className="field">
          Code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            autoFocus
          />
        </label>
        {error && <p className="notice error">{error}</p>}
        {note && <p className="notice ok">{note}</p>}
        <button className="primary" disabled={busy || code.length < 6}>
          {busy ? 'Checking…' : 'Confirm'}
        </button>
        <button type="button" className="link" onClick={resend}>
          Didn't get it? Send a new code
        </button>
        <button type="button" className="link" onClick={onSignOut}>
          Wrong email? Sign out and start again
        </button>
        <p className="fine">The code can take a minute to arrive. Check your spam folder too.</p>
      </form>
    </div>
  )
}
