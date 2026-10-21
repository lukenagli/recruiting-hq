import { useEffect, useRef, useState } from 'react'
import { post } from './api'
import type { AssistantReply, AssistantStep } from './api'
import DraftCard from './DraftCard'
import Recorder from './Recorder'

type Message = { role: 'user' | 'assistant'; text: string; undone?: boolean } & Partial<AssistantReply>

const STORE = 'assistant-thread'
const EXAMPLES = [
  'I had a coffee chat with Jordan Lee from Citi this morning on Zoom. We talked about…',
  'I got invited to the next round at Guggenheim',
  'I applied to Morgan Stanley today',
]

function load(key: string): Message[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]')
  } catch {
    return []
  }
}

function stepLine(s: AssistantStep) {
  if (s.result.refused) return `Not saved: ${s.result.reason}`
  if (s.tool === 'lookup') return `Looked up ${String(s.args.query)}${s.result.found ? '' : ' (nothing found)'}`
  return s.result.did ?? s.tool
}

/** One assistant reply: the answer, a one-line summary of what changed (details on request), any thank-you drafts. */
function Reply({ m, canUndo, onUndo, onChanged }: { m: Message; canUndo: boolean; onUndo: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const writes = (m.steps ?? []).filter((s) => s.tool !== 'lookup' && !s.result.refused)
  const refused = (m.steps ?? []).filter((s) => s.result.refused)
  return (
    <div className="msg assistant">
      <p>{m.text}</p>
      {(writes.length > 0 || refused.length > 0) && (
        <button className="msg-summary" onClick={() => setOpen(!open)}>
          {writes.length > 0 && `${m.undone ? 'Undone: ' : 'Saved '}${writes.length} ${writes.length === 1 ? 'change' : 'changes'}`}
          {refused.length > 0 && `${writes.length ? ' · ' : ''}${refused.length} not saved`}
          <span>{open ? 'Hide' : 'Details'}</span>
        </button>
      )}
      {open && (
        <ul className="steps">
          {(m.steps ?? []).map((s, j) => (
            <li key={j} className={s.result.refused ? 'refused' : s.tool === 'lookup' ? 'read' : 'wrote'}>{stepLine(s)}</li>
          ))}
          {m.usage && (
            <li className="read">
              {m.usage.input_tokens.toLocaleString()} tokens in ({m.usage.cached_input_tokens.toLocaleString()} cached), {m.usage.output_tokens.toLocaleString()} out
            </li>
          )}
        </ul>
      )}
      {m.drafts?.map((d, j) =>
        d.ok && d.id ? (
          <details className="msg-draft" key={j}>
            <summary>Thank-you draft for {d.who}</summary>
            <DraftCard id={d.id} body={d.body ?? ''} check={d.check ?? ''} send={d.send ?? ''} warnings={d.warnings} onSent={onChanged} />
          </details>
        ) : (
          <p key={j} className="notice error">{d.reason}</p>
        ),
      )}
      {canUndo && (
        <button className="link undo" onClick={onUndo}>
          Undo these changes
        </button>
      )}
    </div>
  )
}

export default function Assistant({ userId, onChanged, inline = false }: { userId: number; onChanged: () => void; inline?: boolean }) {
  const store = `${STORE}-${userId}` // each account keeps its own thread in this browser
  const [messages, setMessages] = useState<Message[]>(() => load(store))
  // Save on every change, right away: a saved change refreshes the page, which can remount this component.
  const setThread = (fn: (prev: Message[]) => Message[]) =>
    setMessages((prev) => {
      const next = fn(prev)
      try {
        localStorage.setItem(store, JSON.stringify(next.slice(-40)))
      } catch {
        /* storage unavailable: the thread just won't survive a refresh */
      }
      return next
    })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState<false | 'recap' | 'conversation'>(false)
  const thread = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(store, JSON.stringify(messages.slice(-40)))
    } catch {
      /* storage unavailable: the thread just won't survive a refresh */
    }
  }, [messages, store])

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, open])

  // Grow the box with what is typed or dictated, up to a limit, so Send never moves out of view.
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft, open])

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  async function send() {
    // Read the box itself: some dictation tools put text in without telling the page it changed.
    const text = (input.current?.value ?? draft).trim()
    if (busy || !text) return
    const history = messages.map((m) => ({ role: m.role, text: m.text }))
    setThread((m) => [...m, { role: 'user', text }])
    setDraft('')
    setBusy(true)
    try {
      const out = await post<AssistantReply>('/api/assistant', { message: text, history })
      setThread((m) => [...m, { role: 'assistant', text: out.reply, ...out }])
      if (out.changed) onChanged()
    } catch (e) {
      setThread((m) => [...m, { role: 'assistant', text: `Nothing was saved. ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  async function undo(runId: number) {
    const out = await post<{ ok: boolean; reason?: string }>('/api/assistant/undo', { run_id: runId })
    if (out.ok) {
      setThread((m) => m.map((x) => (x.run_id === runId ? { ...x, undone: true } : x)))
      onChanged()
    } else {
      setThread((m) => [...m, { role: 'assistant', text: out.reason ?? 'Could not undo that.' }])
    }
  }

  const lastChange = [...messages].reverse().find((m) => m.changed && !m.undone)?.run_id

  const recorder = recording && (
    <Recorder
      initialMode={recording}
      onClose={() => setRecording(false)}
      onFiled={(label, out) => {
        setRecording(false)
        if (!inline) setOpen(true)
        setThread((m) => [...m, { role: 'user', text: `Recorded chat: ${label}` }, { role: 'assistant', text: out.reply, ...out }])
        if (out.changed) onChanged()
      }}
    />
  )

  if (inline) {
    const recent = messages.slice(-6)
    return (
      <section className="home-assistant">
        <h2>Anything happen?</h2>
        <p>A coffee chat, an email, an invite, an application? Tell me in plain words and I'll update your map, thank-you notes and next steps.</p>
        <form
          className="home-compose"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <textarea
            ref={input}
            rows={3}
            value={draft}
            placeholder="e.g. Had a coffee chat with Jordan Lee at Citi this morning. We talked about…"
            onChange={(e) => setDraft(e.target.value)}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Working…' : 'Update'}
          </button>
        </form>
        <div className="home-actions">
          <button type="button" className="record-btn" onClick={() => setRecording('conversation')}>
            <span aria-hidden>●</span> Going into a coffee chat? Record it
          </button>
          <button type="button" className="link" onClick={() => setRecording('recap')}>
            Or dictate a recap after
          </button>
          {messages.length > 0 && (
            <button type="button" className="link muted-link" onClick={() => setThread(() => [])}>
              Clear conversation
            </button>
          )}
        </div>
        {(recent.length > 0 || busy) && (
          <div className="assistant-thread home-thread" ref={thread}>
            {recent.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="msg user">
                  <p>{m.text}</p>
                </div>
              ) : (
                <Reply key={i} m={m} canUndo={!!m.changed && !m.undone && m.run_id === lastChange} onUndo={() => undo(m.run_id!)} onChanged={onChanged} />
              ),
            )}
            {busy && (
              <div className="msg assistant pending">
                <span className="dots" aria-label="Working">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>
        )}
        {recorder}
      </section>
    )
  }

  return (
    <>
      {!open && (
        <button className="assistant-fab" onClick={() => setOpen(true)} aria-label="Open the assistant">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M4 5h16v10H8l-4 4z" /></svg>
          Assistant
        </button>
      )}
      {open && (
        <aside className="assistant-panel" aria-label="Tracker assistant">
          <header className="assistant-head">
            <strong>Assistant</strong>
            <span>
              <button className="btn" onClick={() => setRecording('conversation')} title="Record a chat or dictate a recap">
                Record
              </button>
              {messages.length > 0 && (
                <button className="link" onClick={() => setThread(() => [])}>
                  Clear
                </button>
              )}
              <button className="icon-close" onClick={() => setOpen(false)} aria-label="Close the assistant" title="Close">
                <svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </span>
          </header>

          <div className="assistant-thread" ref={thread}>
            {messages.length === 0 && (
              <div className="assistant-empty">
                <p>Tell me what happened and I'll update your tracker: chats, events, referrals, applications, next steps.</p>
                {EXAMPLES.map((e) => (
                  <button key={e} className="example" onClick={() => setDraft(e)}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="msg user">
                  <p>{m.text}</p>
                </div>
              ) : (
                <Reply key={i} m={m} canUndo={!!m.changed && !m.undone && m.run_id === lastChange} onUndo={() => undo(m.run_id!)} onChanged={onChanged} />
              ),
            )}
            {busy && (
              <div className="msg assistant pending">
                <span className="dots" aria-label="Working">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>

          <form
            className="assistant-compose"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <textarea
              ref={input}
              rows={1}
              value={draft}
              placeholder="What happened? (Enter to send, Shift+Enter for a new line)"
              onChange={(e) => setDraft(e.target.value)}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button type="submit" className="primary" disabled={busy}>
              Send
            </button>
          </form>
        </aside>
      )}
      {recorder}
    </>
  )
}
