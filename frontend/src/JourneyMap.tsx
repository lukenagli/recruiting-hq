import type { BankDetail } from './api'
import { STATUS_LABEL, fmtDate, roleOf } from './ui'

type Node = {
  id: string
  title: string
  sub: string
  status: string
  shape: 'person' | 'event'
  sort: string
  group: string
  groupRank: number
  yale: boolean
}
type Edge = { src: string; dst: string; label: string }

const W = 204
const H = 52
const COL = 262
const ROW = 62
const HEADING = 26
const ME = 'me'
const YALE_ORDER = { yes: 0, student: 0, '': 1, no: 2 }

/** People and events become nodes; anything with no recorded lead-in hangs off "You". */
function build(detail: BankDetail) {
  const nodes: Node[] = []
  const edges: Edge[] = detail.links.map((l) => ({ src: l.src, dst: l.dst, label: l.label }))

  for (const p of detail.contacts) {
    if (p.origin === 'listed') continue // known contacts Luke has not spoken with are listed below, not drawn
    const chat = p.chats[0]
    const when = chat?.date ? fmtDate(chat.date) : ''
    const role = roleOf(p.title)
    nodes.push({
      id: `person:${p.id}`,
      title: p.name,
      sub: [STATUS_LABEL[p.status], when].filter(Boolean).join(' · '),
      status: p.status,
      shape: 'person',
      // Within a role: Yale alumni first, then by date.
      sort: `${YALE_ORDER[p.alum ?? '']}${chat?.date || p.outreach || '9'}`,
      group: role.label,
      groupRank: role.rank,
      yale: p.alum === 'yes',
    })
  }
  for (const i of detail.interactions) {
    if (i.kind === 'coffee_chat') continue
    const id = `interaction:${i.id}`
    nodes.push({
      id,
      title: i.title,
      sub: [STATUS_LABEL[i.status as 'done'], i.date ? fmtDate(i.date, true) : i.date_note].filter(Boolean).join(' · '),
      status: i.status,
      shape: 'event',
      sort: i.date || '9',
      group: 'Events and next steps',
      groupRank: 99,
      yale: false,
    })
    for (const j of i.people) {
      const person = detail.contacts.find((p) => p.id === j.person_id)
      if (person?.origin === 'event') edges.push({ src: id, dst: `person:${j.person_id}`, label: 'met' })
    }
  }
  const hasLeadIn = new Set(edges.map((e) => e.dst))
  for (const n of nodes) if (!hasLeadIn.has(n.id)) edges.push({ src: ME, dst: n.id, label: '' })

  // Column = longest chain of steps back to "You".
  const depth = new Map<string, number>([[ME, 0]])
  for (let pass = 0; pass < nodes.length + 1; pass++)
    for (const e of edges) {
      const d = (depth.get(e.src) ?? 0) + 1
      if (depth.has(e.src) && d > (depth.get(e.dst) ?? 0) && d <= nodes.length + 1) depth.set(e.dst, d)
    }

  const columns: Node[][] = []
  for (const n of nodes) (columns[(depth.get(n.id) ?? 1) - 1] ??= []).push(n)

  // First column is grouped by role (2Ys, Associates, VPs, MDs) with a heading per group.
  // Later columns sit level with whatever led to them.
  const pos = new Map<string, { x: number; y: number }>()
  const headings: { y: number; label: string }[] = []
  const leadY = (id: string) => {
    const ys = edges.filter((e) => e.dst === id && pos.has(e.src)).map((e) => pos.get(e.src)!.y)
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0
  }
  let bottom = 0
  columns.forEach((col, c) => {
    if (!col) return
    if (c === 0) col.sort((a, b) => a.groupRank - b.groupRank || a.sort.localeCompare(b.sort))
    else col.sort((a, b) => leadY(a.id) - leadY(b.id) || a.groupRank - b.groupRank || a.sort.localeCompare(b.sort))
    let next = 8
    let group = ''
    col.forEach((n) => {
      if (c === 0 && n.group !== group) {
        group = n.group
        headings.push({ y: next + 16, label: group })
        next += HEADING
      }
      const y = c === 0 ? next : Math.max(next, leadY(n.id))
      pos.set(n.id, { x: 100 + c * COL, y })
      next = y + ROW
      bottom = Math.max(bottom, y + H)
    })
  })
  const first = (columns[0] ?? []).map((n) => pos.get(n.id)!.y)
  pos.set(ME, { x: 16, y: first.length ? (Math.min(...first) + Math.max(...first) + H) / 2 - 22 : 20 })
  return { nodes, edges, pos, headings, width: 100 + columns.length * COL - (COL - W) + 16, height: bottom + 16 }
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export default function JourneyMap(props: { detail: BankDetail; selected: string; onSelect: (id: string) => void }) {
  const { nodes, edges, pos, headings, width, height } = build(props.detail)
  if (nodes.length === 0) return <p className="muted">No contacts or events at this bank yet.</p>

  return (
    <div className="journey">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Journey map">
        {edges.map((e, i) => {
          const a = pos.get(e.src)
          const b = pos.get(e.dst)
          if (!a || !b) return null
          const x1 = a.x + (e.src === ME ? 44 : W)
          const y1 = a.y + (e.src === ME ? 22 : H / 2)
          const y2 = b.y + H / 2
          const mid = (x1 + b.x) / 2
          const active = props.selected === e.src || props.selected === e.dst
          return (
            <g key={i} className={`edge ${active ? 'active' : ''}`}>
              <path d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${b.x},${y2}`} />
              {e.label && (
                <text x={(x1 + b.x) / 2} y={(y1 + y2) / 2 - 5} textAnchor="middle">
                  {e.label}
                </text>
              )}
            </g>
          )
        })}

        {headings.map((h) => (
          <text key={h.label} x={100} y={h.y} className="group-heading">
            {h.label}
          </text>
        ))}

        <g transform={`translate(${pos.get(ME)!.x},${pos.get(ME)!.y})`}>
          <circle cx="22" cy="22" r="22" className="me" />
          <text x="22" y="26" textAnchor="middle" className="me-label">
            You
          </text>
        </g>

        {nodes.map((n) => {
          const p = pos.get(n.id)!
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              className={`node s-${n.status} ${n.shape} ${props.selected === n.id ? 'selected' : ''}`}
              onClick={() => props.onSelect(n.id)}
              tabIndex={0}
              onKeyDown={(ev) => ev.key === 'Enter' && props.onSelect(n.id)}
            >
              <rect width={W} height={H} rx={n.shape === 'person' ? 26 : 10} />
              <circle cx="20" cy={H / 2} r="6" className="status-dot" />
              <text x="36" y="22" className="node-title">
                {clip(n.title, n.yale ? 19 : 24)}
              </text>
              <text x="36" y="38" className="node-sub">
                {clip(n.sub, 30)}
              </text>
              {n.yale && (
                <g className="yale-badge">
                  <rect x={W - 50} y="9" width="36" height="16" rx="8" />
                  <text x={W - 32} y="21" textAnchor="middle">
                    Yale
                  </text>
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
