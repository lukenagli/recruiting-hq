import { useEffect, useRef, useState } from 'react'
import { del, post } from './api'
import type { Story, StoryBank } from './api'
import { useDictation } from './dictation'
import { Loading, useApi } from './ui'

/**
 * Your stories: the six to eight stories from your own experience that bend to any behavioral question.
 *
 * The Finance Club's Superday deck says to prepare a story bank rather than an answer per question: a handful of
 * real stories, each mapped to the buckets interviewers test, a positive and a negative per bucket where you can.
 * The coach builds them in a conversation (it reads the resume, asks about each role, digs for the specifics) and
 * saves each one in the student's own words. Practice feedback then says which story to use for a question.
 */

type Turn = { role: 'user' | 'coach'; text: string; saved?: string[] }
type ChatReply = { reply: string; saved: string[]; stories: Story[]; coverage: StoryBank['coverage'] }
const THREAD_KEY = 'rhq-story-thread' // the conversation survives a page refresh (this tab only)
const POLARITIES: Story['polarity'][] = ['went well', 'went wrong']

function loadThread(): Turn[] {
  try {
    const raw = sessionStorage.getItem(THREAD_KEY)
    const turns = raw ? (JSON.parse(raw) as Turn[]) : []
    return Array.isArray(turns) ? turns : []
  } catch {
    return []
  }
}

/** Say a reply out loud, sentence by sentence (long utterances get cut off in some browsers). */
function speak(text: string) {
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel()
  for (const part of text.match(/[^.!?]+[.!?]*/g) ?? [text]) {
    const u = new SpeechSynthesisUtterance(part.trim())
    u.rate = 1.02
    synth.speak(u)
  }
}

export default function Stories() {
  const bank = useApi<StoryBank>('/api/stories')
  const [data, setData] = useState<StoryBank | null>(null)
  const [editing, setEditing] = useState<Story | 'new' | null>(null)
  useEffect(() => {
    if (bank.data) setData(bank.data)
  }, [bank.data])
  if (!data) return <Loading error={bank.error} />
  const count = data.stories.length
  const done = (d: StoryBank | null) => {
    if (d) setData(d)
    setEditing(null)
  }
  return (
    <section className="card stories">
      <p className="lede">
        Interviewers ask hundreds of different "tell me about a time" questions, and nobody can prepare an answer for each. What works is
        six to eight real stories from your own experience, each covering several of the eight things interviewers test, told so they bend
        to any question. The coach builds them with you from what you've actually done, and your practice feedback then says which story to
        use and how to frame it.
      </p>
      <Coverage data={data} />
      <Coach data={data} onUpdate={setData} />
      <div className="story-list">
        <div className="story-list-head">
          <h4>{count ? `${count} ${count === 1 ? 'story' : 'stories'} in your bank` : 'No stories yet'}</h4>
          {editing !== 'new' && (
            <button type="button" className="link" onClick={() => setEditing('new')}>
              Add one by hand
            </button>
          )}
        </div>
        {editing === 'new' && <StoryForm story={null} buckets={data.buckets} onDone={done} />}
        {data.stories.map((s) =>
          editing && editing !== 'new' && editing.id === s.id ? (
            <StoryForm key={s.id} story={s} buckets={data.buckets} onDone={done} />
          ) : (
            <StoryCard key={s.id} story={s} buckets={data.buckets} onEdit={() => setEditing(s)} onChanged={setData} />
          ),
        )}
      </div>
    </section>
  )
}

/** The eight buckets, each with the stories that answer it (a positive and a negative per bucket is the goal). */
function Coverage({ data }: { data: StoryBank }) {
  return (
    <div className="story-coverage" aria-label="What your stories cover">
      {data.buckets.map((b) => {
        const well = data.coverage[b.key]?.['went well'] ?? []
        const wrong = data.coverage[b.key]?.['went wrong'] ?? []
        const covered = well.length + wrong.length > 0
        return (
          <div key={b.key} className={`bucket ${covered ? 'covered' : ''}`}>
            <strong>{b.name}</strong>
            <small>{b.asks}</small>
            {covered ? (
              <ul>
                {well.map((t) => (
                  <li key={`w-${t}`}>
                    <i title="went well">✓</i>
                    {t}
                  </li>
                ))}
                {wrong.map((t) => (
                  <li key={`x-${t}`}>
                    <i title="went wrong">↯</i>
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              <ul>
                <li className="gap">no story yet</li>
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The conversation with the coach: it asks, you talk (or dictate), it saves each story as it has enough. */
function Coach({ data, onUpdate }: { data: StoryBank; onUpdate: (d: StoryBank) => void }) {
  const [turns, setTurns] = useState<Turn[]>(loadThread)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [aloud, setAloud] = useState(false)
  const thread = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const dictation = useDictation((phrase) => setDraft((v) => `${v}${v && !/\s$/.test(v) ? ' ' : ''}${phrase}`))

  useEffect(() => {
    try {
      sessionStorage.setItem(THREAD_KEY, JSON.stringify(turns.slice(-40)))
    } catch {
      /* private window: the thread just is not kept across a refresh */
    }
  }, [turns])
  useEffect(() => {
    thread.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [turns, busy])
  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  async function send(text: string) {
    const message = text.trim()
    if (busy || (!message && turns.length)) return
    dictation.stop()
    setBusy(true)
    setError('')
    setDraft('')
    const history = turns.map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', text: t.text }))
    if (message) setTurns((t) => [...t, { role: 'user', text: message }])
    try {
      const out = await post<ChatReply>('/api/stories/chat', { message: message || '[start]', history })
      setTurns((t) => [...t, { role: 'coach', text: out.reply, saved: out.saved }])
      onUpdate({ ...data, stories: out.stories, coverage: out.coverage })
      if (aloud) speak(out.reply)
    } catch (e) {
      setError((e as Error).message)
      if (message) {
        setDraft(message)
        setTurns((t) => t.slice(0, -1))
      }
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    window.speechSynthesis?.cancel()
    setTurns([])
    setError('')
  }

  if (!turns.length && !busy) {
    const again = data.stories.length > 0
    return (
      <div className="story-coach story-start">
        <p>
          {again
            ? 'Pick the conversation back up: the coach knows the stories you have and will steer toward the gaps.'
            : 'A relaxed conversation, about fifteen minutes. The coach reads your resume, asks about what you did and what you’re proud of, and writes each story up in your words. You can type or dictate.'}
        </p>
        <button type="button" className="primary" onClick={() => send('')}>
          {again ? 'Continue with the coach' : 'Build my story bank'}
        </button>
        {error && <p className="notice error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="story-coach">
      <div className="chat-head">
        <h4>Your coach</h4>
        <span>
          {'speechSynthesis' in window && (
            <label className="story-aloud">
              <input type="checkbox" checked={aloud} onChange={(e) => setAloud(e.target.checked)} /> Read replies aloud
            </label>
          )}
          <button type="button" className="link" onClick={reset} disabled={busy}>
            New conversation
          </button>
        </span>
      </div>
      <div className="assistant-thread chat-thread" ref={thread}>
        {turns.map((t, i) => (
          <div key={i} className={`msg ${t.role === 'user' ? 'user' : 'assistant'}`}>
            <p>{t.text}</p>
            {t.saved && t.saved.length > 0 && <small className="story-saved">{t.saved.join(' · ')}</small>}
          </div>
        ))}
        {busy && (
          <div className="msg assistant">
            <span className="dots" aria-label="Thinking">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
      {error && <p className="notice error">{error}</p>}
      {dictation.error && <p className="notice error">{dictation.error}</p>}
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
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
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder={dictation.listening ? 'Listening…' : 'Your answer…'}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(draft)
            }
          }}
        />
        <button type="submit" className="chat-send" disabled={busy || !draft.trim()} aria-label="Send" title="Send">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
      {dictation.listening && <p className="dictation-status">{dictation.interim || 'Listening… tap the microphone again when you’re done.'}</p>}
    </div>
  )
}

function StoryCard({ story, buckets, onEdit, onChanged }: { story: Story; buckets: StoryBank['buckets']; onEdit: () => void; onChanged: (d: StoryBank) => void }) {
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const names = Object.fromEntries(buckets.map((b) => [b.key, b.name]))

  async function remove() {
    setBusy(true)
    setError('')
    try {
      onChanged(await del<StoryBank>(`/api/stories/${story.id}`))
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
      setSure(false)
    }
  }

  return (
    <article className="story-card">
      <header>
        <h5>{story.title}</h5>
        <span className={`story-polarity ${story.polarity === 'went wrong' ? 'wrong' : 'well'}`}>{story.polarity}</span>
      </header>
      {story.buckets.length > 0 && (
        <div className="story-buckets">
          {story.buckets.map((b) => (
            <span key={b} className="chip mini static">
              {names[b] ?? b}
            </span>
          ))}
        </div>
      )}
      <dl>
        {story.situation && (
          <>
            <dt>Situation and task</dt>
            <dd>{story.situation}</dd>
          </>
        )}
        {story.action && (
          <>
            <dt>Action</dt>
            <dd>{story.action}</dd>
          </>
        )}
        {story.result && (
          <>
            <dt>Result and lesson</dt>
            <dd>{story.result}</dd>
          </>
        )}
      </dl>
      <div className="story-actions">
        <button type="button" className="link" onClick={onEdit}>
          Edit
        </button>
        {sure ? (
          <>
            <button type="button" className="danger" onClick={remove} disabled={busy}>
              {busy ? 'Removing…' : 'Yes, remove it'}
            </button>
            <button type="button" className="link" onClick={() => setSure(false)} disabled={busy}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="link danger-link" onClick={() => setSure(true)}>
            Remove
          </button>
        )}
      </div>
      {error && <p className="notice error">{error}</p>}
    </article>
  )
}

/** Write or change a story by hand (the coach does this for you in the conversation). */
function StoryForm({ story, buckets, onDone }: { story: Story | null; buckets: StoryBank['buckets']; onDone: (d: StoryBank | null) => void }) {
  const [fields, setFields] = useState({
    title: story?.title ?? '',
    situation: story?.situation ?? '',
    action: story?.action ?? '',
    result: story?.result ?? '',
    polarity: story?.polarity ?? 'went well',
  })
  const [tags, setTags] = useState<string[]>(story?.buckets ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields({ ...fields, [k]: e.target.value })

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onDone(await post<StoryBank>(story ? `/api/stories/${story.id}` : '/api/stories', { ...fields, buckets: tags }))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="story-form" onSubmit={save}>
      <label className="field">
        Title (a name you'll recognise it by)
        <input value={fields.title} onChange={set('title')} placeholder="e.g. The Indigo pricing model" maxLength={120} required />
      </label>
      <label className="field">
        Situation and task
        <small>Where, when, the goal and why it mattered. Two or three sentences.</small>
        <textarea rows={2} value={fields.situation} onChange={set('situation')} />
      </label>
      <label className="field">
        Action
        <small>What you personally did, how, and who else was involved. The longest part.</small>
        <textarea rows={4} value={fields.action} onChange={set('action')} />
      </label>
      <label className="field">
        Result and lesson
        <small>The outcome with numbers ($, %, time, people), then the lesson in one sentence.</small>
        <textarea rows={2} value={fields.result} onChange={set('result')} />
      </label>
      <div className="field">
        How it went
        <div className="choice-row">
          {POLARITIES.map((p) => (
            <button key={p} type="button" className={`choice-pill ${fields.polarity === p ? 'on' : ''}`} onClick={() => setFields({ ...fields, polarity: p })}>
              {p === 'went well' ? 'Went well' : 'Went wrong (a stumble with a lesson)'}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        What it shows
        <small>Every bucket it can honestly answer.</small>
        <div className="choice-row">
          {buckets.map((b) => (
            <button
              key={b.key}
              type="button"
              className={`choice-pill ${tags.includes(b.key) ? 'on' : ''}`}
              title={b.asks}
              onClick={() => setTags(tags.includes(b.key) ? tags.filter((t) => t !== b.key) : [...tags, b.key])}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="notice error">{error}</p>}
      <div className="story-form-actions">
        <button className="primary" disabled={busy || !fields.title.trim()}>
          {busy ? 'Saving…' : story ? 'Save changes' : 'Add the story'}
        </button>
        <button type="button" className="ghost" onClick={() => onDone(null)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}
