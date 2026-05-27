// ---------------------------------------------------------------
// Tester — local Express server
// • Serves the static landing page + dashboard
// • /api/dashboard/* endpoints (password-gated, talk to Supabase
//   via a service-role PostgREST client)
// ---------------------------------------------------------------

require('dotenv').config();

const crypto  = require('crypto');
const express = require('express');
const cors    = require('cors');
const { rest } = require('./lib/supabase-rest');

const app  = express();
const PORT = process.env.PORT || 3000;

// ---- Env ----
const DASHBOARD_PASSWORD    = process.env.DASHBOARD_PASSWORD;
const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DASHBOARD_PASSWORD)    console.warn('[warn] DASHBOARD_PASSWORD is not set — dashboard login will reject everything.');
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE)
  console.warn('[warn] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — dashboard APIs will fail.');

// Stable session token derived from the password + per-boot salt.
const SESSION_SALT  = crypto.randomBytes(16).toString('hex');
const SESSION_TOKEN = crypto.createHmac('sha256', SESSION_SALT)
  .update(String(DASHBOARD_PASSWORD ?? ''))
  .digest('hex');

const db = (SUPABASE_URL && SUPABASE_SERVICE_ROLE) ? rest(SUPABASE_URL, SUPABASE_SERVICE_ROLE) : null;

// ---- Middleware ----
app.use(cors());
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser);
app.use(express.static(__dirname));

// Inline cookie parser (avoids an extra dependency)
function cookieParser(req, _res, next) {
  const header = req.headers.cookie || '';
  req.cookies = Object.fromEntries(
    header.split(';').map(s => s.trim()).filter(Boolean).map(p => {
      const i = p.indexOf('=');
      return i < 0 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
    })
  );
  next();
}

function requireDashAuth(req, res, next) {
  if (req.cookies.dashboard_token === SESSION_TOKEN) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

function needDb(res) {
  if (db) return true;
  res.status(500).json({ error: 'Supabase not configured on the server.' });
  return false;
}

// ---- Dashboard router ----
const dash = express.Router();

dash.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!DASHBOARD_PASSWORD) return res.status(500).json({ error: 'Dashboard password not configured.' });
  const a = Buffer.from(String(password ?? ''));
  const b = Buffer.from(String(DASHBOARD_PASSWORD));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: 'Wrong password.' });

  res.cookie('dashboard_token', SESSION_TOKEN, {
    httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12,
  });
  res.json({ ok: true });
});

dash.post('/logout', (_req, res) => {
  res.clearCookie('dashboard_token');
  res.json({ ok: true });
});

dash.get('/me', requireDashAuth, (_req, res) => res.json({ ok: true }));

// All routes below require auth
dash.use(requireDashAuth);

// ---- /overview ----
dash.get('/overview', async (_req, res) => {
  if (!needDb(res)) return;
  try {
    const [total, pending, subActive, subUnsub, emailsSent, emailsFailed, nlTotal, nlDrafts, recent] = await Promise.all([
      db.query('contact_submissions?select=id',                                    { count: 'exact', head: true }),
      db.query('contact_submissions?select=id&reply_status=eq.pending',            { count: 'exact', head: true }),
      db.query('contact_submissions?select=id&newsletter_subscribed=eq.true&unsubscribed_at=is.null', { count: 'exact', head: true }),
      db.query('contact_submissions?select=id&unsubscribed_at=not.is.null',        { count: 'exact', head: true }),
      db.query('email_interactions?select=id&status=eq.sent',                      { count: 'exact', head: true }),
      db.query('email_interactions?select=id&status=eq.failed',                    { count: 'exact', head: true }),
      db.query('newsletters?select=id',                                            { count: 'exact', head: true }).catch(() => ({ count: 0 })),
      db.query('newsletters?select=id&status=eq.draft',                            { count: 'exact', head: true }).catch(() => ({ count: 0 })),
      db.query('contact_submissions?select=id,created_at,name,email,reply_status&order=created_at.desc&limit=10'),
    ]);
    res.json({
      submissions_total:        total.count        ?? 0,
      submissions_pending:      pending.count      ?? 0,
      subscribers_active:       subActive.count    ?? 0,
      subscribers_unsubscribed: subUnsub.count     ?? 0,
      emails_sent:              emailsSent.count   ?? 0,
      emails_failed:            emailsFailed.count ?? 0,
      newsletters_total:        nlTotal.count      ?? 0,
      newsletters_drafts:       nlDrafts.count     ?? 0,
      recent:                   recent.data        ?? [],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- /submissions ----
dash.get('/submissions', async (_req, res) => {
  if (!needDb(res)) return;
  try {
    const { data } = await db.query(
      'contact_submissions?select=id,created_at,name,email,message,reply_status,newsletter_subscribed,unsubscribed_at&order=created_at.desc&limit=500'
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- /subscribers ----
dash.get('/subscribers', async (_req, res) => {
  if (!needDb(res)) return;
  try {
    const { data } = await db.query(
      'contact_submissions?select=id,created_at,name,email,newsletter_opt_in_at&newsletter_subscribed=eq.true&unsubscribed_at=is.null&order=newsletter_opt_in_at.desc.nullslast&limit=500'
    );
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

dash.post('/subscribers/:id/unsubscribe', async (req, res) => {
  if (!needDb(res)) return;
  const { error } = await db.update(
    'contact_submissions',
    `id=eq.${encodeURIComponent(req.params.id)}`,
    { unsubscribed_at: new Date().toISOString() }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---- /emails ----
dash.get('/emails', async (_req, res) => {
  if (!needDb(res)) return;
  try {
    const { data } = await db.query(
      'email_interactions?select=id,sent_at,kind,step,status,error,submission_id,contact_submissions(email)&order=sent_at.desc&limit=500'
    );
    res.json((data ?? []).map(r => ({ ...r, recipient_email: r.contact_submissions?.email ?? null })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- /newsletters ----
dash.get('/newsletters', async (_req, res) => {
  if (!needDb(res)) return;
  try {
    const { data } = await db.query(
      'newsletters?select=id,created_at,updated_at,subject,status,sent_at,sent_count&order=updated_at.desc'
    );
    res.json(data ?? []);
  } catch (e) {
    // If the table doesn't exist yet (migration not run), return empty so UI works
    if (/relation .* does not exist/i.test(e.message)) return res.json([]);
    res.status(500).json({ error: e.message });
  }
});

dash.post('/newsletters', async (req, res) => {
  if (!needDb(res)) return;
  const { subject, body_html } = req.body || {};
  if (!subject || !body_html) return res.status(400).json({ error: 'subject and body_html are required' });
  const { data, error } = await db.insert('newsletters', {
    subject:   String(subject).slice(0, 200),
    body_html: String(body_html),
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json(Array.isArray(data) ? data[0] : data);
});

dash.delete('/newsletters/:id', async (req, res) => {
  if (!needDb(res)) return;
  const { error } = await db.remove('newsletters', `id=eq.${encodeURIComponent(req.params.id)}`);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.use('/api/dashboard', dash);

// ---- Boot ----
app.listen(PORT, () => {
  console.log(`Tester server running at http://localhost:${PORT}`);
  console.log(`Dashboard:               http://localhost:${PORT}/dashboard.html`);
});
