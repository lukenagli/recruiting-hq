import { useEffect, useRef, useState } from 'react'
import { post } from './api'
import type { AssistantReply, AssistantStep } from './api'
import DraftCard from './DraftCard'
import Recorder from './Recorder'

type Message = { role: 'user' | 'assistant'; text: string; undone?: boolean } & Partial<AssistantReply>

const STORE = 'assistant-thread'
const EXAMPLES = [
  'I spoke with Jordan Lee from Citi this morning on Zoom. She asked why Citi and suggested I email…',
  'I applied to Guggenheim today',
  'My Barclays contact invited me to their happy hour on Friday',
]

function load(key: string): Message[] {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? '[]')
  } catch {
    return []
  }
}

function stepLine(s: AssistantStep) {
  if (s.result.refused) return `Not saved: ${s.result.reason}`
  if (s.tool === 'lookup') return `Looked up "${String(s.args.query)}"${s.result.found ? '' : ' (nothing found)'}`
  return s.result.did ?? s.tool
}

export default function Assistant({ userId, onChanged }: { userId: number; onChanged: () => void }) {
  const store = `${STORE}-${userId}` // each account keeps its own thread in this browser
  const [messages, setMessages] = useState<Message[]>(() => load(store))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState(false)
  const thread = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  // Grow the box with what is typed or dictated, so long recaps stay readable and Send stays in view.
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `px`
  }, [draft, open])

  useEffect(() => {
    try {
      sessionStorage.setItem(store, JSON.stringify(messages.slice(-30)))
    } catch {
      /* storage unavailable: the thread just won't survive a refresh */
    }
    thread.current?.scrollTo(0, thread.current.scrollHeight)
  }, [messages, open, busy])

  async function send() {
    // Read the box itself: some dictation tools put text in without telling the page it changed.
    const text = (input.current?.value ?? draft).trim()
    if (busy) return
    if (!text) {
      input.current?.focus()
      return
    }
    const history = messages.map((m) => ({ role: m.role, text: m.text }))
    setMessages((m) => [...m, { role: 'user', text }])
    setDraft('')
    setOpen(true)
    setBusy(true)
    try {
      const out = await post<AssistantReply>('/api/assistant', { message: text, history })
      setMessages((m) => [...m, { role: 'assistant', text: out.reply, ...out }])
      if (out.changed) onChanged()
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `Nothing was saved. ${(e as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  async function undo(runId: number) {
    const out = await post<{ ok: boolean; reason?: string }>('/api/assistant/undo', { run_id: runId })
    if (out.ok) {
      setMessages((m) => m.map((x) => (x.run_id === runId ? { ...x, undone: true } : x)))
      onChanged()
    } else {
      setMessages((m) => [...m, { role: 'assistant', text: out.reason ?? 'Could not undo that.' }])
    }
  }

  const lastChange = [...messages].reverse().find((m) => m.changed && !m.undone)?.run_id

  return (
    <div className={`assistant ${open ? 'open' : ''}`}>
      {open && (
        <div className="assistant-thread" ref={thread}>
          <div className="assistant-bar">
            <strong>Tracker assistant</strong>
            <span>
              {messages.length > 0 && (
                <button className="link" onClick={() => setMessages([])}>
                  Clear
                </button>
              )}
              <button className="link" onClick={() => setOpen(false)}>
                Hide
              </button>
            </span>
          </div>
          {messages.length === 0 && (
            <div className="assistant-empty">
              <p>Tell me what happened and I'll file it in your tracker. For example:</p>
              {EXAMPLES.map((e) => (
                <button key={e} className="example" onClick={() => setDraft(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <p>{m.text}</p>
              {m.steps && m.steps.length > 0 && (
                <ul className="steps">
                  {m.steps.map((s, j) => (
                    <li key={j} className={s.result.refused ? 'refused' : s.tool === 'lookup' ? 'read' : 'wrote'}>
                      {stepLine(s)}
                    </li>
                  ))}
                </ul>
              )}
              {m.drafts?.map((d, j) =>
                d.ok && d.id ? (
                  <DraftCard key={j} id={d.id} body={d.body ?? ''} check={d.check ?? ''} send={d.send ?? ''} warnings={d.warnings} onSent={onChanged} />
                ) : (
                  <p key={j} className="notice error">{d.reason}</p>
                ),
              )}
              {m.role === 'assistant' && (m.usage || m.changed) && (
                <div className="msg-foot">
                  {m.usage && (
                    <span title="Tokens used by this request">
                      {m.usage.input_tokens.toLocaleString()} in ({m.usage.cached_input_tokens.toLocaleString()} cached) · {m.usage.output_tokens.toLocaleString()} out · {m.usage.requests} model {m.usage.requests === 1 ? 'call' : 'calls'}
                    </span>
                  )}
                  {m.undone && <em>Undone</em>}
                  {m.changed && !m.undone && m.run_id === lastChange && (
                    <button className="link" onClick={() => undo(m.run_id!)}>
                      Undo these changes
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="msg assistant pending">Working on it…</div>}
        </div>
      )}
      <form
        className="assistant-input"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          ref={input}
          rows={1}
          value={draft}
          onInput={(e) => setDraft(e.currentTarget.value)}
          placeholder="Tell me what happened, or what to add or change…"
          onFocus={() => setOpen(true)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button type="button" className="mic" title="Record a chat or dictate a recap" onClick={() => setRecording(true)}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          Record
        </button>
        <button type="submit" disabled={busy}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
      {recording && (
        <Recorder
          onClose={() => setRecording(false)}
          onFiled={(label, out) => {
            setRecording(false)
            setOpen(true)
            setMessages((m) => [...m, { role: 'user', text: `Recorded chat: ${label}` }, { role: 'assistant', text: out.reply, ...out }])
            if (out.changed) onChanged()
          }}
        />
      )}
    </div>
  )
}
