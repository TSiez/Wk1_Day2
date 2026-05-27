// ----------------------------------------------------------------------------
// Tester — send-welcome-email
// Fires on INSERT into public.contact_submissions (via Supabase DB Webhook),
// sends a reply-friendly confirmation email through Resend.
// ----------------------------------------------------------------------------
import { Resend }       from 'npm:resend@3.5.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_ADDRESS   = Deno.env.get('FROM_ADDRESS')   ?? 'Tester Workshop <onboarding@resend.dev>';
const REPLY_TO       = Deno.env.get('REPLY_TO')       ?? 'hello@tester.tech';
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

if (!RESEND_API_KEY) {
  console.error('RESEND_API_KEY is not set. Run: supabase secrets set RESEND_API_KEY=re_...');
}

const resend   = new Resend(RESEND_API_KEY);
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  // ---- Shared-secret check (cheap auth — keeps strangers from triggering sends) ----
  if (WEBHOOK_SECRET) {
    const incoming = req.headers.get('x-webhook-secret');
    if (incoming !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  let payload: any;
  try { payload = await req.json(); }
  catch { return jsonErr(400, 'invalid JSON'); }

  // Supabase webhook payload: { type: 'INSERT', table, record, schema, old_record }
  const row = payload?.record ?? payload;
  if (!row?.email || !row?.name) return jsonErr(400, 'missing email or name');

  const firstName = String(row.name).trim().split(/\s+/)[0];

  try {
    const { data, error } = await resend.emails.send({
      from:     FROM_ADDRESS,
      to:       [row.email],
      reply_to: REPLY_TO,
      subject:  `Your message reached the Berlin bench, ${firstName}`,
      html:     buildHtml({ firstName, message: row.message }),
      text:     buildText({ firstName, message: row.message }),
      tags: [
        { name: 'kind',   value: 'contact_confirmation' },
        { name: 'source', value: String(row.source ?? 'landing_contact_form') },
      ],
    });

    // Log every send (success OR failure) to email_interactions
    await supabase.from('email_interactions').insert({
      submission_id: row.id,
      kind:          'confirmation',
      step:          0,
      resend_id:     data?.id ?? null,
      status:        error ? 'failed' : 'sent',
      error:         error?.message ?? null,
    });

    if (error) {
      console.error('Resend error:', error);
      return jsonErr(502, error.message);
    }
    return new Response(JSON.stringify({ ok: true, id: data?.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    if (row?.id) {
      await supabase.from('email_interactions').insert({
        submission_id: row.id, kind: 'confirmation', step: 0,
        status: 'failed', error: (err as Error).message,
      });
    }
    return jsonErr(500, (err as Error).message);
  }
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function jsonErr(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function escape(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildText({ firstName, message }: { firstName: string; message: string }) {
  return [
    `Hi ${firstName},`,
    ``,
    `Your message reached the workshop in Berlin — thank you for writing.`,
    `A member of the bench will read it personally and reply within two working days.`,
    ``,
    `In the meantime: if you have anything to add — a question, a follow-up,`,
    `or just a hello — just hit reply on this email. It goes straight to a human.`,
    ``,
    `For reference, this is what you sent:`,
    `---`,
    `${message}`,
    `---`,
    ``,
    `Wear the instrument.`,
    `Tester Instruments — Berlin`,
  ].join('\n');
}

function buildHtml({ firstName, message }: { firstName: string; message: string }) {
  // Inline styles only — most email clients strip <style> blocks.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your message reached the Berlin bench</title>
</head>
<body style="margin:0;padding:0;background:#0a0908;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#f3efe7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0908;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#15140f;border:1px solid rgba(243,239,231,0.16);border-radius:2px;">
        <!-- Brand bar -->
        <tr><td style="padding:28px 32px 0 32px;">
          <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#8a847a;">
            <span style="color:#c89e6a;">●</span>&nbsp; Tester &nbsp;/&nbsp; Workshop reply
          </p>
        </td></tr>

        <!-- Headline -->
        <tr><td style="padding:24px 32px 8px 32px;">
          <h1 style="margin:0;font-family:'Times New Roman',Georgia,serif;font-weight:400;font-size:32px;line-height:1.05;color:#f3efe7;letter-spacing:-0.01em;">
            Your message<br/>
            <em style="font-style:italic;color:#c89e6a;">has landed.</em>
          </h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:20px 32px 8px 32px;font-size:15px;line-height:1.65;color:#c8c2b6;">
          <p style="margin:0 0 16px 0;">Hi ${escape(firstName)},</p>
          <p style="margin:0 0 16px 0;">
            Your note reached the workshop in Berlin &mdash; thank you for writing.
            A member of the bench will read it personally and reply within two working days.
          </p>
          <p style="margin:0 0 16px 0;">
            <strong style="color:#f3efe7;font-weight:600;">If anything else comes to mind,&nbsp;just hit reply.</strong>
            This email goes straight to a human, not a queue. We answer fastest when you
            keep the thread going.
          </p>
        </td></tr>

        <!-- Quote of their message -->
        <tr><td style="padding:8px 32px 8px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1c1a14;border-left:2px solid #c89e6a;">
            <tr><td style="padding:14px 18px;">
              <p style="margin:0 0 8px 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#5a564e;">
                What you sent
              </p>
              <p style="margin:0;font-family:'Times New Roman',Georgia,serif;font-style:italic;font-size:15px;line-height:1.55;color:#c8c2b6;white-space:pre-wrap;">${escape(message)}</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Signature -->
        <tr><td style="padding:24px 32px 28px 32px;border-top:1px solid rgba(243,239,231,0.08);">
          <p style="margin:16px 0 4px 0;font-family:'Times New Roman',Georgia,serif;font-style:italic;font-size:17px;color:#f3efe7;">
            Wear the instrument.
          </p>
          <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#5a564e;">
            Tester Instruments &nbsp;/&nbsp; Berlin &nbsp;/&nbsp; 2026
          </p>
        </td></tr>
      </table>

      <!-- Footer -->
      <p style="margin:18px 0 0 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#5a564e;">
        You're receiving this because you wrote to us at tester.tech &middot; Reply to opt out.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}
