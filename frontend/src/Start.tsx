import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CalendarItem, DealsData, HomeData, SetupState } from './api'
import { fmtDate, useApi, useSchool } from './ui'

/**
 * Preview: "How recruiting works" for someone who has just joined the Finance Club. The season in six steps,
 * each with what to do and the one place in the app where it gets done. Steps tick off as the account fills in.
 */

function Step({ n, done, title, children, action }: { n: number; done: boolean; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <li className={`start-step ${done ? 'done' : ''}`}>
      <span className="start-num" aria-hidden>{done ? '✓' : n}</span>
      <div>
        <h3>{title}</h3>
        {children}
        {action && <div className="start-action">{action}</div>}
      </div>
    </li>
  )
}

export default function Start() {
  const school = useSchool()
  const setup = useApi<SetupState>('/api/setup')
  const home = useApi<HomeData>('/api/home')
  const deals = useApi<DealsData>('/api/deals')
  const cal = useApi<CalendarItem[]>('/api/calendar')
  const [showEmail, setShowEmail] = useState(false)
  const s = setup.data
  const people = home.data?.totals.people ?? 0
  const chats = home.data?.totals.conversations ?? 0
  const items = cal.data ?? []
  const find = (word: RegExp) => items.find((i) => word.test(i.title))
  const dows = items.filter((i) => /days on wall street/i.test(i.title))
  const superWeek = find(/^super week/i)
  const ranking = find(/booya ranking/i)
  const peer = school.peer === '2Y' ? '2Ys' : 'students'
  const short = school.short || 'your school'
  const groups = s?.options

  return (
    <div className="start">
      <header className="page-head">
        <h1>How recruiting works</h1>
        <p className="lede">
          Banking recruiting runs the same way every year. Here it is in six steps, with where to do each one.
          {people > 0 && (
            <>
              {' '}
              Already talked to people? <a href="#/catch-up">Catch up bank by bank</a>.
            </>
          )}
        </p>
      </header>

      <ol className="start-steps">
        <Step
          n={1}
          done={!!s?.done.banks}
          title="Know the job, and pick your groups"
          action={<a className="primary" href="#/settings">Pick your banks and groups</a>}
        >
          <p>
            Bankers advise companies on buying and selling businesses (M&amp;A) and on raising money. As a {school.role} you spend about ten
            weeks on one team building models and client materials, and most full-time offers come out of the summer.
          </p>
          <p>
            Every bank is split into groups, and you recruit for specific ones. <strong>Industry groups</strong> cover one sector and own
            the client relationships{groups && <>: {groups.industry_groups.slice(0, 6).join(', ')} and more</>}.{' '}
            <strong>Product groups</strong> do one kind of deal across every industry{groups && <>: {groups.product_groups.join(', ')}</>}.
            Have a first and second choice at each bank, and a reason for each.
          </p>
          <p className="start-rule">Talk about banking as the goal. Never call it a step on the way to private equity.</p>
        </Step>

        <Step
          n={2}
          done={chats > 0}
          title={`Network, starting with ${short} people`}
          action={
            <>
              <a className="primary" href="#/">Log a coffee chat</a>
              <button className="btn" onClick={() => setShowEmail(!showEmail)}>
                {showEmail ? 'Hide' : 'See'} the outreach email
              </button>
            </>
          }
        >
          <p>
            Start with {short} {peer} who summered at the bank, then {short} alums, then people you meet at events. Banks notice who
            reaches out and who follows up, so every conversation counts.
          </p>
          <ul className="start-list">
            <li>Use the club's outreach email word for word. Offer three days, one 60 to 90 minute window each, in business hours, within the next week, in ET.</li>
            <li>When they pick a time, send a calendar invite with your resume attached.</li>
            <li>Send a thank-you within a day. Recruiting HQ drafts it in the club's template when you log the chat.</li>
            <li>Ask about their group, their deals, and who else you should talk to. Note what they asked you.</li>
          </ul>
          {showEmail && s && <pre className="start-email">{s.email_templates.outreach}</pre>}
        </Step>

        <Step n={3} done={people > 0 && items.some((i) => /days on wall street/i.test(i.title) && i.date < (home.data?.today ?? ''))} title="Show up in person">
          <p>
            {dows.length > 0 ? (
              <>
                Days on Wall Street ({dows.map((d) => fmtDate(d.date)).join(', ')}) is when the club visits banks in New York. Go to every one
                you can, meet people from your target groups, and follow up within a day.
              </>
            ) : (
              <>Bank visits and info sessions are where you meet people from your target groups. Follow up with each person within a day.</>
            )}{' '}
            After that, banks invite some students to dinners. An invite usually means the bank wants to see more of you, so treat it like
            an interview.
          </p>
          <p className="muted">Tell the assistant who you met at each event and it adds them to that bank's map.</p>
        </Step>

        <Step
          n={4}
          done={!!deals.data?.deals.length}
          title="Have a deal ready to pitch"
          action={<a className="primary" href="#/deals">Set up your deal</a>}
        >
          <p>
            Almost every interviewer asks you to walk through a deal. Pick one recent, announced M&amp;A deal, ideally in your first-choice
            group. The easiest to explain is one public company buying another, paid all in cash.
          </p>
          <p>
            Pitch it in about 90 seconds: who the two companies are, the deal terms (price, premium, multiple, synergies), how the market
            reacted, and your take. Have the follow-ups ready too: comps, financing, risks, the termination fee.
          </p>
        </Step>

        <Step n={5} done={false} title="Prepare for interviews" action={<a className="primary" href="#/prep">Start practicing</a>}>
          <p>
            Behavioral: tell me about yourself, why banking, why this bank and group, and a few STAR stories. Technical: accounting,
            valuation, DCF, M&amp;A and LBO basics.
            {school.club && " Interview Prep has the questions Yale students were actually asked, by bank and round, and grades your answers."}
          </p>
        </Step>

        <Step n={6} done={false} title="Apply, interview, and rank" action={<a className="btn" href="#/letters">Write cover letters</a>}>
          <p>
            Applications are due in the fall, with cover letters for some banks. Then come first rounds
            {superWeek ? ` and Super Week (${fmtDate(superWeek.date)}${superWeek.end ? `–${fmtDate(superWeek.end)}` : ''}), when the final rounds happen` : ' and final rounds'}.
            {ranking &&
              ` If you get offers, you rank them in BOOYa, Yale's offer-matching system, by ${fmtDate(ranking.date)}: rank truthfully and include every bank you'd accept, since each student ends up with one offer.`}
          </p>
        </Step>
      </ol>

      <p className="muted start-foot">
        Want to see it all in action first? <a href="#/tour">Watch the 2-minute tour</a>.
      </p>
    </div>
  )
}
