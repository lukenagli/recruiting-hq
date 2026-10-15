import { useState } from 'react'
import { post } from './api'

/** A thank-you draft: the email to copy, the Check and Send lines, and a way to record that it went out. */
export default function DraftCard(props: {
  id: number
  body: string
  check: string
  send: string
  sent?: boolean
  warnings?: string[]
  onSent?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState(Boolean(props.sent))

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.body)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: the text is selectable in the box */
    }
  }

  async function markSent() {
    const out = await post<{ ok: boolean }>(`/api/thank-you/${props.id}/sent`, {})
    if (out.ok) {
      setSent(true)
      props.onSent?.()
    }
  }

  return (
    <div className="draft">
      <div className="draft-head">
        <strong>Thank-you draft</strong>
        <span>
          <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          {sent ? <span className="tag s-spoke">Marked sent</span> : <button className="btn" onClick={markSent}>I sent it</button>}
        </span>
      </div>
      <pre>{props.body}</pre>
      <p className="fine">{props.check}</p>
      <p className="fine">{props.send}</p>
      {props.warnings && props.warnings.length > 0 && (
        <p className="notice error">Check before sending, the draft still breaks a rule: {props.warnings.join('; ')}.</p>
      )}
    </div>
  )
}
