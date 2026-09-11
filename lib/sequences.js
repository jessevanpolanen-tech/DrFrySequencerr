// ── Sequence definitions (multi-brand) ──────────────────────────────
// A sequence is an ordered list of steps. `dayOffset` is measured from the
// moment the lead was enrolled (not from the previous send), so the cadence
// is predictable. Each step renders a plain-text email from the lead's fields.
//
// This file is SHARED by every brand's deployment. Sequence ids are namespaced
// by brand (`drfry-*`, `fahcel-*`) so both brands' copy can live here without
// colliding. A deployment sends whatever `sequenceId` its site/dashboard asks
// for; when none is given, enroll/capture fall back to `<tenant>-founding` (see
// defaultSequenceId).
//
// Add or edit sequences here — no schema change needed. The `id` is what you
// store on the enrollment (POST /api/enroll { sequenceId }).
//
// Links: leave them as plain https://... URLs. Turn ON "Click tracking" in
// Resend → the links get wrapped automatically and clicks arrive at the events
// webhook. Don't hand-roll redirect links.

// Per-brand constants used by that brand's sequences.
const BRAND = {
  drfry: {
    site: 'https://drfry.nl',
    contact: 'jesse@drfry.nl',
    footerLine: 'Dr. Fry · Molecular prevention for commercial frying · Monster, NL',
  },
  fahcel: {
    site: 'https://fahcel.eu',
    contact: 'sales@fahcel.eu',
    footerLine: 'FahCel · Tamper-evident cold-chain compliance',
 },
  kavel: {
    site: 'https://kavel-ugc.base44.app',
    contact: 'jessevpp.6704@gmail.com',          // ← set this, I didn't invent one
    footerLine: 'Kavel Studio · UGC for brands that convert',
  },

};


// Build the one-line opt-out footer. `unsubBase` is your deployed backend URL;
// `brandLine` is the sending brand's identity line.
function footer(lead, unsubBase, brandLine) {
  // Edge-safe base64url (no Node Buffer).
  const token = btoa(unescape(encodeURIComponent(lead.email)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = `${unsubBase}/api/unsubscribe?t=${token}`;
  return `\n\n—\n${brandLine}\nNot relevant? Unsubscribe: ${url}`;
}

const first = (name) => (name || '').trim().split(/\s+/)[0] || 'there';

const D = BRAND.drfry;
const F = BRAND.fahcel;
const K = BRAND.kavel

export const SEQUENCES = {
  // ── Dr. Fry founding outreach ─────────────────────────────────────
  'drfry-founding': {
    id: 'drfry-founding',
    label: 'Dr. Fry founding outreach · 4 steps',
    steps: [
      {
        id: 'intro',
        dayOffset: 0,
        subject: (l) => `${l.org ? l.org + ' — ' : ''}cutting fryer-oil cost with ProWave™`,
        body: (l, base) =>
`Hi ${first(l.name)},

I'm Jesse from Dr. Fry. We make ProWave™ — a molecular device that extends commercial frying-oil life, so kitchens buy far less oil and dump far less waste.

In field testing with convenience-store chains in Japan we've measured meaningful oil-cost reductions per site. I'd love to show you the numbers for an operation like ${l.org || 'yours'}.

Worth a short look? Here's the field study: ${D.site}/case-study/seven-eleven` + footer(l, base, D.footerLine),
      },
      {
        id: 'casestudy',
        dayOffset: 3,
        subject: (l) => `The FamilyMart results (2-min read)`,
        body: (l, base) =>
`Hi ${first(l.name)},

Following up with the concrete data — here's the FamilyMart demo & testing summary: ${D.site}/familymart-demo-and-testing.pdf

Short version: same oil, running clean for materially longer, with lower disposal volume. Happy to walk you through what it'd look like for ${l.org || 'your kitchens'}.` + footer(l, base, D.footerLine),
      },
      {
        id: 'roi',
        dayOffset: 7,
        subject: (l) => `Rough ROI for ${l.org || 'your sites'}`,
        body: (l, base) =>
`Hi ${first(l.name)},

I put together a quick way to estimate the savings for your volume — takes about a minute: ${D.site}/roi-calculator

If the payback looks right, the next step is a no-cost trial unit in one kitchen so you can verify it yourself.` + footer(l, base, D.footerLine),
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
${D.contact}` + footer(l, base, D.footerLine),
      },
    ],
  },

  // ── FahCel cold-chain founding outreach ───────────────────────────
  'fahcel-founding': {
    id: 'fahcel-founding',
    label: 'FahCel cold-chain outreach · 4 steps',
    steps: [
      {
        id: 'intro',
        dayOffset: 0,
        subject: (l) => `${l.org ? l.org + ' — ' : ''}proving your cold chain held, per shipment`,
        body: (l, base) =>
`Hi ${first(l.name)},

I'm with FahCel. We turn every temperature-logger reading into a tamper-evident record the moment it's ingested — so you can prove your cold chain held from the dock to the shelf, not reconstruct it after a dispute.

For an operation like ${l.org || 'yours'}, that means a retail audit or a lost-cold claim is settled with a verifiable chain, not a spreadsheet nobody trusts.

Worth a short look? Here's the live tracking demo: ${F.site}/demo` + footer(l, base, F.footerLine),
      },
      {
        id: 'casestudy',
        dayOffset: 3,
        subject: (l) => `How Nordkjøl proved their chain end to end`,
        body: (l, base) =>
`Hi ${first(l.name)},

Following up with a concrete example — here's the Nordkjøl case study: ${F.site}/case-study/nordkjol

Short version: frozen-seafood exports, a retail audit, and every pallet's cold chain verifiable on demand — no more he-said-she-said with the carrier. Happy to walk through what it'd look like for ${l.org || 'your routes'}.` + footer(l, base, F.footerLine),
      },
      {
        id: 'roi',
        dayOffset: 7,
        subject: (l) => `What a single lost-cold dispute costs ${l.org || 'you'}`,
        body: (l, base) =>
`Hi ${first(l.name)},

Most operators we talk to have eaten at least one rejected shipment they couldn't contest. Here's a sample of the inspection-ready record FahCel produces — the kind that ends the argument: ${F.site}/sample-inspection-report.pdf

If it looks useful, the next step is a short walkthrough on one of your real routes so you can see a chain get verified yourself.` + footer(l, base, F.footerLine),
      },
      {
        id: 'breakup',
        dayOffset: 14,
        subject: (l) => `Should I close the file?`,
        body: (l, base) =>
`Hi ${first(l.name)},

I don't want to crowd your inbox — this is my last note for now. If proving cold-chain integrity is worth a 15-minute call this quarter, just reply and I'll set it up. Otherwise I'll leave you to it.

Either way, thanks for reading.

The FahCel team
${F.contact}` + footer(l, base, F.footerLine),
      },
    ],
  },

  // ── FahCel playbook nurture ───────────────────────────────────────
  // For INBOUND leads who downloaded the Cold-Chain Excursion Playbook.
  // Warm, not cold — deliberately SEPARATE copy from the founding outreach so
  // playbook leads never get the cold pitch. Delivers the guide, then nurtures
  // toward a demo.
  'fahcel-playbook': {
    id: 'fahcel-playbook',
    label: 'FahCel playbook nurture · 3 steps',
    steps: [
      {
        id: 'deliver',
        dayOffset: 0,
        subject: (l) => `Your Cold-Chain Excursion Playbook is inside`,
        body: (l, base) =>
`Hi ${first(l.name)},

Thanks for grabbing the Cold-Chain Excursion Playbook — here it is if you'd like it again: ${F.site}/playbook

It's a 9-minute read. If you only take one thing from it, make it the first move: freeze the record the instant the alarm fires, before you touch the pallet. Almost every avoidable write-off traces back to the silent hours after a breach, not the breach itself.

I'll follow up in a few days with the move most teams skip. Reply anytime if a question comes up.` + footer(l, base, F.footerLine),
      },
      {
        id: 'onemove',
        dayOffset: 3,
        subject: (l) => `The move most cold-chain teams skip`,
        body: (l, base) =>
`Hi ${first(l.name)},

Quick follow-up on the playbook. The move teams skip isn't a fancy one — it's pulling the FULL temperature history, not just the peak, before making a call.

Duration and cumulative exposure decide product stability far more than a single spike. A 20-minute logging gap during a breach is worst-case until proven otherwise. Decide on the record, on the shift — a documented same-day disposition beats a perfect analysis that lands three days late.

Page 3 of the guide has the pre-departure checklist that prevents most of these in the first place: ${F.site}/playbook` + footer(l, base, F.footerLine),
      },
      {
        id: 'demo',
        dayOffset: 7,
        subject: (l) => `Want the six moves to run themselves, ${first(l.name)}?`,
        body: (l, base) =>
`Hi ${first(l.name)},

Last note on the playbook. Everything in it is the manual version — FahCel runs the same six moves automatically: a sealed, tamper-evident temperature record from load to handoff, so the disposition and the evidence that backs it are always in one place.

If you'd like to see it on one of ${l.org ? l.org + "'s" : 'your'} real lanes, it's a 20-minute walkthrough with your own shipment data: ${F.site}/demo

Either way, hope the guide was useful.

The FahCel team
${F.contact}` + footer(l, base, F.footerLine),
      },
    ],
  },

  // ── Kavel Studio founding outreach ────────────────────────────────

  // For INBOUND leads from the Kavel Studio site (lead form + brief form).

  // Voice per the Kavel brand docs: concrete, no fluff.

  'kavel-founding': {

    id: 'kavel-founding',

    label: 'Kavel Studio founding outreach · 4 steps',

    steps: [

      {

        id: 'intro',

        dayOffset: 0,

        subject: (l) => `Your creator shortlist is coming${l.org ? ', ' + first(l.name) : ''}`,

        body: (l, base) =>

`Hi ${first(l.name)},

Thanks for reaching out about UGC for ${l.org || 'your brand'}. Within 24 hours you'll get a shortlist of vetted creators matched to your brand and budget — free, no strings attached.

If you'd rather not wait: submit a brief at ${K.site}/brief and we start matching immediately. Takes about 3 minutes.

For the record: €79 per video, fully edited. Full usage rights, forever. 180-day money-back guarantee.

Reply with any question — I read them all.` + footer(l, base, K.footerLine),

      },

      {

        id: 'casestudy',

        dayOffset: 3,

        subject: (l) => `Nomige went from 7× to 22× ROAS`,

        body: (l, base) =>

`Hi ${first(l.name)},

A quick proof point while your shortlist is on its way: Nomige swapped their agency ads for Kavel creator content and went from 7× to 22× ROAS — same product, same audience, different videos.

Happy to show you what that would look like for ${l.org || 'your brand'}.` + footer(l, base, K.footerLine),

      },

      {

        id: 'roi',

        dayOffset: 7,

        subject: (l) => `The least risky way to test UGC${l.org ? ' for ' + l.org : ''}`,

        body: (l, base) =>

`Hi ${first(l.name)},

If you're weighing whether creator content is worth it, here's the simplest test we know:

One video. €79, fully edited, matched to your brand within 24 hours. Full usage rights, forever. If it doesn't earn its keep, you have 180 days to ask for a refund.

Most brands start with one video and scale to six a month once the numbers show up in their ad account.

Brief takes 3 minutes: ${K.site}/brief` + footer(l, base, K.footerLine),

      },

      {

        id: 'breakup',

        dayOffset: 14,

        subject: (l) => `Should I close the file?`,

        body: (l, base) =>

`Hi ${first(l.name)},

Last note from me — I don't want to crowd your inbox. If better ad creative is worth 15 minutes this quarter, just reply and I'll set up the matching right away. Otherwise I'll leave you to it.

Either way, thanks for reading.

The Kavel team

${K.contact}` + footer(l, base, K.footerLine),

      },

    ],

  },
  };
  

export function getSequence(id) {
  return SEQUENCES[id] || null;
}

// The default sequence for a tenant when none is named: `<tenant>-founding`.
// Returns the id (string) if such a sequence exists, else null.
export function defaultSequenceId(tenant) {
  const id = `${(tenant || '').trim().toLowerCase()}-founding`;
  return SEQUENCES[id] ? id : null;
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
