// In development the API runs separately on port 8000; the built site is served by the API server itself.
export const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8000' : '')

/** Tell the app the login has lapsed, so it can show the login screen. */
async function check(res: Response) {
  if (res.status === 401) window.dispatchEvent(new Event('auth-required'))
  if (!res.ok) {
    // Show the server's own explanation (wrong password, daily AI allowance used up, ...) when it gives one.
    const detail = await res.json().then((b) => (typeof b?.detail === 'string' ? b.detail : ''), () => '')
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
}

// preview: this account sees changes that haven't shipped to everyone yet.
export type User = { id: number; email: string; name: string; is_admin: boolean; email_verified: boolean; preview?: boolean }

export type AiSettings = { provider: string; provider_label: string; hint: string; ready: boolean; using_site_key: boolean; model: string }

export async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const query = params ? `?${new URLSearchParams(params)}` : ''
  const res = await fetch(`${API_URL}${path}${query}`, { credentials: 'include' })
  await check(res)
  return res.json()
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  })
  await check(res)
  return res.json()
}

export type AssistantStep = { tool: string; args: Record<string, unknown>; result: { did?: string; refused?: boolean; reason?: string; found?: boolean } }

export type ThankYouDraft = {
  ok: boolean
  reason?: string
  id?: number
  who?: string
  bank?: string
  body?: string
  check?: string
  send?: string
  warnings?: string[]
}

export type AssistantReply = {
  drafts?: ThankYouDraft[]
  reply: string
  steps: AssistantStep[]
  usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; requests: number } | null
  run_id: number | null
  changed: boolean
}

export type Stage = { key: string; label: string; done: boolean }

export type CalendarItem = { date: string; end: string; title: string; detail: string; source: string }

export type DealPoint = {
  id: number
  section: string
  label: string
  value: string
  source: string
  source_kind: '' | 'document' | 'official' | 'web' | 'user' | null
  doc_id: string | null
  page: string | null
  quote: string | null
}
export type DealDocument = { id: number; deal_id: number; filename: string; kind: string; size: number; uploaded_at: string; pages: number; scanned: string; source_url?: string; source_page?: string }
// Preview: an analysis piece about a deal, found by web search.
export type RecommendedDeal = {
  key: string; title: string; buyer: string; target: string; closed: string; value_usd_bn: number; consideration: string
  industry_group: string; advisors_buyer: string[]; advisors_target: string[]; why: string; sources: string[]
  covers: string[]; reasons: string[]; gaps: string[]; capiq_url: string; capiq: { found: boolean } | null
}
export type Recommendations = { deals: RecommendedDeal[]; found_at: string; banks: string[]; groups: string[]; capiq_pending: number }
export type DealReading = { id: number; title: string; outlet: string; url: string; published: string; angle: string; takeaway: string }
export type Deal = {
  id: number
  title: string
  banks: string[]
  status: string
  notes: string
  filled: number
  total: number
  sections: { name: string; timing: string; points: DealPoint[] }[]
  documents: DealDocument[]
  reading?: DealReading[] // preview only
}
export type DealsData = {
  deals: Deal[]
  intro: string
  follow_ups: string[]
  wanted: { kind: string; why: string; where: string }[]
  kinds: string[]
}

export type Application = {
  applied: string
  deadline: string
  recommended_date: string
  link: string
  cover_letter: string
  other_info: string
  prefs: string
  status: '' | 'out'
  stage: string
  notes: string
}

export type BankSummary = {
  bank: string
  domain: string
  people: number
  spoke: number
  scheduled: number
  awaiting: number
  last_touch: string
  next_up: { title: string; date: string } | null
  application: Application
  stage: Stage[]
  current_stage: string
  yale_contacts: number
  yale_spoken: number
  questions_on_file: number
}

export type Interaction = {
  id: number
  bank: string
  kind: 'coffee_chat' | 'event' | 'interview' | 'step'
  title: string
  date: string
  date_note: string
  format: string
  status: 'done' | 'upcoming' | 'no_reply' | 'todo'
  summary: string
  thank_you: string
  people: { interaction_id: number; person_id: number; notes: string }[]
  asked_me: string[]
  i_asked: string[]
  draft: { id: number; body: string; check_line: string; send_line: string; sent_at: string | null } | null
}

export type PersonStatus = 'spoke' | 'scheduled' | 'met' | 'known' | 'awaiting' | 'no_reply' | 'not_contacted' | 'not_spoken'

export type Person = {
  id: number
  name: string
  title: string
  bank: string
  grp: string
  subgroup: string
  email: string
  outreach: string
  origin: 'outreach' | 'event' | 'classmate' | 'listed'
  notes: string
  alum: 'yes' | 'no' | 'student' | ''
  linkedin_url: string
  background: string
  background_sources: string[]
  background_at: string
  status: PersonStatus
  chats: Interaction[]
  events: { id: number; title: string; date: string; date_note: string; notes: string }[]
}

export type Link = { id: number; bank: string; src: string; dst: string; label: string }

export type BankDetail = BankSummary & {
  contacts: Person[]
  interactions: Interaction[]
  links: Link[]
  question_rounds: { round: string; n: number }[]
  facts: { id: number; category: string; fact: string; source: string }[]
}

export type HomeData = {
  today: string
  thank_yous_due: { bank: string; who: string; date: string }[]
  upcoming: { bank: string; title: string; date: string; kind: string; date_note?: string }[]
  todos?: { bank: string; title: string; date: string }[]
  deadlines: { bank: string; date: string; link: string }[]
  totals: { banks: number; people: number; conversations: number; questions: number; question_bank_updated: string }
}

export type PrepOptions = {
  rounds: string[]
  counts: { bank: string; round: string; n: number }[]
  people: { name: string; title: string; bank: string; grp: string }[]
  domains: Record<string, string>
}

export type Question = {
  id: number
  source: string
  year: string
  qtype: string
  bank: string
  office: string
  grp: string
  round: string
  interviewer: string
  topic: string
  question: string
  answer_notes: string
}

export type Profile = {
  resume_text: string
  story: string
  example_letter: string
  contact_line: string
  school_line: string
  updated_at: string
  why_group?: string
  highlights?: string
  projects?: string
}

export type CoverLetter = {
  bank: string
  exists: boolean
  paragraphs: string[]
  warnings: string[]
  edited: boolean
  updated_at: string
  date: string
  recipient: string[]
  salutation: string
  signature: string
  recruiter_name: string
  recruiter_title: string
  address: string
  office: string
}

export type LetterSummary = { bank: string; domain: string; exists: boolean; warnings: number; updated_at: string; edited: boolean; recruiter: string }

/** Send a file (multipart form). */
export async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', body: form, credentials: 'include' })
  await check(res)
  return res.json()
}
export async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: 'DELETE', credentials: 'include' })
  await check(res)
  return res.json()
}

export type Verdict = 'correct' | 'partial' | 'incorrect'
export type PracticeQuestion = {
  key: string
  kind: 'bank' | 'template'
  category: string
  topic: string
  difficulty: string
  question: string
  bank: string
  round: string
  group: string
  who: string
  source: string
}
export type Graded = {
  attempt_id: number
  verdict: Verdict | null
  feedback: string
  explanation: string
  answer: string
  question: PracticeQuestion
  sources?: { source: string; location: string; private: boolean }[]
}
export type PracticeArea = {
  topic: string
  attempts: number
  graded: number
  score: number | null
  correct: number
  level: string
  by_difficulty: Record<string, number>
  last: string
}
export type PracticeProgress = { areas: PracticeArea[]; others: Record<string, number>; total: number; technical_score: number | null; days: number }
export type Attempt = {
  id: number
  at: string
  category: string
  topic: string
  difficulty: string
  bank: string
  question: string
  answer: string
  verdict: Verdict | null
  graded_by: string
}

export type School = {
  school: string
  school_full: string
  short: string
  level: string
  class_year: string
  role: string
  peer: string
  peers: string
  alum: string
  club: boolean
}
export type Session = { user: User | null; context?: School; needs_setup?: boolean }

export type SetupState = {
  profile: {
    school: string
    level: string
    class_year: string
    school_line: string
    contact_line: string
    target_groups: string
    email_template: string
    email_rules: string
    onboarded_at: string
    has_resume: boolean
    resume_chars: number
    has_cover_template: boolean
    story: string
  }
  context: School
  school_line_suggestion: string
  banks: string[]
  bank_choices: { bank: string; domain: string }[]
  ai: AiSettings
  options: { schools: string[]; levels: Record<string, string>; industry_groups: string[]; product_groups: string[] }
  email_templates: Record<string, string>
  email_kinds: { kind: string; label: string; help: string; default: string }[]
  cover_template: { has_template: boolean; filename: string }
  is_admin: boolean
  done: Record<'ai' | 'resume' | 'banks' | 'templates', boolean>
}

export async function uploadWith<T>(path: string, file: File, fields: Record<string, string>): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  const res = await fetch(`${API_URL}${path}`, { method: 'POST', body: form, credentials: 'include' })
  await check(res)
  return res.json()
}
