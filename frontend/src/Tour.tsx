import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * A walkthrough for new accounts: what Recruiting HQ does, shown on a made-up student's recruiting season.
 * Nothing here touches the user's data; every screen is a small mock of the real page it introduces.
 */

export const TOUR_SEEN = 'rhq-tour-seen'

function Typed({ text, speed = 22 }: { text: string; speed?: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    setN(0)
    const t = window.setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), speed)
    return () => window.clearInterval(t)
  }, [text, speed])
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="tour-caret" />}
    </>
  )
}

/** Shows its children once the typing before it has had time to finish. */
function After({ ms, children }: { ms: number; children: ReactNode }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), ms)
    return () => window.clearTimeout(t)
  }, [ms])
  return show ? <div className="tour-appear">{children}</div> : null
}

const UPDATE =
  'Had a coffee chat with Sarah Chen, VP in TMT at Evercore, this morning. She said the group just closed two software deals and really values people who know SaaS metrics. Told me to reach out to Marcus Patel, a 2Y who summered there. I met him briefly at the Finance Club TMT panel.'

function MockWindow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="tour-window">
      <div className="tour-window-bar">
        <i />
        <i />
        <i />
        <span>{title}</span>
      </div>
      <div className="tour-window-body">{children}</div>
    </div>
  )
}

// Filled-in examples of the Finance Club templates, word for word (backend/templates.py, EMAIL_KINDS).
const SIGNATURE = "Best,\nAlex Morgan\nMBA Candidate | Yale School of Management '27\n(203) 555-0147 | alex.morgan@yale.edu"
const EMAILS: { tab: string; window: string; body: string; actions: string[] }[] = [
  {
    tab: 'Thank-you',
    window: 'Evercore · Sarah Chen · Thank-you draft',
    body:
      'Sarah,\n\nI just want to thank you again for meeting with me this morning.\n\n' +
      'I enjoyed hearing more about what led you to Evercore and how your team just closed two software deals. ' +
      'I also liked learning about why the group values comfort with SaaS metrics.\n\n' +
      'Thank you again for your time and insight. I really enjoyed our conversation and hope we can stay in touch throughout the process.',
    actions: ['Copy', 'I sent it'],
  },
  {
    tab: 'Outreach',
    window: 'Assistant · Coffee chat outreach',
    body:
      'Subject Line: Alex Morgan / Marcus Patel - Coffee Chat\n\nHi Marcus,\n\n' +
      "Hope you're doing well! It was nice meeting you at the Finance Club TMT panel. I'd like to learn more about your path to " +
      'Investment Banking and your recruiting experience. Do you have a moment to chat sometime this week? Here is my availability for the ' +
      'next few days:\n\n• Tuesday, Oct 28: 12:00 - 2:00 PM ET\n• Wednesday, Oct 29: 3:00 - 5:00 PM ET\n• Thursday, Oct 30: 9:00 - 11:00 AM ET\n\n' +
      'Please let me know what time is convenient for you and I will send over a calendar invite. Happy to chat over Zoom/phone or in-person.\n\n' +
      SIGNATURE,
    actions: ['Copy'],
  },
  {
    tab: 'Calendar invite',
    window: 'Assistant · Calendar invite',
    body:
      'Subject Line: Alex Morgan / Marcus Patel - Coffee Chat\n\nMarcus,\n\n' +
      'Thank you again for your time. Please find attached a copy of my resume and Zoom link.\n\n' +
      'I look forward to speaking with you!\n\nZoom: yale.zoom.us/j/0000000000\n\n' +
      SIGNATURE,
    actions: ['Copy'],
  },
]

function EmailDemo() {
  const [i, setI] = useState(0)
  const e = EMAILS[i]
  return (
    <MockWindow title={e.window}>
      <div className="tour-email-tabs">
        {EMAILS.map((x, n) => (
          <button key={x.tab} className={n === i ? 'on' : ''} onClick={() => setI(n)}>
            {x.tab}
          </button>
        ))}
      </div>
      <div className="tour-email" key={i}>
        {e.body}
      </div>
      <div className="tour-actions">
        {e.actions.map((a) => (
          <span key={a} className="tour-btn">
            {a}
          </span>
        ))}
        <span className="tour-tag ok">Finance Club template</span>
      </div>
    </MockWindow>
  )
}

const STEPS: { kicker: string; title: string; text: ReactNode; demo: ReactNode }[] = [
  {
    kicker: 'Welcome',
    title: 'Your whole recruiting season in one place',
    text: (
      <>
        Recruiting HQ keeps track of every banker you meet, writes your thank-you notes and cover letters from what you actually learned, and
        drills you on the questions real interviewers ask. This tour follows a made-up student, Alex, through a week of recruiting. It takes
        about two minutes.
      </>
    ),
    demo: (
      <div className="tour-pillars">
        {[
          ['Tell it what happened', 'One box on your homepage. Type or talk; it updates everything else.'],
          ['See where you stand', 'Every bank, everyone you met, and what comes next.'],
          ['Get the writing done', 'Thank-you notes and cover letters, from your own conversations.'],
          ['Prepare for interviews', 'Practice questions, graded, with your own stories and guides.'],
        ].map(([t, d], i) => (
          <div key={t} className="tour-pillar" style={{ animationDelay: `${i * 120}ms` }}>
            <b>{i + 1}</b>
            <strong>{t}</strong>
            <span>{d}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    kicker: 'Step 1 · Homepage',
    title: 'After every chat, tell it what happened',
    text: (
      <>
        Write it the way you'd text a friend, or tap <em>Record it</em> before a coffee chat to transcribe it (with the other person's OK). The
        assistant files the person, the bank, what they said and what to do next. You never fill in a form.
      </>
    ),
    demo: (
      <MockWindow title="Home · Anything happen?">
        <div className="tour-compose">
          <Typed text={UPDATE} speed={14} />
        </div>
        <After ms={UPDATE.length * 14 + 500}>
          <div className="tour-reply">
            <strong>Updated your map:</strong>
            <ul>
              <li>Added Sarah Chen (VP, TMT) at Evercore and logged today's coffee chat with her notes</li>
              <li>Added Marcus Patel (2Y) at Evercore as someone to reach out to</li>
              <li>Saved a talking point: Evercore TMT values SaaS metrics</li>
              <li>A thank-you note to Sarah is now owed</li>
            </ul>
          </div>
        </After>
      </MockWindow>
    ),
  },
  {
    kicker: 'Step 2 · Recruiting Map',
    title: 'See exactly where you stand at every bank',
    text: (
      <>
        Each bank shows how far along you are, from coffee chats to an offer, whether you've applied, and what's next. Click a bank to see
        everyone you've met there and what each of them told you.
      </>
    ),
    demo: (
      <MockWindow title="Recruiting Map">
        {[
          ['Evercore', 0, 'Next: thank-you to Sarah Chen, then reach out to Marcus Patel', false],
          ['Goldman Sachs', 1, 'Round 1 interview Thu, Nov 6', true],
          ['Moelis', 2, 'Superday Fri, Nov 14', true],
        ].map(([bank, at, next, applied], r) => (
          <div key={bank as string} className="tour-bank" style={{ animationDelay: `${r * 150}ms` }}>
            <div className="tour-bank-head">
              <strong>{bank as string}</strong>
              <span className={applied ? 'ok' : ''}>{applied ? '✓ Applied' : '✗ Not applied'}</span>
            </div>
            <div className="tour-stages">
              {['Coffee chats', 'Interviews', 'Superday', 'Offer'].map((s, i) => (
                <span key={s} className={i < (at as number) ? 'done' : i === (at as number) ? 'current' : ''}>
                  {s}
                </span>
              ))}
            </div>
            <small>{next as string}</small>
          </div>
        ))}
      </MockWindow>
    ),
  },
  {
    kicker: 'Step 3 · Emails',
    title: 'Every email, in the Finance Club templates',
    text: (
      <>
        After each chat you get a thank-you draft in the Finance Club template, filled in with what that person actually told you. Ask the
        assistant for an outreach email or a calendar invite and it uses the club templates too. Edit anything, copy it, send it, and the map
        marks it done. Your homepage reminds you of any thank-you notes you still owe.
      </>
    ),
    demo: <EmailDemo />,
  },
  {
    kicker: 'Step 4 · Cover letters',
    title: 'A cover letter per bank, in your own template',
    text: (
      <>
        Letters are written from your resume, your pitch and the people you actually spoke with at that bank, in your own Word template. Nothing is
        made up: where something is missing, it leaves a highlighted note for you to fill. It also checks that no other bank's name slipped in.
      </>
    ),
    demo: (
      <MockWindow title="Cover Letters · Evercore">
        <div className="tour-letter">
          <p>
            My name is Alex Morgan, and I am a first-year MBA student at the Yale School of Management writing to express my interest in the
            Investment Banking Summer Associate role in Evercore's TMT group. Speaking with <mark>Sarah Chen</mark> showed me how much the team
            values fluency in software business models…
          </p>
          <p>
            <span className="tour-need">NEED: one thing you took away from talking with Marcus Patel</span>
          </p>
        </div>
        <div className="tour-actions">
          <span className="tour-btn">Download Word file</span>
          <span className="tour-tag ok">✓ Checked: only Evercore people, 1 page</span>
        </div>
      </MockWindow>
    ),
  },
  {
    kicker: 'Step 5 · Interview Prep',
    title: 'Practice the questions interviewers actually ask',
    text: (
      <>
        Pick behavioral, technical or deal questions, by bank and difficulty. Answer by typing or out loud and you get a grade, the model
        answer from your study guides, and you can ask follow-ups. In <em>Key information</em>, write your pitch and STAR stories once; practice
        grades your behavioral answers against them.
      </>
    ),
    demo: (
      <MockWindow title="Interview Prep · Practice">
        <div className="tour-q">
          <small>Technical · Accounting · Medium</small>
          <strong>Walk me through how $10 of depreciation flows through the three statements.</strong>
        </div>
        <div className="tour-answer">Net income falls by $6 at a 40% tax rate, cash flow adds back the $10, so cash is up $4…</div>
        <After ms={600}>
          <div className="tour-grade">
            <b>Partly right</b> You got all three statements and the tax shield. Say where it ends: PP&E down $10, equity down $6, balancing.
            <small>Based on: your Accounting guide, p. 14</small>
          </div>
        </After>
      </MockWindow>
    ),
  },
  {
    kicker: 'Step 6 · My Deals',
    title: 'Know your deals cold',
    text: (
      <>
        Upload the press release, merger agreement or proxy for a deal you want to talk about. A checklist shows which documents you have, and the
        numbers are pulled out into a 90-second pitch, each one marked with where it came from.
      </>
    ),
    demo: (
      <MockWindow title="My Deals · Example Co. / Target Inc.">
        <ul className="tour-docs">
          {[
            ['Press release', true],
            ['Investor presentation', true],
            ['Merger agreement', false],
            ['Proxy / S-4', false],
          ].map(([d, have]) => (
            <li key={d as string} className={have ? 'have' : ''}>
              <b>{have ? '✓' : ''}</b>
              {d as string}
              <span>{have ? 'Uploaded' : 'Upload'}</span>
            </li>
          ))}
        </ul>
      </MockWindow>
    ),
  },
]

const START: [string, string, string][] = [
  ['Add your AI key', 'Powers the assistant, grading and writing. Takes two minutes.', '#/settings'],
  ['Upload your resume and pick your banks', 'Everything else is built from these.', '#/settings'],
  ['Upload your study guides', 'Your own Breaking Into Wall Street PDFs, so practice can use their answers.', '#/settings'],
  ['Write your pitch and STAR stories', 'Interview Prep → Key information.', '#/prep?tab=stories'],
  ['Tell it about your first coffee chat', 'The "Anything happen?" box on your homepage.', '#/'],
]

export default function Tour() {
  const [step, setStep] = useState(0)
  const last = step === STEPS.length
  useEffect(() => {
    try {
      localStorage.setItem(TOUR_SEEN, '1')
    } catch {
      /* the tour still works without storage */
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((s) => Math.min(STEPS.length, s + 1))
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const s = STEPS[step]

  return (
    <div className="tour">
      <div className="tour-progress">
        {[...STEPS, null].map((_, i) => (
          <button key={i} className={i === step ? 'on' : i < step ? 'past' : ''} onClick={() => setStep(i)} aria-label={`Go to step ${i + 1}`} />
        ))}
        <a className="tour-skip" href="#/">
          Skip tour
        </a>
      </div>

      {!last ? (
        <div className="tour-stage" key={step}>
          <div className="tour-copy">
            <span className="tour-kicker">{s.kicker}</span>
            <h1>{s.title}</h1>
            <p>{s.text}</p>
            <p className="fine">Example data: Alex and everyone here are made up.</p>
          </div>
          <div className="tour-demo">{s.demo}</div>
        </div>
      ) : (
        <div className="tour-stage tour-start" key="start">
          <div className="tour-copy">
            <span className="tour-kicker">Your turn</span>
            <h1>Five things to get started</h1>
            <p>Do them in any order. Your homepage keeps this checklist until they're done, and you can replay this tour from Settings.</p>
          </div>
          <ol className="tour-start-list">
            {START.map(([t, d, href]) => (
              <li key={t}>
                <a href={href}>
                  <strong>{t}</strong>
                  <span>{d}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="tour-nav">
        <button className="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </button>
        {last ? (
          <a className="primary big" href="#/">
            Go to my homepage
          </a>
        ) : (
          <button className="primary big" onClick={() => setStep(step + 1)}>
            {step === 0 ? 'Show me' : 'Next'}
          </button>
        )}
      </div>
    </div>
  )
}
