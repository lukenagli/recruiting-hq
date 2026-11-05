import { useLayoutEffect, useRef } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'

/**
 * Bullet lists in a plain textarea, the way a notes app does them:
 * - "- " typed at the start of a line becomes a bullet ("• ");
 * - Tab on a bullet line indents it one level (◦, then ▪), Shift+Tab takes it back out (and off the list at the top);
 * - Enter on a bullet line starts the next bullet at the same level; Enter on an empty bullet ends the list.
 * The text stays plain (two spaces per level and the bullet character), so it reads the same everywhere it is shown.
 */

const SYMBOLS = ['•', '◦', '▪']
const MAX_LEVEL = 4
const BULLET = /^( *)([•◦▪]) /

const prefix = (level: number) => `${'  '.repeat(level)}${SYMBOLS[level % SYMBOLS.length]} `

function lineStart(text: string, pos: number) {
  return text.lastIndexOf('\n', pos - 1) + 1
}

function lineEnd(text: string, pos: number) {
  const end = text.indexOf('\n', pos)
  return end === -1 ? text.length : end
}

export function useBullets(value: string, setValue: (next: string) => void) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<[number, number] | null>(null)
  useLayoutEffect(() => {
    // put the caret (or selection) where the edit left it, once React has drawn the new text
    if (pending.current && ref.current) {
      ref.current.setSelectionRange(pending.current[0], pending.current[1])
      pending.current = null
    }
  })

  function apply(next: string, from: number, to = from) {
    pending.current = [from, to]
    setValue(next)
  }

  function onChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    const pos = e.target.selectionStart
    const start = lineStart(next, pos)
    const typed = /^( *)- $/.exec(next.slice(start, pos))
    const deleting = (e.nativeEvent as InputEvent).inputType?.startsWith('delete')
    if (typed && !deleting) {
      const p = prefix(Math.min(MAX_LEVEL, Math.floor(typed[1].length / 2)))
      return apply(next.slice(0, start) + p + next.slice(pos), start + p.length)
    }
    setValue(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget
    const { selectionStart: selStart, selectionEnd: selEnd } = el
    if (e.key === 'Tab') {
      // every line the selection touches, if any of them is a bullet; otherwise Tab moves on as usual
      const first = lineStart(value, selStart)
      const last = lineEnd(value, selEnd)
      const lines = value.slice(first, last).split('\n')
      if (!lines.some((l) => BULLET.test(l))) return
      e.preventDefault()
      let shiftStart = 0
      let shiftTotal = 0
      const changed = lines.map((line, i) => {
        const m = BULLET.exec(line)
        if (!m) return line
        const level = Math.floor(m[1].length / 2) + (e.shiftKey ? -1 : 1)
        const now = level < 0 ? '' : prefix(Math.min(MAX_LEVEL, level))
        const delta = now.length - m[0].length
        if (i === 0) shiftStart = delta
        shiftTotal += delta
        return now + line.slice(m[0].length)
      })
      const next = value.slice(0, first) + changed.join('\n') + value.slice(last)
      const from = Math.max(first, selStart + shiftStart)
      return apply(next, from, selEnd === selStart ? from : selEnd + shiftTotal)
    }
    if (e.key === 'Enter' && !e.shiftKey && selStart === selEnd) {
      const start = lineStart(value, selStart)
      const line = value.slice(start, lineEnd(value, selStart))
      const m = BULLET.exec(line)
      if (!m) return
      e.preventDefault()
      if (line.slice(m[0].length).trim() === '') {
        // Enter on an empty bullet ends the list: the bullet goes, the line stays
        return apply(value.slice(0, start) + value.slice(start + m[0].length), start)
      }
      const p = prefix(Math.floor(m[1].length / 2))
      return apply(value.slice(0, selStart) + '\n' + p + value.slice(selStart), selStart + 1 + p.length)
    }
  }

  return { ref, onChange, onKeyDown }
}
