// Shared-password access for the hosted version. Everyone who knows REVIEWHUB_PASSWORD gets in; which reviewer they
// act as is still chosen in the app. The session is a signed cookie (no server-side state), valid for 30 days.
// Changing the password signs everyone out.
import crypto from 'node:crypto';

const COOKIE = 'rh_session';
const MAX_AGE_S = 30 * 24 * 60 * 60;
const OPEN = new Set(['/api/login', '/api/logout', '/api/session']);

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const secret = (pw) => sha(`${process.env.REVIEWHUB_SESSION_SECRET || ''}:reviewhub-session:${pw}`);
const sign = (pw, payload) => crypto.createHmac('sha256', secret(pw)).update(payload).digest('base64url');

function readCookie(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

function validSession(req, pw) {
  const raw = readCookie(req);
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = Buffer.from(sign(pw, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// required: true makes a missing REVIEWHUB_PASSWORD an error (hosted), false leaves the local app open.
export function installAuth(app, { required }) {
  const password = () => process.env.REVIEWHUB_PASSWORD || '';
  const enabled = () => required || !!password();

  app.get('/api/session', (req, res) => {
    res.json({ required: enabled(), authenticated: !enabled() || (!!password() && validSession(req, password())) });
  });

  app.post('/api/login', async (req, res) => {
    const pw = password();
    if (!pw) return res.status(500).json({ error: 'No password is configured on the server (REVIEWHUB_PASSWORD).' });
    const given = String(req.body?.password || '');
    if (!crypto.timingSafeEqual(sha(given), sha(pw))) {
      await new Promise((r) => setTimeout(r, 800)); // slows down guessing
      return res.status(401).json({ error: 'Wrong password.' });
    }
    const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(pw, exp)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    if (!enabled() || OPEN.has(req.originalUrl.split('?')[0])) return next();
    const pw = password();
    if (!pw) return res.status(500).json({ error: 'No password is configured on the server (REVIEWHUB_PASSWORD).' });
    if (!validSession(req, pw)) return res.status(401).json({ error: 'auth' });
    next();
  });
}
