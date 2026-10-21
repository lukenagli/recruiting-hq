import { useEffect, useRef, useState } from 'react'

// The browser's built-in speech recognition (Chrome, Edge, Safari). It is not in TypeScript's DOM types.
export type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}
/** The browser's speech recognizer, or undefined where there is none (e.g. Firefox). Looked up when needed. */
export function speechRecognition(): (new () => Recognition) | undefined {
  const w = window as unknown as Record<string, new () => Recognition>
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

const PROBLEMS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow microphone access for this site, then try again.',
  'service-not-allowed': 'The microphone is blocked. Allow microphone access for this site, then try again.',
  'audio-capture': 'No microphone was found.',
  network: "This browser couldn't reach its speech service. Try Chrome, Edge or Safari.",
}

/** Speech to text for a text box: each finished phrase is passed to `onPhrase`; nothing is recorded or sent anywhere else. */
export function useDictation(onPhrase: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const rec = useRef<Recognition | null>(null)
  const wanted = useRef(false) // true until the user taps the mic again
  const phrase = useRef(onPhrase)
  phrase.current = onPhrase

  useEffect(() => () => {
    wanted.current = false
    rec.current?.stop()
  }, [])

  function stop() {
    wanted.current = false
    rec.current?.stop()
    setListening(false)
    setInterim('')
  }

  function start() {
    const Engine = speechRecognition()
    if (!Engine) return
    setError('')
    const r = new Engine()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'
    r.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript
        if (e.results[i].isFinal) phrase.current(piece.trim())
        else live += piece
      }
      setInterim(live)
    }
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return // normal pauses
      setError(PROBLEMS[e.error] ?? `Dictation stopped (${e.error}).`)
      stop()
    }
    // The browser ends recognition after a pause; keep going until the user taps the mic again.
    r.onend = () => {
      if (!wanted.current) return
      try {
        r.start()
      } catch {
        /* already restarting */
      }
    }
    rec.current = r
    wanted.current = true
    try {
      r.start()
      setListening(true)
    } catch {
      setError('Dictation could not start. Try again.')
      wanted.current = false
    }
  }

  return { supported: !!speechRecognition(), listening, interim, error, toggle: () => (listening ? stop() : start()), stop }
}
