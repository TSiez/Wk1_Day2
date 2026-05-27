// ----------------------------------------------------------------------------
// Tester — unsubscribe
// Handles two flows:
//   GET  /unsubscribe?token=<uuid>   → confirmation page (user clicked link)
//   POST /unsubscribe?token=<uuid>   → one-click (RFC 8058, used by Gmail etc.)
// Either way: sets contact_submissions.unsubscribed_at = now()
// ----------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) return html(400, 'Missing token.');

  const { data, error } = await supabase
    .from('contact_submissions')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
    .is('unsubscribed_at', null)
    .select('email')
    .maybeSingle();

  if (error)         return html(500, 'Something went wrong. Please try again.');
  // null data = either bad token or already unsubscribed — same UX either way.

  if (req.method === 'POST') {
    return new Response(null, { status: 200 });
  }

  return html(200, `
    <p style="font-family:'Times New Roman',serif;font-size:22px;font-style:italic;color:#c89e6a;margin:0 0 12px 0;">You're out.</p>
    <p style="margin:0 0 20px 0;color:#c8c2b6;">No further messages from the bench. If you change your mind, the door's open.</p>
    <a href="/" style="display:inline-block;padding:10px 18px;background:#c89e6a;color:#0a0908;text-decoration:none;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:600;border-radius:2px;">Back to the Pro</a>
  `);
});

function html(status: number, body: string) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Tester — unsubscribed</title></head>
<body style="margin:0;padding:0;background:#0a0908;color:#f3efe7;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:440px;padding:36px 28px;text-align:center;background:#15140f;border:1px solid rgba(243,239,231,0.16);border-radius:2px;">
    ${body}
  </div>
</body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
