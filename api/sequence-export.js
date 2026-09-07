// ── Plug-and-play sequence export ───────────────────────────────────
// GET /api/sequence-export            → all sequences, JSON
// GET /api/sequence-export?format=md  → Markdown you can paste anywhere
// GET /api/sequence-export?format=txt → plain text
// GET /api/sequence-export?sequenceId=founding-outreach → just one
//
// "Plug and play" = the full sequence rendered with tool-agnostic merge
// tags ({{first_name}}, {{company}}) instead of a live lead, so you can drop
// every email straight into Instantly, Smartlead, Lemlist, Mailchimp — or
// hand it to a colleague — without touching this backend. The copy is read
// from lib/sequences.js, so this export can never drift from what actually
// sends.
//
// Node.js classic (req, res) handler.
import { SEQUENCES, getSequence } from '../lib/sequences.js';

export const config = { runtime: 'nodejs' };

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

// A stand-in "lead" whose fields are merge tags rather than real values, so
// the rendered subject/body come out plug-and-play. `first(l.name)` in
// sequences.js splits on whitespace and takes the first word, so a single
// token with no spaces survives intact.
const PLACEHOLDER_LEAD = {
  name: '{{first_name}}',
  org: '{{company}}',
  role: '{{role}}',
  email: '{{email}}',
};

// The footer builds a per-recipient unsubscribe link from the lead's email.
// For an export there is no real recipient, so we show an obvious placeholder
// instead of a base64 token of the literal "{{email}}" string.
const UNSUB_PLACEHOLDER = '{{unsubscribe_url}}';

function daysLabel(dayOffset) {
  if (dayOffset === 0) return 'On enrollment (day 0)';
  return `Day ${dayOffset} — ${dayOffset} day${dayOffset === 1 ? '' : 's'} after enrollment`;
}

// Render one sequence into a plain data object (no functions).
function exportSequence(seq) {
  const base = process.env.BACKEND_BASE_URL || 'https://dr-fry-sequencerr.vercel.app';
  return {
    id: seq.id,
    label: seq.label,
    stepCount: seq.steps.length,
    steps: seq.steps.map((step, i) => {
      const subject = step.subject(PLACEHOLDER_LEAD);
      // Render the body, then swap the generated unsubscribe URL (built from
      // the placeholder email) for a clean, human-readable token.
      const rawBody = step.body(PLACEHOLDER_LEAD, base);
      const body = rawBody.replace(
        new RegExp(`${escapeRegExp(base)}/api/unsubscribe\\?t=\\S+`),
        UNSUB_PLACEHOLDER
      );
      return {
        index: i,
        stepId: step.id,
        dayOffset: step.dayOffset,
        schedule: daysLabel(step.dayOffset),
        subject,
        body,
      };
    }),
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build the Markdown document for one or more exported sequences.
function toMarkdown(sequences) {
  const out = [];
  out.push('# Dr. Fry — email sequences (plug & play)');
  out.push('');
  out.push('Copy any email below into your outreach tool. Replace the merge tags with');
  out.push('that tool\'s own fields:');
  out.push('');
  out.push('- `{{first_name}}` — the recipient\'s first name');
  out.push('- `{{company}}` — the recipient\'s company / organisation');
  out.push('- `{{role}}` — the recipient\'s role (optional)');
  out.push('- `{{unsubscribe_url}}` — a working one-click opt-out link (required for cold outreach)');
  out.push('');
  out.push('`dayOffset` is measured from the moment the lead is enrolled, not from the');
  out.push('previous send, so the cadence stays predictable.');
  out.push('');

  for (const seq of sequences) {
    out.push(`## ${seq.label}`);
    out.push('');
    out.push(`Sequence id: \`${seq.id}\` · ${seq.stepCount} steps`);
    out.push('');
    for (const step of seq.steps) {
      out.push(`### Step ${step.index + 1} — ${step.stepId}`);
      out.push('');
      out.push(`- **When:** ${step.schedule}`);
      out.push(`- **Subject:** ${step.subject}`);
      out.push('');
      out.push('```text');
      out.push(step.body);
      out.push('```');
      out.push('');
    }
  }
  return out.join('\n');
}

// Build a plain-text document (no Markdown fences).
function toPlainText(sequences) {
  const out = [];
  const rule = '='.repeat(72);
  for (const seq of sequences) {
    out.push(rule);
    out.push(`${seq.label}  (id: ${seq.id}, ${seq.stepCount} steps)`);
    out.push(rule);
    out.push('');
    for (const step of seq.steps) {
      out.push(`--- Step ${step.index + 1}: ${step.stepId} ---`);
      out.push(step.schedule);
      out.push(`Subject: ${step.subject}`);
      out.push('');
      out.push(step.body);
      out.push('');
      out.push('');
    }
  }
  out.push('Merge tags: {{first_name}}, {{company}}, {{role}}, {{unsubscribe_url}}');
  return out.join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'method' }); return; }

  try {
    // One sequence if asked for, otherwise every defined sequence.
    const wanted = (req.query?.sequenceId || '').toString().trim();
    let sequences;
    if (wanted) {
      const seq = getSequence(wanted);
      if (!seq) { res.status(404).json({ error: 'unknown-sequence' }); return; }
      sequences = [exportSequence(seq)];
    } else {
      sequences = Object.values(SEQUENCES).map(exportSequence);
    }

    const format = (req.query?.format || 'json').toString().trim().toLowerCase();

    if (format === 'md' || format === 'markdown') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.status(200).send(toMarkdown(sequences));
      return;
    }
    if (format === 'txt' || format === 'text' || format === 'plain') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(toPlainText(sequences));
      return;
    }

    res.status(200).json({ ok: true, count: sequences.length, sequences });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
}
