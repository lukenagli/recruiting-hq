/** Chat notes as written (plain text: "Their path:" headings, "• " bullets two spaces deeper per level), drawn as
 *  a tidy document: each heading in small capitals with a rule running out to the edge, bullets as real lists. */

const HEADING = /^\s*([A-Z][^•◦▪\n]{0,48}?):\s*$/
const BULLET = /^( *)([•◦▪\-*]) (.*)$/

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; level: number; text: string }
  | { kind: 'para'; text: string }

function parse(text: string): Block[] {
  const blocks: Block[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (!line.trim()) continue
    const h = line.match(HEADING)
    if (h) {
      blocks.push({ kind: 'heading', text: h[1].trim() })
      continue
    }
    const b = line.match(BULLET)
    if (b) {
      blocks.push({ kind: 'bullet', level: Math.min(4, Math.floor(b[1].length / 2)), text: b[3].trim() })
      continue
    }
    blocks.push({ kind: 'para', text: line.trim() })
  }
  return blocks
}

export default function NotesText({ text }: { text: string }) {
  const blocks = parse(text)
  return (
    <div className="nt">
      {blocks.map((b, i) =>
        b.kind === 'heading' ? (
          <h5 key={i} className="nt-head"><span>{b.text}</span></h5>
        ) : b.kind === 'bullet' ? (
          <p key={i} className={`nt-li nt-l${b.level}`}>{b.text}</p>
        ) : (
          <p key={i} className="nt-p">{b.text}</p>
        ),
      )}
    </div>
  )
}
