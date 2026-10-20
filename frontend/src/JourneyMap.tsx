import type { BankDetail, Interaction, Person } from './api'
import { STATUS_LABEL, fmtDate, useSchool } from './ui'

/**
 * How the process at one bank unfolded, step by step in date order. Each column is one date; arrows run from
 * one step to the next. An open event everyone could attend (a corporate presentation, an open Day on Wall Street)
 * gets a dashed connector instead of an arrow, because earlier chats did not lead to it. Referrals show on both
 * cards. Chats with current students and classmates at your school, the unofficial side of the process, sit in their own lane below.
 */

type Card = {
  id: string // what clicking selects: person:<id> or interaction:<id>
  kind: 'chat' | 'event' | 'interview' | 'step' | 'waiting'
  title: string
  sub: string
  status: string
  date: string
  people: { id: number; name: string }[] // attendees shown inside an event card
  personIds: number[] // everyone this card stands for (to attach referrals)
  open: boolean // an open event: no arrow into it
}

const KIND_LABEL = { chat: 'Coffee chat', event: 'Event', interview: 'Interview', step: 'Next step', waiting: 'Reached out' }

function firstDate(text: string) {
  return text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
}

function isYale(p: Person) {
  return p.alum === 'student' || p.origin === 'classmate'
}

function build(detail: BankDetail) {
  const byId = new Map(detail.contacts.map((p) => [p.id, p]))
  const bankSide = detail.contacts.filter((p) => !isYale(p) && p.origin !== 'listed')
  const cards: Card[] = []
  const placed = new Set<number>()

  for (const i of detail.interactions) {
    const members = i.people.map((j) => byId.get(j.person_id)).filter((p): p is Person => !!p)
    if (i.kind === 'coffee_chat') {
      const bankers = members.filter((p) => !isYale(p))
      if (bankers.length === 0) continue // chats with 2Ys go in the Yale lane
      bankers.forEach((p) => placed.add(p.id))
      const one = bankers.length === 1 ? bankers[0] : null
      cards.push({
        id: one ? `person:${one.id}` : `interaction:${i.id}`,
        kind: 'chat',
        title: bankers.map((p) => p.name).join(' & '),
        sub: one ? [one.title, one.grp].filter(Boolean).join(', ') : i.title,
        status: i.status,
        date: i.date,
        people: [],
        personIds: bankers.map((p) => p.id),
        open: false,
      })
    } else {
      const attendees = members.filter((p) => p.origin !== 'listed')
      attendees.forEach((p) => placed.add(p.id))
      cards.push({
        id: `interaction:${i.id}`,
        kind: i.kind === 'event' ? 'event' : i.kind === 'interview' ? 'interview' : 'step',
        title: i.title,
        sub: i.date_note || i.format || '',
        status: i.status,
        date: i.date,
        people: attendees.map((p) => ({ id: p.id, name: p.name })),
        personIds: attendees.map((p) => p.id),
        open: i.kind === 'event' && (i as Interaction & { invite_only?: string }).invite_only !== 'yes',
      })
    }
  }
  // People reached out to who have not met yet (awaiting a reply, or a referral not acted on).
  for (const p of bankSide) {
    if (placed.has(p.id)) continue
    cards.push({
      id: `person:${p.id}`,
      kind: 'waiting',
      title: p.name,
      sub: [p.title, p.grp].filter(Boolean).join(', '),
      status: p.status,
      date: firstDate(p.outreach),
      people: [],
      personIds: [p.id],
      open: false,
    })
  }

  // Columns by date; anything without a date goes last.
  const dates = Array.from(new Set(cards.map((c) => c.date || '~'))).sort()
  const columns = dates.map((d) => ({ date: d === '~' ? '' : d, cards: cards.filter((c) => (c.date || '~') === d) }))

  // Referrals and suggestions, written onto both ends.
  const cardFor = (ref: string) => {
    const [kind, raw] = ref.split(':')
    const id = Number(raw)
    return kind === 'person' ? cards.find((c) => c.personIds.includes(id)) : cards.find((c) => c.id === ref)
  }
  const nameOf = (ref: string) => {
    const [kind, raw] = ref.split(':')
    return kind === 'person' ? byId.get(Number(raw))?.name ?? '' : detail.interactions.find((i) => i.id === Number(raw))?.title ?? ''
  }
  const notes = new Map<Card, string[]>()
  for (const l of detail.links) {
    const from = cardFor(l.src)
    const to = cardFor(l.dst)
    if (from && to) {
      notes.set(to, [...(notes.get(to) ?? []), `${l.label || 'led here'}: ${nameOf(l.src)}`])
      notes.set(from, [...(notes.get(from) ?? []), `→ ${l.label || 'led to'} ${nameOf(l.dst)}`])
    }
  }

  const yale = detail.contacts
    .filter((p) => isYale(p) && p.origin !== 'listed')
    .map((p) => ({ p, date: p.chats[0]?.date || firstDate(p.outreach) }))
    .sort((a, b) => (a.date || '~').localeCompare(b.date || '~'))
  return { columns, notes, yale }
}

export default function JourneyMap(props: { detail: BankDetail; selected: string; onSelect: (id: string) => void }) {
  const school = useSchool()
  const { columns, notes, yale } = build(props.detail)

  return (
    <div className="process">
      {columns.length === 0 ? (
        <p className="muted">No conversations or events with {props.detail.bank} yet.</p>
      ) : (
        <div className="flow">
          {columns.map((col, c) => {
            const next = columns[c + 1]
            const dashed = next && next.cards.every((card) => card.open)
            return (
              <div className="flow-step" key={col.date || 'undated'}>
                <div className="flow-col">
                  <div className="flow-date">{col.date ? fmtDate(col.date, true) : 'Date not set'}</div>
                  {col.cards.map((card) => (
                    <div
                      key={card.id + card.title}
                      role="button"
                      tabIndex={0}
                      className={`flow-card k-${card.kind} s-${card.status} ${props.selected === card.id ? 'selected' : ''} ${card.open ? 'open-event' : ''}`}
                      onClick={() => props.onSelect(card.id)}
                      onKeyDown={(e) => e.key === 'Enter' && props.onSelect(card.id)}
                    >
                      <span className="flow-kind">
                        {KIND_LABEL[card.kind]}
                        {card.open ? ' · open to all' : ''}
                        <em>{STATUS_LABEL[card.status as keyof typeof STATUS_LABEL] ?? ''}</em>
                      </span>
                      <strong>{card.title}</strong>
                      {card.sub && <small>{card.sub}</small>}
                      {card.people.length > 0 && (
                        <span className="flow-people">
                          {card.people.map((p) => (
                            <button
                              key={p.id}
                              className={`chip mini ${props.selected === `person:${p.id}` ? 'on' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                props.onSelect(`person:${p.id}`)
                              }}
                            >
                              {p.name}
                            </button>
                          ))}
                        </span>
                      )}
                      {(notes.get(card) ?? []).map((n) => (
                        <span className="flow-note" key={n}>{n}</span>
                      ))}
                    </div>
                  ))}
                </div>
                {next && <div className={`flow-arrow ${dashed ? 'dashed' : ''}`} aria-hidden />}
              </div>
            )
          })}
        </div>
      )}

      {yale.length > 0 && (
        <div className="yale-lane">
          <span className="yale-label">{school.peers}</span>
          <div className="chips">
            {yale.map(({ p, date }) => (
              <button key={p.id} className={`chip ${props.selected === `person:${p.id}` ? 'on' : ''}`} onClick={() => props.onSelect(`person:${p.id}`)}>
                {p.name}
                <em>{[date && fmtDate(date), STATUS_LABEL[p.status]].filter(Boolean).join(' · ')}</em>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
