// ── Sequence definitions ───────────────────────────────────────────
// A sequence is an ordered list of steps. `dayOffset` is measured from the
// moment the lead was enrolled (not from the previous send), so the cadence
// is predictable. Each step renders a plain-text email from the lead's fields.
//
// Add or edit sequences here — no schema change needed. The `id` is what you
// store on the enrollment (POST /api/enroll { sequenceId }).
//
// Links: leave them as plain https://drfry.nl/... URLs. Turn ON "Click tracking"
// in Resend → the links get wrapped automatically and clicks arrive at the
// events webhook. Don't hand-roll redirect links.

const SITE = 'https://drfry.nl';
const CONTACT = 'jesse@drfry.nl';

// Build the one-line opt-out footer. `unsubBase` is your deployed backend URL.
function footer(lead, unsubBase) {
  const token = Buffer.from(lead.email).toString('base64url');
  const url = `${unsubBase}/api/unsubscribe?t=${token}`;
  return `\n\n—\nDr. Fry · Molecular prevention for commercial frying · Monster, NL\nNot relevant? Unsubscribe: ${url}`;
}

const first = (name) => (name || '').trim().split(/\s+/)[0] || 'there';

export const SEQUENCES = {
  'founding-outreach': {
    id: 'founding-outreach',
    label: 'Founding outreach · 4 steps',
    steps: [
      {
        id: 'intro',
        dayOffset: 0,
        subject: (l) => `${l.org ? l.org + ' — ' : ''}cutting fryer-oil cost with ProWave™`,
        body: (l, base) =>
`Hi ${first(l.name)},

I'm Jesse from Dr. Fry. We make ProWave™ — a molecular device that extends commercial frying-oil life, so kitchens buy far less oil and dump far less waste.

In field testing with convenience-store chains in Japan we've measured meaningful oil-cost reductions per site. I'd love to show you the numbers for an operation like ${l.org || 'yours'}.

Worth a short look? Here's the field study: ${SITE}/case-study/seven-eleven` + footer(l, base),
      },
      {
        id: 'casestudy',
        dayOffset: 3,
        subject: (l) => `The FamilyMart results (2-min read)`,
        body: (l, base) =>
`Hi ${first(l.name)},

Following up with the concrete data — here's the FamilyMart demo & testing summary: ${SITE}/familymart-demo-and-testing.pdf

Short version: same oil, running clean for materially longer, with lower disposal volume. Happy to walk you through what it'd look like for ${l.org || 'your kitchens'}.` + footer(l, base),
      },
      {
        id: 'roi',
        dayOffset: 7,
        subject: (l) => `Rough ROI for ${l.org || 'your sites'}`,
        body: (l, base) =>
`Hi ${first(l.name)},

I put together a quick way to estimate the savings for your volume — takes about a minute: ${SITE}/roi-calculator

If the payback looks right, the next step is a no-cost trial unit in one kitchen so you can verify it yourself.` + footer(l, base),
      },
      {
        id: 'breakup',
        dayOffset: 14,
        subject: (l) => `Should I close the file?`,
        body: (l, base) =>
`Hi ${first(l.name)},

I don't want to crowd your inbox — this is my last note for now. If reducing fryer-oil spend is worth a 15-minute call this quarter, just reply and I'll set it up. Otherwise I'll leave you to it.

Either way, thanks for reading.

Jesse
${CONTACT}` + footer(l, base),
      },
    ],
  },
};

export function getSequence(id) {
  return SEQUENCES[id] || null;
}

const DAY_MS = 86_400_000;

// When should a given step fire, relative to enrollment start?
export function dueAtForStep(enrolledAt, seq, stepIndex) {
  const step = seq.steps[stepIndex];
  return new Date(new Date(enrolledAt).getTime() + step.dayOffset * DAY_MS);
}

// Render a step into { subject, text } for a lead.
export function renderStep(seq, stepIndex, lead, backendBase) {
  const step = seq.steps[stepIndex];
  return { stepId: step.id, subject: step.subject(lead), text: step.body(lead, backendBase) };
}
