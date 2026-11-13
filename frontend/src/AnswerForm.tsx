import type { PracticeQuestion } from './api'

/**
 * Labeled answer boxes for the technical questions that always come in the same shape, so the student types only
 * the changes, never the headings:
 * - three statement walk-throughs: Income statement; Cash flow (CFO, CFI, CFF); Balance sheet (Assets, Liabilities,
 *   Shareholders' equity), one row per statement;
 * - enterprise and equity value calculations: EV and EqV;
 * - LBO returns: MOM and IRR.
 * The boxes are put together into one labeled answer for checking, with the free-text box below for anything else.
 */

type Field = { key: string; label: string; placeholder?: string; prefix?: string; suffix?: string }
type Row = { label: string; fields: Field[] }
export type Form = { kind: 'statements' | 'value' | 'returns'; rows: Row[] }

// a concrete event with numbers, not "how do the three statements link?"
const EVENT = /\d|\b(goes? up|goes? down|increases?|decreases?|falls?|rises?|buys?|sells?|writes? (down|off)|records?|pays?|raises?|issues?|repays?|acquires?|purchases?)\b/i
const STATEMENTS = /three (financial )?statements|3 statements|(walk|run|take) (me |us )?through the (three |3 |financial )?statements|on the (three |3 |financial )?statements|(impact|effect) on (the )?(three|3|financial) statements|flows? through the (three |3 |financial )?statements/i
const RETURNS = /multiple of money|\bMOM\b|\bMOIC\b|cash[- ]on[- ]cash|\bIRR\b/i
const EV = /enterprise value|\bT?EV\b/i
const EQV = /equity value|\bEQV\b|\bEqV\b/i
const ASKS = /\b(what (is|are|would|'s)|calculate|find|compute|how much|implied|new|resulting)\b/i
// "How do Equity Value and Enterprise Value change?", "What happens to EV?": a direction and amount, not a figure
const CHANGES = /\bhow (do|does|would|will|did)\b[^?]*\b(change|move|affected|impacted)\b|\bwhat happens to\b|\b(impact|effect) on\b|\bdirectionally\b|\b(go|goes) up or down\b/i
const EV_EBITDA = /\bEV\s*\/\s*EBITDA\b/i
const PE = /\bP\s*\/\s*E\b/i

export function formFor(q: PracticeQuestion): Form | null {
  if (q.category !== 'Technical') return null
  const text = q.question
  if (STATEMENTS.test(text) && EVENT.test(text))
    return {
      kind: 'statements',
      rows: [
        { label: 'Income statement', fields: [{ key: 'is', label: 'Changes', placeholder: 'e.g. depreciation +$20M, taxes −$5M, net income −$15M' }] },
        {
          label: 'Cash flow statement',
          fields: [
            { key: 'cfo', label: 'CFO', placeholder: 'e.g. +$5M' },
            { key: 'cfi', label: 'CFI', placeholder: 'e.g. −$100M' },
            { key: 'cff', label: 'CFF', placeholder: 'e.g. +$100M' },
          ],
        },
        {
          label: 'Balance sheet',
          fields: [
            { key: 'assets', label: 'Assets', placeholder: 'e.g. cash +$5M, PP&E −$20M' },
            { key: 'liabilities', label: 'Liabilities', placeholder: 'e.g. no change' },
            { key: 'equity', label: "Shareholders' equity", placeholder: 'e.g. −$15M' },
          ],
        },
      ],
    }
  if (RETURNS.test(text) && /\d/.test(text))
    return { kind: 'returns', rows: [{ label: 'Returns', fields: [{ key: 'mom', label: 'MOM', suffix: 'x' }, { key: 'irr', label: 'IRR', suffix: '%' }] }] }
  if ((EV.test(text) || EQV.test(text)) && CHANGES.test(text)) {
    const both = (EV.test(text) && EQV.test(text)) || q.topic === 'Enterprise & Equity Value'
    const hint = 'e.g. +$50, −$100 or no change'
    const fields: Field[] = []
    if (both || EV.test(text)) fields.push({ key: 'ev', label: 'Enterprise value (EV)', placeholder: hint })
    if (both || EQV.test(text)) fields.push({ key: 'eqv', label: 'Equity value (EqV)', placeholder: hint })
    if (EV_EBITDA.test(text)) fields.push({ key: 'ev_ebitda', label: 'EV / EBITDA', placeholder: 'e.g. goes up' })
    if (PE.test(text)) fields.push({ key: 'pe', label: 'P / E', placeholder: 'e.g. goes down' })
    return { kind: 'value', rows: [{ label: 'Changes', fields }] }
  }
  if ((EV.test(text) || EQV.test(text)) && /\d/.test(text) && ASKS.test(text)) {
    const both = (EV.test(text) && EQV.test(text)) || q.topic === 'Enterprise & Equity Value'
    const fields: Field[] = []
    if (both || EV.test(text)) fields.push({ key: 'ev', label: 'Enterprise value (EV)', prefix: '$' })
    if (both || EQV.test(text)) fields.push({ key: 'eqv', label: 'Equity value (EqV)', prefix: '$' })
    return { kind: 'value', rows: [{ label: 'Values', fields }] }
  }
  return null
}

/** The boxes as one answer: "Cash flow statement: CFO +$5M; CFI −$100M; CFF +$100M", then any notes. */
export function compose(form: Form, parts: Record<string, string>, notes: string) {
  const lines = form.rows
    .map((row) => {
      const filled = row.fields
        .map((f) => [f, (parts[f.key] ?? '').trim()] as const)
        .filter(([, v]) => v)
        .map(([f, v]) => `${form.kind === 'statements' ? (row.fields.length === 1 ? '' : `${f.label} `) : `${f.label}: `}${f.prefix && !v.startsWith(f.prefix) ? f.prefix : ''}${v}${f.suffix && !v.endsWith(f.suffix) ? f.suffix : ''}`)
      if (!filled.length) return ''
      return form.kind === 'statements' ? `${row.label}: ${filled.join('; ')}` : filled.join('\n')
    })
    .filter(Boolean)
  return [...lines, notes.trim()].filter(Boolean).join('\n')
}

export const anyFilled = (parts: Record<string, string>) => Object.values(parts).some((v) => v.trim())

export default function AnswerForm({ form, parts, setParts, onSubmit }: {
  form: Form; parts: Record<string, string>; setParts: (p: Record<string, string>) => void; onSubmit: () => void
}) {
  return (
    <div className={`af af-${form.kind}`}>
      {form.rows.map((row) => (
        <div key={row.label} className="af-row">
          {form.kind === 'statements' && <span className="af-row-label">{row.label}</span>}
          <div className={`af-parts n${row.fields.length}`}>
            {row.fields.map((f) => (
              <label key={f.key} className="af-field">
                {!(form.kind === 'statements' && row.fields.length === 1) && <small>{f.label}</small>}
                <span className="af-input">
                  {f.prefix && <i>{f.prefix}</i>}
                  <input
                    value={parts[f.key] ?? ''}
                    placeholder={f.placeholder}
                    aria-label={`${row.label}: ${f.label}`}
                    onChange={(e) => setParts({ ...parts, [f.key]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit()
                    }}
                  />
                  {f.suffix && <i>{f.suffix}</i>}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Technical questions that need a tax rate but don't give one are answered at 25%. */
export function taxNote(q: PracticeQuestion) {
  return q.category === 'Technical' && ['Accounting', 'DCF', 'Merger Math', 'LBO'].includes(q.topic) && /\d/.test(q.question) && !/tax/i.test(q.question)
    ? 'Assume a 25% tax rate.'
    : ''
}
