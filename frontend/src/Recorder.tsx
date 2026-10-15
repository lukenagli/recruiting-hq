import { useEffect, useRef, useState } from 'react'
import { post } from './api'
import type { AssistantReply } from './api'

type Mode = 'recap' | 'conversation'
type Phase = 'setup' | 'recording' | 'review' | 'filing'

// The browser's built-in speech recognition (Chrome and Edge). It is not in TypeScript's DOM types.
type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}
const SpeechRecognition = (window as unknown as Record<string, new () => Recognition>).SpeechRecognition ??
  (window as unknown as Record<string, new () => Recognition>).webkitSpeechRecognition

export default function Recorder(props: { onClose: () => void; onFiled: (label: string, reply: AssistantReply) => void }) {
  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<Mode>('recap')
  const [label, setLabel] = useState('')
  const [consent, setConsent] = useState(false)
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const recognition = useRef<Recognition | null>(null)
  const wanted = useRef(false) // true while the user wants recording to continue

  useEffect(() => {
    if (phase !== 'recording') return
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [phase])
  useEffect(() => () => {
    wanted.current = false
    recognition.current?.stop()
  }, [])

  function start() {
    setError('')
    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript
        if (e.results[i].isFinal) setText((t) => `${t}${t && !t.endsWith('\n') ? ' ' : ''}${piece.trim()}`)
        else live += piece
      }
      setInterim(live)
    }
    rec.onerror = (e) => {
      // "no-speech" and "aborted" are normal pauses; anything else means recognition cannot work here.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      wanted.current = false
      const reasons: Record<string, string> = {
        'not-allowed': 'The microphone is blocked. Allow microphone access for this page, then start again.',
        'service-not-allowed': 'The microphone is blocked. Allow microphone access for this page, then start again.',
        'audio-capture': 'No microphone was found. Plug one in or check your sound settings, then start again.',
        network: "This browser could not reach its speech service. Open the app in Chrome or Edge (not an embedded window) and try again.",
      }
      setError(`${reasons[e.error] ?? `Speech recognition stopped (${e.error}).`} Anything heard so far is kept below.`)
      setInterim('')
      setPhase('review')
    }
    // The browser ends recognition after a pause; restart it until the user presses Stop.
    rec.onend = () => {
      if (wanted.current) {
        setText((t) => (t && !t.endsWith('\n') ? `${t}\n` : t))
        try {
          rec.start()
        } catch {
          /* already restarting */
        }
      }
    }
    recognition.current = rec
    wanted.current = true
    rec.start()
    setPhase('recording')
  }

  function stop() {
    wanted.current = false
    recognition.current?.stop()
    setInterim('')
    setPhase('review')
  }

  async function file() {
    setPhase('filing')
    setError('')
    try {
      const reply = await post<AssistantReply>('/api/recordings', { label, mode, text })
      props.onFiled(label, reply)
    } catch (e) {
      setError(`Could not file it (${(e as Error).message}). Your transcript is still here.`)
      setPhase('review')
    }
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const ready = label.trim().length > 1 && (mode === 'recap' || consent)

  return (
    <div className="modal-back" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="panel-head">
          <h3>{phase === 'setup' ? 'Record a chat' : phase === 'recording' ? `Recording · ${clock}` : 'Review the transcript'}</h3>
          <button className="link" onClick={props.onClose} disabled={phase === 'filing'}>
            Close
          </button>
        </div>

        {phase === 'setup' && !SpeechRecognition && (
          <p className="notice error">This browser has no built-in speech recognition. Open the app in Chrome or Edge to record.</p>
        )}
        {phase === 'setup' && SpeechRecognition && (
          <>
            <label className="field">
              Who is it with?
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Jordan Lee, Citi C&R" autoFocus />
            </label>
            <div className="mode-cards">
              <button className={`round-card ${mode === 'recap' ? 'on' : ''}`} onClick={() => setMode('recap')}>
                <strong>Dictate a recap</strong>
                <span>Right after the chat, talk through what happened. Only your voice is captured.</span>
              </button>
              <button className={`round-card ${mode === 'conversation' ? 'on' : ''}`} onClick={() => setMode('conversation')}>
                <strong>Record the conversation</strong>
                <span>Transcribe the chat live. Picks up whatever this device's microphone hears.</span>
              </button>
            </div>
            {mode === 'conversation' && (
              <label className="consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  I have told the other person this conversation is being transcribed and they are fine with it. Recording someone without
                  their agreement is illegal in some states, including for calls with people in California.
                </span>
              </label>
            )}
            <p className="fine">
              Speech is turned into text by the browser's speech service (audio goes to the browser maker to do this). The app keeps the text
              only, never the audio. On a call with headphones, the microphone will only hear you.
            </p>
            {error && <p className="notice error">{error}</p>}
            <button className="primary" disabled={!ready} onClick={start}>
              Start
            </button>
          </>
        )}

        {phase === 'recording' && (
          <>
            <div className="transcript live">
              {text}
              <em> {interim}</em>
              {!text && !interim && <span className="muted">Listening…</span>}
            </div>
            <button className="primary stop" onClick={stop}>
              Stop and review
            </button>
            <p className="fine">After you stop you can fix the text, then file it. You can also type or paste into the box.</p>
          </>
        )}

        {(phase === 'review' || phase === 'filing') && (
          <>
            <p className="fine">Fix any names or numbers the transcription got wrong, then file it. You can undo what gets filed.</p>
            {text.trim().length < 40 && (
              <p className="notice">Nothing usable was captured yet. Type or paste your notes into the box, or keep recording.</p>
            )}
            <textarea className="transcript" value={text} onChange={(e) => setText(e.target.value)} disabled={phase === 'filing'} />
            {error && <p className="notice error">{error}</p>}
            <button className="primary" disabled={phase === 'filing' || text.trim().length < 40} onClick={file}>
              {phase === 'filing' ? 'Filing… this can take a minute' : 'File it in my tracker'}
            </button>
            {phase === 'review' && (
              <button className="btn" onClick={start}>
                Keep recording
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
