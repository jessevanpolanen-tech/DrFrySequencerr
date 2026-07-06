// Resend send helper. One place that talks to the Resend REST API.
// Requires env: RESEND_API_KEY, FROM_EMAIL, FROM_NAME, REPLY_TO.
const RESEND_API = 'https://api.resend.com/emails';

export function fromLine() {
  const email = process.env.FROM_EMAIL || 'jesse@contact.drfry.nl';
  const name = process.env.FROM_NAME || 'Dr. Fry';
  return name ? `${name} <${email}>` : email;
}

// Send one email through Resend. Returns { id } on success, throws on failure.
// `tags` let you correlate events back to an enrollment/step in the webhook.
export async function sendEmail({ to, subject, text, html, tags = [], replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not set');

  const body = {
    from: fromLine(),
    to: [to],
    subject,
    text,
    reply_to: replyTo || process.env.REPLY_TO || 'jesse@drfry.nl',
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
