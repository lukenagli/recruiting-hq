import { useEffect, useRef, useState } from 'react'
import { post, uploadWith } from './api'
import type { AssistantReply, AssistantStep } from './api'
import DraftCard from './DraftCard'
import { useDictation } from './dictation'
import Recorder from './Recorder'
import { usePreview } from './ui'

type Message = { role: 'user' | 'assistant'; text: string; undone?: boolean } & Partial<AssistantReply>

const STORE = 'assistant-thread'
/** Window event that opens the floating assistant: detail { text?: string to send, record?: 'recap' | 'conversation' }. */
export const ASK_EVENT = 'rhq-ask-assistant'
// Files the assistant can read: team cards and rosters, saved emails, screenshots.
const ACCEPT = '.pdf,.docx,.txt,.eml,.png,.jpg,.jpeg,.webp'
const ACCEPT_PREVIEW = `${ACCEPT},.msg` // preview: emails dragged straight out of desktop Outlook
const CLIP = <svg viewBox="0 0 24 24" aria-hidden><path d="M20.5 11.5l-8.3 8.3a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" /></svg>
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
  const preview = usePreview()
  const [messages, setMessages] = useState<Message[]>(() => load(store))
  // Save on every change, right away, outside React's update queue: a saved change refreshes the page, which
  // remounts this component, and an update still queued for the old copy would be dropped (losing the reply).
  const latest = useRef(messages)
  const setThread = (fn: (prev: Message[]) => Message[]) => {
    const next = fn(latest.current)
    latest.current = next
    try {
      localStorage.setItem(store, JSON.stringify(next.slice(-40)))
    } catch {
      /* storage unavailable: the thread just won't survive a refresh */
    }
    setMessages(next)
  }
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState<false | 'recap' | 'conversation'>(false)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  // Talk instead of typing: what you say is typed into the box, to edit before sending.
  const dictation = useDictation((phrase) => setDraft((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}${phrase}`))
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

  // Another part of the page (the home page's update bar) can open this panel, optionally sending a message.
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (inline) return
    const onAsk = (e: Event) => {
      const { text = '', record = '' } = (e as CustomEvent<{ text?: string; record?: 'recap' | 'conversation' }>).detail ?? {}
      setOpen(true)
      if (record) setRecording(record)
      else if (text.trim()) sendRef.current(text)
    }
    window.addEventListener(ASK_EVENT, onAsk)
    return () => window.removeEventListener(ASK_EVENT, onAsk)
  }, [inline])

  async function send(given?: string) {
    // Read the box itself: some dictation tools put text in without telling the page it changed.
    const text = (given ?? input.current?.value ?? draft).trim()
    if (busy || (!text && !file)) return
    dictation.stop()
    const history = messages.map((m) => ({ role: m.role, text: m.text }))
    const attached = file
    setThread((m) => [...m, { role: 'user', text: attached ? `📎 ${attached.name}${text ? ` · ${text}` : ''}` : text }])
    setDraft('')
    setFile(null)
    setBusy(true)
    try {
      const out = attached
        ? await uploadWith<AssistantReply>('/api/assistant/file', attached, { message: text, history: JSON.stringify(history) })
        : await post<AssistantReply>('/api/assistant', { message: text, history })
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

  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      setDragging(false)
      setFile(e.dataTransfer.files[0])
      input.current?.focus()
    },
  }
  // A screenshot pasted into the box is attached like a dropped file.
  const onPaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files.length) {
      e.preventDefault()
      setFile(e.clipboardData.files[0])
    }
  }
  const attach = (
    <>
      <input ref={picker} type="file" accept={preview ? ACCEPT_PREVIEW : ACCEPT} hidden onChange={(e) => {
        setFile(e.target.files?.[0] ?? null)
        e.target.value = ''
      }} />
      <button type="button" className="icon-attach" onClick={() => picker.current?.click()} title="Attach a file (team card, email, PDF, screenshot)" aria-label="Attach a file">
        {CLIP}
      </button>
      {dictation.supported && (
        <button
          type="button"
          className={`icon-attach dictate ${dictation.listening ? 'listening' : ''}`}
          onClick={() => {
            dictation.toggle()
            input.current?.focus()
          }}
          title={dictation.listening ? 'Stop dictating' : 'Dictate instead of typing'}
          aria-label={dictation.listening ? 'Stop dictating' : 'Dictate instead of typing'}
          aria-pressed={dictation.listening}
        >
          <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
      )}
    </>
  )
  // While dictating: what is being heard right now, before it is final.
  const heard = (dictation.listening || dictation.error) && (
    <p className={`dictation-status ${dictation.error ? 'error' : ''}`}>
      {dictation.error || (dictation.interim ? `Hearing: ${dictation.interim}` : 'Listening… tap the mic again when you are done.')}
    </p>
  )
  const chip = file && (
    <div className="attached-file">
      <span>📎 {file.name}</span>
      <button type="button" className="icon-close" onClick={() => setFile(null)} aria-label="Remove the file" title="Remove">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  )

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

  const bubbles = (list: Message[]) => (
    <>
      {list.map((m, i) =>
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
    </>
  )
  const box = (rows: number, placeholder: string) => (
    <textarea
      ref={input}
      rows={rows}
      value={draft}
      placeholder={file ? 'Add a note about this file (optional)' : placeholder}
      onPaste={onPaste}
      onChange={(e) => setDraft(e.target.value)}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          send()
        }
      }}
    />
  )

  // Preview: once a conversation has started, it reads like a messaging app: the thread, then the reply box under it.
  if (inline && preview && (messages.length > 0 || busy)) {
    return (
      <section className={`home-assistant chat ${dragging ? 'dragging' : ''}`} {...drop}>
        <div className="chat-head">
          <h2>Anything happen?</h2>
          <button type="button" className="link" onClick={() => setThread(() => [])} disabled={busy}>
            New chat
          </button>
        </div>
        <div className="assistant-thread chat-thread" ref={thread}>
          {bubbles(messages)}
        </div>
        {dragging && <div className="drop-hint">Drop the file to attach it</div>}
        {chip}
        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          {attach}
          {box(1, 'Reply, or tell me what else happened…')}
          <button type="submit" className="chat-send" disabled={busy || (!draft.trim() && !file)} aria-label="Send" title="Send">
            <svg viewBox="0 0 24 24" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </form>
        {heard}
        <div className="home-actions">
          <button type="button" className="record-btn" onClick={() => setRecording('conversation')}>
            <span aria-hidden>●</span> Record a coffee chat
          </button>
          <button type="button" className="link" onClick={() => setRecording('recap')}>
            Dictate a recap
          </button>
        </div>
        {recorder}
      </section>
    )
  }

  if (inline) {
    const recent = messages.slice(-6)
    return (
      <section className={`home-assistant ${dragging ? 'dragging' : ''}`} {...drop}>
        <h2>Anything happen?</h2>
        <p>
          A coffee chat, an email, an invite, an application? Tell me in plain words, paste an email, or drop in a file (like a bank's team card)
          and I'll update your map, thank-you notes and next steps.
        </p>
        {dragging && <div className="drop-hint">Drop the file to attach it</div>}
        {chip}
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
            placeholder={file ? 'Add a note about this file (optional)' : 'e.g. Had a coffee chat with Jordan Lee at Citi this morning. We talked about…'}
            onPaste={onPaste}
            onChange={(e) => setDraft(e.target.value)}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="compose-buttons">
            {attach}
            <button type="submit" className="primary" disabled={busy}>
              {busy ? (file ? 'Reading…' : 'Working…') : 'Update'}
            </button>
          </div>
        </form>
        {heard}
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
        <aside className={`assistant-panel ${dragging ? 'dragging' : ''}`} aria-label="Tracker assistant" {...drop}>
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

          {dragging && <div className="drop-hint">Drop the file to attach it</div>}
          {chip}
          <form
            className="assistant-compose"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            {attach}
            <textarea
              ref={input}
              rows={1}
              value={draft}
              placeholder={file ? 'Add a note about this file (optional)' : 'What happened? Paste an email or drop a file'}
              onPaste={onPaste}
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
          {heard}
        </aside>
      )}
      {recorder}
    </>
  )
}
