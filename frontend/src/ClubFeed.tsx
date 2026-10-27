import { fmtDate, useApi } from './ui'

type FeedItem = { id: number; source: string; posted_at: string; kind: string; bank: string; happens_on: string; title: string; detail: string }

const KIND = { event: 'Event', deadline: 'Deadline', process: 'Process', announcement: 'From the club' } as Record<string, string>

/** What the Finance Club's shared chats said that matters to everyone, for all banks or one. */
export default function ClubFeed({ bank = '', limit = 8 }: { bank?: string; limit?: number }) {
  const { data } = useApi<FeedItem[]>('/api/club-feed', bank ? { bank } : undefined)
  if (!data || data.length === 0) return null
  return (
    <section className="card club-feed">
      <h3>{bank ? `What the club chats say about ${bank}` : 'From the club chats'}</h3>
      <ul className="reading-list">
        {data.slice(0, limit).map((f) => (
          <li key={f.id}>
            <span className="reading-angle">
              {[KIND[f.kind] ?? f.kind, !bank && f.bank, f.happens_on && fmtDate(f.happens_on, true)].filter(Boolean).join(' · ')}
            </span>
            <strong>{f.title}</strong>
            {f.detail && <p>{f.detail}</p>}
            <small className="muted">{f.source}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}
