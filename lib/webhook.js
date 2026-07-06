// Verify a Resend (Svix) webhook signature on the edge runtime.
// Resend signs webhooks with Svix. Set RESEND_WEBHOOK_SECRET to the value
// shown when you create the webhook (looks like "whsec_..."). If it's unset,
// verification is skipped (fine for local testing, NOT for production).

function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function bytesToB64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

// Returns true if the raw request body is authentic. `rawBody` must be the
// exact string received (read with await req.text() BEFORE JSON.parse).
export async function verifyResendSignature(req, rawBody) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return true; // dev fallback

  const id = req.headers.get('svix-id');
  const ts = req.headers.get('svix-timestamp');
  const sigHeader = req.headers.get('svix-signature');
  if (!id || !ts || !sigHeader) return false;

  const secretBytes = b64ToBytes(secret.split('_')[1] || secret);
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new TextEncoder().encode(`${id}.${ts}.${rawBody}`);
  const mac = await crypto.subtle.sign('HMAC', key, signed);
  const expected = bytesToB64(mac);

  // Header is a space-separated list of "v1,<sig>" pairs.
  return sigHeader.split(' ').some((part) => part.split(',')[1] === expected);
}
