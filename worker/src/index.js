// =============================================================================
// Culture Suite Venue Board — auth gate Worker
// =============================================================================
// Sits in front of the static app (dist/venue-board.html via Assets binding).
// - POST /api/auth/login  { password }  → sets an HttpOnly signed cookie
// - POST /api/auth/logout               → clears the cookie
// - GET  /api/auth/status               → { ok: true|false }
// - any other request → serves the app from ASSETS only with a valid cookie,
//   otherwise returns a minimal login page.
//
// Secrets (Cloudflare Worker secrets, write-only):
//   PASSWORD   — the shared access password
//   JWT_SECRET — 64-hex HMAC key that signs the session cookie
// =============================================================================

const COOKIE_NAME = 'csb_session';
const COOKIE_TTL_SECONDS = 7 * 24 * 3600; // 7 days
const COOKIE_TTL_MS = COOKIE_TTL_SECONDS * 1000;

const ALG = { name: 'HMAC', hash: 'SHA-256' };

// ---- Crypto helpers ----

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), ALG, false, ['sign']
  );
  return crypto.subtle.sign(ALG, key, new TextEncoder().encode(value));
}

async function constantTimeEqual(a, b) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode('culture-suite-cteq'), ALG, false, ['sign']
  );
  const da = await crypto.subtle.sign(ALG, key, new TextEncoder().encode(a));
  const db = await crypto.subtle.sign(ALG, key, new TextEncoder().encode(b));
  if (da.byteLength !== db.byteLength) return false;
  const ua = new Uint8Array(da), ub = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

// ---- Session cookie ----

async function signCookie(nowSec, secret) {
  const payload = String(nowSec);
  const sig = await hmac(payload, secret);
  return `${payload}.${base64url(sig)}`;
}

async function verifyCookie(value, secret) {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot < 0) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = base64url(await hmac(payload, secret));
  if (!(await constantTimeEqual(sig, expected))) return false;
  const exp = parseInt(payload, 10);
  if (!Number.isFinite(exp)) return false;
  return Math.floor(Date.now() / 1000) < exp;
}

function cookieHeader(value, maxAge, extra = '') {
  return [
    `${COOKIE_NAME}=${value}`,
    `Path=/`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
    maxAge ? `Max-Age=${maxAge}` : 'Max-Age=0',
    extra,
  ].filter(Boolean).join('; ');
}

// ---- Responses ----

const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Culture Suite Venue Board — Access</title>
<style>
  :root { --bg:#0a0e12; --panel:#111820; --line:#1f3a4d; --cyan:#35e0ff; --dim:#4a6a80; --tx:#d7e3ec; --tx2:#8fa8b8; --red:#ff5d5d; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--tx); font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:380px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:32px; box-shadow:0 0 40px rgba(0,0,0,.5); }
  .brand { font-family:"Instrument Serif",Georgia,serif; font-size:26px; letter-spacing:2px; text-transform:uppercase; text-shadow:0 0 16px rgba(53,224,255,.4); }
  .sub { font-family:"IBM Plex Mono",monospace; font-size:10px; color:var(--dim); letter-spacing:4px; text-transform:uppercase; margin:6px 0 26px; }
  label { display:block; font-size:12px; color:var(--tx2); margin-bottom:8px; letter-spacing:1px; }
  input { width:100%; background:#0d141b; border:1px solid var(--line); border-radius:4px; color:var(--tx); font-family:"IBM Plex Mono",monospace; font-size:15px; padding:12px 14px; letter-spacing:2px; }
  input:focus { outline:none; border-color:var(--cyan); }
  button { width:100%; margin-top:18px; background:var(--cyan); color:#06131a; border:none; border-radius:4px; font-weight:700; font-size:13px; letter-spacing:3px; text-transform:uppercase; padding:13px; cursor:pointer; }
  button:hover { filter:brightness(1.1); }
  .err { color:var(--red); font-family:"IBM Plex Mono",monospace; font-size:12px; margin-top:14px; text-align:center; min-height:16px; }
  .hint { color:var(--dim); font-family:"IBM Plex Mono",monospace; font-size:10px; text-align:center; margin-top:18px; letter-spacing:1px; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">Culture Suite</div>
    <div class="sub">Venue Board // Access</div>
    <form id="f">
      <label for="p">Access password</label>
      <input type="password" id="p" autocomplete="current-password" autofocus>
      <button type="submit">Unlock</button>
    </form>
    <div class="err" id="err"></div>
    <div class="hint">AUTH // verified server-side</div>
  </div>
  <script>
    const f = document.getElementById('f'), p = document.getElementById('p'), e = document.getElementById('err');
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      e.textContent = '';
      try {
        const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: p.value }) });
        if (r.ok) { location.href = '/venue-board'; }
        else { e.textContent = 'Invalid password'; p.select(); }
      } catch (_) { e.textContent = 'Network error'; }
    });
  </script>
</body>
</html>`;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

// ---- Handlers ----

async function handleLogin(request, env) {
  if (!env.PASSWORD || !env.JWT_SECRET) return json({ error: 'Not configured' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { password } = body || {};
  if (!password || typeof password !== 'string') return json({ error: 'Invalid credentials' }, 401);
  const ok = await constantTimeEqual(password, env.PASSWORD);
  if (!ok) return json({ error: 'Invalid credentials' }, 401);
  const nowSec = Math.floor(Date.now() / 1000);
  const value = await signCookie(nowSec + COOKIE_TTL_SECONDS, env.JWT_SECRET);
  return json({ ok: true }, 200, {
    'Set-Cookie': cookieHeader(value, COOKIE_TTL_SECONDS),
  });
}

async function handleLogout() {
  return json({ ok: true }, 200, {
    'Set-Cookie': cookieHeader('', 0),
  });
}

async function handleStatus(request, env) {
  const cookie = parseCookie(request);
  const valid = await verifyCookie(cookie, env.JWT_SECRET);
  return json({ ok: valid });
}

function parseCookie(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return v.join('=');
  }
  return '';
}

// ---- Router ----

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (path === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env);
    if (path === '/api/auth/logout' && request.method === 'POST') return handleLogout();
    if (path === '/api/auth/status' && request.method === 'GET') return handleStatus(request, env);

    // Everything else: the static app — only behind a valid cookie.
    const cookie = parseCookie(request);
    const valid = await verifyCookie(cookie, env.JWT_SECRET);
    if (!valid) {
      if (path === '/') return new Response(LOGIN_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      // API-ish paths without auth → 401; anything else → login page
      if (path.startsWith('/api/')) return json({ error: 'Unauthorized' }, 401);
      return new Response(LOGIN_PAGE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return env.ASSETS.fetch(request);
  },
};
