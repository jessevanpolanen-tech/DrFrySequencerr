// ── Branded HTML email layout ───────────────────────────────────────
// Wraps a sequence step's plain-text body in a branded, email-client-safe
// HTML layout. The plain text stays the source of truth (and the multipart
// fallback for clients that block HTML); this just renders a nicer version
// of the SAME words — no copy lives here.
//
// Email HTML rules we follow deliberately:
//   • table-based layout + inline styles only (Gmail/Outlook strip <style>
//     blocks and external CSS)
//   • no external images (many clients block them by default); the wordmark
//     is styled text, and the brand accent is a solid color
//   • a max-width 600px card that degrades to full-width on phones

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Escape text and turn bare https:// URLs into branded links.
function linkify(text, accent) {
  const re = /(https?:\/\/[^\s<]+)/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out += escapeHtml(text.slice(last, m.index));
    const url = m[0];
    out += `<a href="${escapeHtml(url)}" style="color:${accent};font-weight:600;text-decoration:underline;">${escapeHtml(url)}</a>`;
    last = re.lastIndex;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

// Render blank-line-separated paragraphs; single newlines become <br>.
function paragraphs(body, accent) {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;">${linkify(p, accent).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// theme: { name, accent, footerLine } — the sending brand's identity.
// `text` is the full step body, including the "\n\n—\n<footerLine>\n
// Not relevant? Unsubscribe: <url>" footer that sequences.js appends.
export function renderEmailHtml(text, theme = {}) {
  const accent = theme.accent || '#111111';
  const name = theme.name || '';

  // Split the appended opt-out footer off the body (marker: "\n\n—\n").
  const [rawBody, rawFooter = ''] = String(text).split('\n\n—\n');
  const bodyHtml = paragraphs(rawBody, accent);

  // Footer: first line is the brand line, and somewhere there's an
  // "Unsubscribe: <url>". Render the brand line muted + a plain Unsubscribe link.
  let footerHtml = '';
  if (rawFooter) {
    const unsubMatch = rawFooter.match(/(https?:\/\/[^\s<]+)/);
    const unsubUrl = unsubMatch ? unsubMatch[0] : '';
    const brandLine = rawFooter.split('\n')[0] || '';
    footerHtml =
      `${escapeHtml(brandLine)}` +
      (unsubUrl
        ? `<br>Not relevant? <a href="${escapeHtml(unsubUrl)}" style="color:#888888;text-decoration:underline;">Unsubscribe</a>`
        : '');
  }

  const wordmark = name
    ? `<tr><td style="padding:26px 32px 6px;"><span style="font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:18px;color:${accent};letter-spacing:.2px;">${escapeHtml(name)}</span></td></tr>`
    : '';

  const footerRow = footerHtml
    ? `<tr><td style="padding:18px 32px 26px;border-top:1px solid #eeeeee;color:#888888;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;">${footerHtml}</td></tr>`
    : '';

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
        <tr><td style="background:${accent};height:5px;line-height:5px;font-size:5px;">&nbsp;</td></tr>
        ${wordmark}
        <tr>
          <td style="padding:6px 32px 22px;color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;">
            ${bodyHtml}
          </td>
        </tr>
        ${footerRow}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
