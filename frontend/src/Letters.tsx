import type { LetterSummary } from './api'
import CoverLetterEditor from './CoverLetterEditor'
import { Loading, Logo, fmtDate, useApi } from './ui'

/** All cover letters: one per bank still in the process, and the editor for the one picked. */
export default function Letters({ bank }: { bank: string }) {
  const { data, error } = useApi<LetterSummary[]>('/api/cover-letters')
  if (!data) return <Loading error={error} />
  const current = bank || data.find((l) => l.exists)?.bank || data[0]?.bank || ''

  return (
    <div>
      <h1>Cover Letters</h1>
      <p className="lede">
        One letter per bank in the Finance Club format: introduction with the people you have spoken to, two paragraphs of your
        experience, and a closing. Review every one before you submit it.
      </p>
      <div className="chips banks">
        {data.map((l) => (
          <a key={l.bank} href={`#/letters/${encodeURIComponent(l.bank)}`} className={`chip ${l.bank === current ? 'on' : ''}`}>
            <Logo bank={l.bank} domain={l.domain} size={18} /> {l.bank}
            <em>{l.exists ? (l.warnings ? `${l.warnings} to check` : l.edited ? 'edited' : `drafted ${fmtDate(l.updated_at.slice(0, 10))}`) : 'no letter'}</em>
          </a>
        ))}
      </div>
      {data.length === 0 && <p className="muted">No banks yet. Add banks through the assistant or the Recruiting Map.</p>}
      {current && <CoverLetterEditor key={current} bank={current} />}
    </div>
  )
}
