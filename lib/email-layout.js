// ── HTML layout for sequence emails (React Email) ───────────────────
// Wraps a step's plain-text body in a clean, responsive HTML email, built with
// React Email (github.com/resend/react-email). The plain text from
// lib/sequences.js stays the source of truth: this only restyles it, and the
// cron sends both (Resend puts them in one multipart message).
//
// Kept deliberately light — a personal-looking note, not a newsletter — because
// heavy HTML hurts cold-outreach deliverability. No JSX, so Vercel needs no
// build step: elements are made with React.createElement.
import { createElement as h } from 'react';
import { Html, Head, Preview, Body, Container, Text, Link, Hr, render } from '@react-email/components';

// The footer separator footer() in lib/sequences.js appends to every body.
const FOOTER_SEP = '\n\n—\n';
const URL_RE = /(https?:\/\/[^\s]+)/g;

const styles = {
  body: { backgroundColor: '#f6f6f4', margin: 0, padding: '24px 0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' },
  container: { backgroundColor: '#ffffff', maxWidth: '560px', margin: '0 auto', padding: '32px 32px 24px', borderRadius: '8px' },
  text: { fontSize: '15px', lineHeight: '24px', color: '#1f1f1f', margin: '0 0 16px' },
  link: { color: '#1a56db', textDecoration: 'underline' },
  hr: { borderColor: '#e6e6e3', margin: '24px 0 16px' },
  footer: { fontSize: '12px', lineHeight: '18px', color: '#8a8a86', margin: '0 0 4px' },
};

// Turn bare URLs in a line of text into <Link>s; keep single newlines as <br>.
function inline(text, linkStyle) {
  return text.split('\n').flatMap((line, i) => {
    // split() with a capture group puts the matched URLs at the odd indices.
    const parts = line.split(URL_RE).map((part, j) =>
      j % 2 ? h(Link, { key: `${i}-${j}`, href: part, style: linkStyle }, part) : part);
    return i === 0 ? parts : [h('br', { key: `br-${i}` }), ...parts];
  });
}

function SequenceEmail({ text }) {
  const cut = text.lastIndexOf(FOOTER_SEP);
  const main = cut === -1 ? text : text.slice(0, cut);
  const footer = cut === -1 ? '' : text.slice(cut + FOOTER_SEP.length);
  const paragraphs = main.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return h(Html, { lang: 'en' },
    h(Head),
    h(Preview, null, (paragraphs[1] || paragraphs[0] || '').slice(0, 140)),
    h(Body, { style: styles.body },
      h(Container, { style: styles.container },
        ...paragraphs.map((p, i) => h(Text, { key: i, style: styles.text }, inline(p, styles.link))),
        footer && h(Hr, { style: styles.hr }),
        ...footer.split('\n').filter(Boolean).map((line, i) =>
          h(Text, { key: `f${i}`, style: styles.footer }, inline(line, { ...styles.footer, textDecoration: 'underline' }))),
      ),
    ),
  );
}

// Render a step's plain-text body (as produced by renderStep) to HTML.
export async function renderStepHtml(text) {
  return render(h(SequenceEmail, { text }));
}
