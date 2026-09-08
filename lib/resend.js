// Resend send helper. One place that talks to the Resend REST API.
// Requires env: RESEND_API_KEY, FROM_EMAIL, FROM_NAME, REPLY_TO.
const RESEND_API = 'https://api.resend.com/emails';

export function fromLine() {
  // No brand default — each deployment sets its own verified sender. A silent
  // brand fallback here would let a misconfigured deployment send as the wrong brand.
  const email = process.env.FROM_EMAIL;
  if (!email) throw new Error('FROM_EMAIL is not set');
  const name = process.env.FROM_NAME || '';
  return name ? `${name} <${email}>` : email;
}

// Send one email through Resend. Returns { id } on success, throws on failure.
export async function sendEmail({ to, subject, text, html, tags = [], replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');

  const body = {
    from: fromLine(),
    to: [to],
    subject,
    text,
    reply_to: replyTo || process.env.REPLY_TO || undefined,
    tags,
  };
  if (html) body.html = html;

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const txt = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Resend ${res.status}: ${txt.slice(0, 300)}`);
  try { return JSON.parse(txt); } catch { return {}; }
}

// Notify the operator that a new lead just landed in the pipeline.
export async function notifyNewLead(lead = {}, source = 'dashboard') {
  const to = process.env.NOTIFY_TO || process.env.FORWARD_TO;
  if (!to) throw new Error('NOTIFY_TO or FORWARD_TO must be set to notify on new leads');
  const name = lead.name || '(no name given)';
  const org = lead.org && lead.org !== '—' ? lead.org : '';
  const subject = `New lead: ${name}${org ? ' · ' + org : ''}`;
  const lines = [
    `A new lead just entered the pipeline via ${source}.`,
    '',
    `Name:    ${name}`,
    `Email:   ${lead.email || '—'}`,
    org ? `Company: ${org}` : null,
    lead.role ? `Type:    ${lead.role}` : null,
    lead.phone ? `Phone:   ${lead.phone}` : null,
    lead.note ? `Note:    ${lead.note}` : null,
    '',
    `Reply to this email to write straight back to ${lead.email || 'them'}.`,
    'Open the dashboard to compose, set their stage, or start a sequence.',
  ].filter((l) => l !== null);
  return sendEmail({
    to,
    subject,
    text: lines.join('\n'),
    replyTo: lead.email || undefined,
    tags: [{ name: 'kind', value: 'lead-notify' }],
  });
}
