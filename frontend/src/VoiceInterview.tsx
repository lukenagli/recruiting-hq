import { useEffect, useRef, useState } from 'react'
import { get, post } from './api'
import type { Graded, PracticeQuestion, Session } from './api'
import { speechRecognition } from './dictation'
import type { Recognition } from './dictation'
import type { Setup } from './Practice'

/**
 * A spoken mock interview. The interviewer talks (the browser's own voice) and listens (its speech recognition); the
 * questions are the practice ones for the chosen setup, and each answer is graded like a typed one. It opens with
 * small talk, then asks whether the student wants feedback after each question or all of it at the end.
 * Nothing is recorded: only the words of each answer are sent, to be graded.
 */

type Turn = { who: 'interviewer' | 'you'; text: string }
type Result = { q: PracticeQuestion; said: string; g: Graded }
type Mode = 'each' | 'end'
const VERDICT = { correct: 'Correct', partial: 'Partly right', incorrect: 'Not quite' } as const

export const voiceSupported = () => !!speechRecognition() && typeof window !== 'undefined' && 'speechSynthesis' in window

/** The most natural English voice the browser has. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
  const prefer = [/natural/i, /google us english/i, /samantha/i, /aria/i, /jenny/i, /guy/i, /en-us/i]
  for (const p of prefer) {
    const v = voices.find((x) => p.test(x.name) || p.test(x.lang))
    if (v) return v
  }
  return voices[0] ?? null
}

/** The first sentence or two of the grader's feedback, short enough to say out loud. */
function spoken(text: string, sentences = 2) {
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) ?? [text]
  return parts.slice(0, sentences).join(' ').trim()
}

function feedbackPreference(said: string): Mode | null {
  const s = said.toLowerCase()
  if (/\b(end|after (it'?s )?all|at the end|all at once|save it|wait)\b/.test(s)) return 'end'
  if (/\b(each|every|after (each|every)|as we go|one by one|each one|each question|right away|straight away)\b/.test(s)) return 'each'
  return null
}

const DONE_WORDS = /\b(that'?s (my|the) answer|i'?m (done|finished)|that'?s it|done answering)\W*$/i

export default function VoiceInterview({ setup, onExit }: { setup: Setup; onExit: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [phase, setPhase] = useState<'ready' | 'speaking' | 'listening' | 'thinking' | 'over'>('ready')
  const [live, setLive] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [mode, setMode] = useState<Mode | null>(null)
  const [count, setCount] = useState(5)
  const [error, setError] = useState('')
  const stopped = useRef(false)
  const finish = useRef<(() => void) | null>(null) // ends the current answer now ("Done answering")
  const skipNow = useRef(false)
  const current = useRef<PracticeQuestion | null>(null)
  const voice = useRef<SpeechSynthesisVoice | null>(null)
  const rec = useRef<Recognition | null>(null)
  const thread = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const load = () => (voice.current = pickVoice())
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => {
      stopped.current = true
      window.speechSynthesis.removeEventListener?.('voiceschanged', load)
      window.speechSynthesis.cancel()
      rec.current?.stop()
    }
  }, [])
  useEffect(() => {
    thread.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [turns, live])

  const add = (who: Turn['who'], text: string) => setTurns((t) => [...t, { who, text }])

  /** Say something, sentence by sentence (long utterances get cut off in some browsers). */
  async function say(text: string) {
    if (stopped.current || !text.trim()) return
    add('interviewer', text)
    setPhase('speaking')
    for (const part of text.match(/[^.!?]+[.!?]*/g) ?? [text]) {
      if (stopped.current) return
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(part.trim())
        if (voice.current) u.voice = voice.current
        u.rate = 1.02
        // some browsers never say they finished (no voice, a stalled engine): carry on after the time it would take
        const safety = setTimeout(resolve, 2500 + part.split(/\s+/).length * 450)
        const done = () => {
          clearTimeout(safety)
          resolve()
        }
        u.onend = done
        u.onerror = done
        window.speechSynthesis.speak(u)
      })
    }
  }

  /** Listen until the student stops talking for `quiet` ms (or says they're done, or presses Done answering). */
  function listen(quiet: number, wait = 25000): Promise<string> {
    return new Promise((resolve) => {
      if (stopped.current) return resolve('')
      const Engine = speechRecognition()
      if (!Engine) return resolve('')
      let text = ''
      let interim = ''
      let heard = 0
      const began = Date.now()
      let over = false
      const r = new Engine()
      r.continuous = true
      r.interimResults = true
      r.lang = 'en-US'
      const end = () => {
        if (over) return
        over = true
        clearInterval(timer)
        finish.current = null
        r.onend = null
        r.stop()
        setLive('')
        resolve(`${text} ${interim}`.replace(/\s+/g, ' ').trim())
      }
      finish.current = end
      r.onresult = (e) => {
        interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const piece = e.results[i][0].transcript
          if (e.results[i].isFinal) text += ` ${piece}`
          else interim += piece
        }
        heard = Date.now()
        setLive(`${text} ${interim}`.trim())
        if (DONE_WORDS.test(`${text} ${interim}`.trim())) {
          text = `${text} ${interim}`.replace(DONE_WORDS, '')
          interim = ''
          end()
        }
      }
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setError('The microphone is blocked. Allow microphone access for this site, then start again.')
          stopped.current = true
          end()
        }
      }
      r.onend = () => {
        if (!over) {
          try {
            r.start() // the browser stops after a pause; keep listening until the answer is over
          } catch {
            /* already restarting */
          }
        }
      }
      const timer = setInterval(() => {
        if (stopped.current) return end()
        const said = `${text} ${interim}`.trim()
        if (said && Date.now() - heard > quiet) end()
        if (!said && Date.now() - began > wait) end()
      }, 250)
      rec.current = r
      setPhase('listening')
      try {
        r.start()
      } catch {
        end()
      }
    })
  }

  async function hear(quiet: number, wait?: number) {
    const said = await listen(quiet, wait)
    if (said) add('you', said)
    return said
  }

  async function run() {
    stopped.current = false
    setError('')
    setTurns([])
    setResults([])
    const done: Result[] = []
    try {
      const me = await get<Session>('/api/session').catch(() => null)
      const first = me?.user?.name?.split(' ')[0] ?? ''
      await say(`Hey${first ? ` ${first}` : ''}, thanks for making the time. How are you doing today?`)
      const howAreYou = await hear(1600, 15000)
      setPhase('thinking')
      const { reply } = await post<{ reply: string }>('/api/practice/interviewer/small-talk', { said: howAreYou, bank: setup.bank })
        .catch(() => ({ reply: 'Good to hear.' }))
      await say(`${reply} Before we start: would you like feedback after each question, or all of it at the end?`)
      let pref = feedbackPreference(await hear(1600, 15000))
      if (!pref && !stopped.current) {
        await say('Sorry, I missed that. Feedback after each question, or all at the end?')
        pref = feedbackPreference(await hear(1600, 15000)) ?? 'each'
      }
      setMode(pref)
      await say(pref === 'end'
        ? `Sounds good, I'll save it all for the end. I have ${count} questions for you. Take your time, and say "that's my answer" when you're done.`
        : `Sounds good, I'll give you feedback as we go. I have ${count} questions for you. Take your time, and say "that's my answer" when you're done.`)
      const seen: string[] = []
      for (let n = 0; n < count && !stopped.current; n++) {
        setPhase('thinking')
        const { question } = await post<{ question: PracticeQuestion | null }>('/api/practice/next', { ...setup, seen, like: '' })
        if (!question) {
          await say("That's every question I have for these settings.")
          break
        }
        seen.push(question.key)
        current.current = question
        skipNow.current = false
        await say(`${n === 0 ? 'First question.' : n === count - 1 ? 'Last question.' : 'Next question.'} ${question.question}`)
        const answer = await hear(3500, 60000)
        if (stopped.current) break
        if (skipNow.current || !answer) {
          await say(answer ? "No problem, let's move on." : "Let's move on to the next one.")
          continue
        }
        setPhase('thinking')
        const g = await post<Graded>('/api/practice/answer', { key: question.key, answer })
        done.push({ q: question, said: answer, g })
        setResults([...done])
        if (pref !== 'end') {
          const verdict = g.verdict ? `${VERDICT[g.verdict]}. ` : ''
          const key = g.verdict && g.verdict !== 'correct' && g.answer && g.answer.length < 160 ? ` The answer is ${g.answer}.` : ''
          await say(`${verdict}${spoken(g.feedback || g.explanation || '')}${key}`)
        } else if (n < count - 1) {
          await say('Thanks.')
        }
      }
      if (!stopped.current) {
        const right = done.filter((r) => r.g.verdict === 'correct').length
        const marked = done.filter((r) => r.g.verdict).length // answers the grader could mark
        const score = marked ? ` You got ${right} of ${marked} fully right.` : ''
        if (pref === 'end' && done.length) {
          await say(`That's all my questions.${score} Here's the feedback.`)
          for (const [i, r] of done.entries()) {
            if (stopped.current) break
            await say(`Question ${i + 1}: ${r.g.verdict ? VERDICT[r.g.verdict] + '. ' : ''}${spoken(r.g.feedback || r.g.explanation || '', 1)}`)
          }
          await say('The full feedback is written out on screen. Thanks, and good luck.')
        } else {
          await say(`That's all I have.${score} Thanks, and good luck.`)
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPhase('over')
      setLive('')
    }
  }

  function stop() {
    stopped.current = true
    window.speechSynthesis.cancel()
    finish.current?.()
    setPhase('over')
  }

  if (!voiceSupported())
    return (
      <div className="card voice-interview">
        <p>Voice interviews need Chrome, Edge or Safari, which can speak and listen. Try one of those, or practice by typing or dictating.</p>
        <button className="ghost" onClick={onExit}>Back</button>
      </div>
    )

  return (
    <div className="card voice-interview">
      <div className="vi-head">
        <h3>Voice interview</h3>
        {phase === 'ready' || phase === 'over' ? (
          <button className="link muted" onClick={onExit}>Back to practice</button>
        ) : (
          <button className="link danger-link" onClick={stop}>End the interview</button>
        )}
      </div>
      {phase === 'ready' && (
        <div className="vi-start">
          <p>
            The interviewer talks to you out loud and listens to your answers, using the practice settings above. It starts with a little
            small talk, then asks whether you want feedback after each question or all at the end. Wear headphones if you can, so it
            doesn't hear itself.
          </p>
          <label className="vi-count">
            Questions
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="primary big" onClick={run}>Start the interview</button>
        </div>
      )}
      {turns.length > 0 && (
        <ol className="vi-thread" ref={thread}>
          {turns.map((t, i) => (
            <li key={i} className={`vi-turn vi-${t.who}`}>
              <small>{t.who === 'interviewer' ? 'Interviewer' : 'You'}</small>
              <p>{t.text}</p>
            </li>
          ))}
          {live && (
            <li className="vi-turn vi-you vi-live">
              <small>You</small>
              <p>{live}</p>
            </li>
          )}
        </ol>
      )}
      {phase !== 'ready' && phase !== 'over' && (
        <div className="vi-controls">
          <span className={`vi-status vi-${phase}`}>
            {phase === 'speaking' ? 'Interviewer speaking…' : phase === 'listening' ? 'Listening… pause or say "that\'s my answer" when you\'re done' : 'One moment…'}
          </span>
          {phase === 'listening' && <button className="primary" onClick={() => finish.current?.()}>Done answering</button>}
          {phase === 'listening' && current.current && (
            <button className="ghost" onClick={() => { skipNow.current = true; finish.current?.() }}>Skip</button>
          )}
          {phase === 'speaking' && <button className="ghost" onClick={() => window.speechSynthesis.cancel()}>Skip ahead</button>}
        </div>
      )}
      {error && <p className="notice error">{error}</p>}
      {phase === 'over' && results.length > 0 && (
        <div className="vi-results">
          <h4>
            {mode === 'end' ? 'Your feedback' : 'How it went'}
            {results.some((r) => r.g.verdict) &&
              `: ${results.filter((r) => r.g.verdict === 'correct').length} of ${results.filter((r) => r.g.verdict).length} fully right`}
          </h4>
          <ol>
            {results.map((r, i) => (
              <li key={i}>
                <strong>{r.q.question}</strong>
                <p className="muted"><em>You said:</em> {r.said}</p>
                {r.g.verdict && <p className={`verdict v-${r.g.verdict}`}>{VERDICT[r.g.verdict]}</p>}
                {r.g.feedback && <p>{r.g.feedback}</p>}
                {r.g.answer && <p><strong>Answer:</strong> {r.g.answer}</p>}
              </li>
            ))}
          </ol>
          <button className="primary" onClick={() => { setPhase('ready'); setTurns([]); setResults([]) }}>Another interview</button>
        </div>
      )}
      {phase === 'over' && results.length === 0 && turns.length > 0 && (
        <button className="primary" onClick={() => { setPhase('ready'); setTurns([]) }}>Start again</button>
      )}
    </div>
  )
}
