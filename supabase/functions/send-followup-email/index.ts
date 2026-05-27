// ----------------------------------------------------------------------------
// Tester — send-followup-email
// Invoked daily by pg_cron. Scans contact_submissions for rows due for the
// next follow-up step (5/10/15/20 days), sends via Resend, logs to
// email_interactions. Idempotent — safe to run multiple times per day.
// ----------------------------------------------------------------------------
import { Resend }       from 'npm:resend@3.5.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FROM_ADDRESS   = Deno.env.get('FROM_ADDRESS')  ?? 'Tester Workshop <onboarding@resend.dev>';
const REPLY_TO       = Deno.env.get('REPLY_TO')      ?? 'hello@tester.tech';
const SITE_URL       = Deno.env.get('SITE_URL')      ?? 'https://tester.tech';
const CRON_SECRET    = Deno.env.get('CRON_SECRET');

const resend   = new Resend(RESEND_API_KEY);
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---- Cadence definition --------------------------------------------------
type StepDef = {
  step: 1 | 2 | 3 | 4;
  daysAfter: number;
  kind: 'followup_value' | 'followup_testimonials' | 'followup_updates' | 'followup_final';
  subject: (firstName: string) => string;
  build: (ctx: TemplateCtx) => { html: string; text: string };
};

type TemplateCtx = {
  firstName: string;
  unsubscribeUrl: string;
};

const STEPS: StepDef[] = [
  {
    step: 1, daysAfter: 5, kind: 'followup_value',
    subject: n => `${n}, why the Pro is built like an instrument`,
    build: valueEmail,
  },
  {
    step: 2, daysAfter: 10, kind: 'followup_testimonials',
    subject: n => `What field testers are saying, ${n}`,
    build: testimonialsEmail,
  },
  {
    step: 3, daysAfter: 15, kind: 'followup_updates',
    subject: n => `News from the bench, ${n}`,
    build: updatesEmail,
  },
  {
    step: 4, daysAfter: 20, kind: 'followup_final',
    subject: _ => `Still thinking it over?`,
    build: finalEmail,
  },
];

// ---- Handler --------------------------------------------------------------
Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return j(401, { ok: false, error: 'unauthorized' });
  }

  // Pull active prospects + their already-sent steps in one query
  const { data: rows, error } = await supabase
    .from('contact_submissions')
    .select(`
      id, name, email, created_at, unsubscribe_token,
      email_interactions ( step, status )
    `)
    .eq('reply_status', 'pending')
    .is('unsubscribed_at', null);

  if (error) return j(500, { ok: false, error: error.message });

  const now = Date.now();
  const results: any[] = [];

  for (const row of rows ?? []) {
    const ageDays = (now - new Date(row.created_at).getTime()) / 86_400_000;
    const sentSteps = new Set((row.email_interactions ?? []).map((i: any) => i.step));

    // Find the highest step that's due AND not yet sent
    const due = STEPS.find(s => ageDays >= s.daysAfter && !sentSteps.has(s.step));
    if (!due) continue;

    const firstName = String(row.name).trim().split(/\s+/)[0];
    const unsubscribeUrl = `${SITE_URL.replace(/\/+$/, '')}/unsubscribe?token=${row.unsubscribe_token}`;
    const { html, text } = due.build({ firstName, unsubscribeUrl });

    try {
      const { data, error: sendErr } = await resend.emails.send({
        from:     FROM_ADDRESS,
        to:       [row.email],
        reply_to: REPLY_TO,
        subject:  due.subject(firstName),
        html, text,
        tags: [
          { name: 'kind', value: due.kind },
          { name: 'step', value: String(due.step) },
        ],
        headers: {
          // RFC 8058 one-click unsubscribe (Gmail / iCloud / Outlook honor this)
          'List-Unsubscribe':      `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });

      await supabase.from('email_interactions').insert({
        submission_id: row.id,
        kind:          due.kind,
        step:          due.step,
        resend_id:     data?.id ?? null,
        status:        sendErr ? 'failed' : 'sent',
        error:         sendErr?.message ?? null,
      });

      results.push({ email: row.email, step: due.step, ok: !sendErr, error: sendErr?.message });
    } catch (e) {
      const msg = (e as Error).message;
      await supabase.from('email_interactions').insert({
        submission_id: row.id, kind: due.kind, step: due.step, status: 'failed', error: msg,
      });
      results.push({ email: row.email, step: due.step, ok: false, error: msg });
    }
  }

  return j(200, { ok: true, processed: results.length, results });
});

// ---- Helpers --------------------------------------------------------------
function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function escape(s: string) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Shared email shell — keeps every template visually identical
function shell({ headline, italicTail, body, ctaLabel, ctaUrl, unsubscribeUrl }: {
  headline: string; italicTail: string; body: string;
  ctaLabel?: string; ctaUrl?: string; unsubscribeUrl: string;
}) {
  const cta = ctaLabel && ctaUrl
    ? `<tr><td style="padding:8px 32px 24px 32px;">
         <a href="${escape(ctaUrl)}" style="display:inline-block;padding:12px 22px;background:#c89e6a;color:#0a0908;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;text-decoration:none;border-radius:2px;font-weight:600;">${escape(ctaLabel)} &nbsp;→</a>
       </td></tr>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0a0908;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#f3efe7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0908;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#15140f;border:1px solid rgba(243,239,231,0.16);border-radius:2px;">
        <tr><td style="padding:28px 32px 0 32px;">
          <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#8a847a;">
            <span style="color:#c89e6a;">●</span>&nbsp; Tester &nbsp;/&nbsp; From the workshop
          </p>
        </td></tr>
        <tr><td style="padding:24px 32px 8px 32px;">
          <h1 style="margin:0;font-family:'Times New Roman',Georgia,serif;font-weight:400;font-size:30px;line-height:1.08;color:#f3efe7;letter-spacing:-0.01em;">
            ${headline}<br/><em style="font-style:italic;color:#c89e6a;">${italicTail}</em>
          </h1>
        </td></tr>
        <tr><td style="padding:20px 32px 8px 32px;font-size:15px;line-height:1.65;color:#c8c2b6;">
          ${body}
        </td></tr>
        ${cta}
        <tr><td style="padding:24px 32px 28px 32px;border-top:1px solid rgba(243,239,231,0.08);">
          <p style="margin:16px 0 4px 0;font-family:'Times New Roman',Georgia,serif;font-style:italic;font-size:17px;color:#f3efe7;">Wear the instrument.</p>
          <p style="margin:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#5a564e;">
            Tester Instruments &nbsp;/&nbsp; Berlin &nbsp;/&nbsp; 2026
          </p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#5a564e;">
        <a href="${escape(unsubscribeUrl)}" style="color:#5a564e;text-decoration:underline;">Unsubscribe</a>
        &nbsp;&middot;&nbsp; Reply to this email to reach a human.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

// ---- Per-step templates -------------------------------------------------
// Customise copy here. Redeploy the function to push changes.

function valueEmail(ctx: TemplateCtx) {
  const body = `
    <p style="margin:0 0 16px 0;">Hi ${escape(ctx.firstName)},</p>
    <p style="margin:0 0 16px 0;">
      Three things people stop asking about once they wear the Pro for a week:
    </p>
    <ul style="margin:0 0 16px 0;padding:0;list-style:none;">
      <li style="padding:10px 14px;border-left:2px solid #c89e6a;background:#1c1a14;margin-bottom:10px;">
        <strong style="color:#f3efe7;">Sapphire optic stack.</strong> Six channels behind aerospace-grade sapphire.
        Reads pulse and oxygen accurately through sweat, sun, and skin tones I–VI.
      </li>
      <li style="padding:10px 14px;border-left:2px solid #c89e6a;background:#1c1a14;margin-bottom:10px;">
        <strong style="color:#f3efe7;">14-day endurance.</strong> LTPO panel + sub-µA coprocessor + silicon-anode cell.
        Forty hours of full-fat GPS in the same charge cycle.
      </li>
      <li style="padding:10px 14px;border-left:2px solid #c89e6a;background:#1c1a14;">
        <strong style="color:#f3efe7;">Dual-band GNSS.</strong> L1 + L5 across four constellations.
        Clean fixes in urban canyons and deep cover — tracks in metres, not minutes.
      </li>
    </ul>
    <p style="margin:0;">
      Anything specific you'd like a deeper read on? Just hit reply.
    </p>`;
  return {
    html: shell({
      headline: 'Built like an',
      italicTail: 'instrument.',
      body,
      ctaLabel: 'See the dissection',
      ctaUrl: `${SITE_URL.replace(/\/+$/, '')}/#dissection`,
      unsubscribeUrl: ctx.unsubscribeUrl,
    }),
    text:
`Hi ${ctx.firstName},

Three things people stop asking about once they wear the Pro for a week:

• Sapphire optic stack — six channels reading pulse and oxygen through sweat, sun, and any skin tone.
• 14-day endurance — LTPO panel + sub-µA coprocessor. Forty hours of full GPS in the same cycle.
• Dual-band GNSS — L1 + L5 across four constellations. Clean fixes in urban canyons.

See the dissection: ${SITE_URL}/#dissection

Anything specific you'd like a deeper read on? Just hit reply.

— Tester Instruments / Berlin
Unsubscribe: ${ctx.unsubscribeUrl}`,
  };
}

function testimonialsEmail(ctx: TemplateCtx) {
  // TODO: replace these with real testimonials once you have them
  const body = `
    <p style="margin:0 0 16px 0;">Hi ${escape(ctx.firstName)},</p>
    <p style="margin:0 0 20px 0;">
      Three notes from the first hundred field testers. Unedited.
    </p>
    <blockquote style="margin:0 0 16px 0;padding:14px 18px;border-left:2px solid #c89e6a;background:#1c1a14;font-style:italic;color:#c8c2b6;">
      "I freedive most weekends. The Pro is the first watch that doesn't lie to me at depth — the GNSS picks up the second I surface, every time."<br/>
      <span style="display:block;margin-top:8px;font-style:normal;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#8a847a;">— Field tester, Hamburg</span>
    </blockquote>
    <blockquote style="margin:0 0 16px 0;padding:14px 18px;border-left:2px solid #c89e6a;background:#1c1a14;font-style:italic;color:#c8c2b6;">
      "Two weeks of battery isn't marketing. I forgot the charger on a thirteen-day Pyrenees trip and didn't notice."<br/>
      <span style="display:block;margin-top:8px;font-style:normal;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#8a847a;">— Field tester, Toulouse</span>
    </blockquote>
    <blockquote style="margin:0 0 20px 0;padding:14px 18px;border-left:2px solid #c89e6a;background:#1c1a14;font-style:italic;color:#c8c2b6;">
      "I wear watches like jewellery; this one I wear like a tool. I think that's the point."<br/>
      <span style="display:block;margin-top:8px;font-style:normal;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#8a847a;">— Field tester, Berlin</span>
    </blockquote>
    <p style="margin:0;">
      What would tip you over? Reply with the deciding question — we read every one.
    </p>`;
  return {
    html: shell({
      headline: 'From the',
      italicTail: 'field.',
      body,
      ctaLabel: 'Reserve the Pro',
      ctaUrl: `${SITE_URL.replace(/\/+$/, '')}/#order`,
      unsubscribeUrl: ctx.unsubscribeUrl,
    }),
    text:
`Hi ${ctx.firstName},

Three notes from the first hundred field testers. Unedited.

"I freedive most weekends. The Pro is the first watch that doesn't lie to me at depth."
— Field tester, Hamburg

"Two weeks of battery isn't marketing. I forgot the charger on a thirteen-day Pyrenees trip and didn't notice."
— Field tester, Toulouse

"I wear watches like jewellery; this one I wear like a tool."
— Field tester, Berlin

Reserve the Pro: ${SITE_URL}/#order

What would tip you over? Just hit reply.

— Tester Instruments / Berlin
Unsubscribe: ${ctx.unsubscribeUrl}`,
  };
}

function updatesEmail(ctx: TemplateCtx) {
  // TODO: replace with current bench news
  const body = `
    <p style="margin:0 0 16px 0;">Hi ${escape(ctx.firstName)},</p>
    <p style="margin:0 0 16px 0;">
      Short dispatch from the workshop this fortnight:
    </p>
    <p style="margin:0 0 12px 0;"><strong style="color:#f3efe7;">Caliber T-12 / Apex passed thermal soak.</strong>
      Continuous operation between &minus;30 °C and &plus;55 °C. Cell still hits 96% rated capacity at the cold end.</p>
    <p style="margin:0 0 12px 0;"><strong style="color:#f3efe7;">Strap line expanded.</strong>
      Brushed titanium link bracelet and a vegetable-tanned roughout leather option. Both quick-release.</p>
    <p style="margin:0 0 20px 0;"><strong style="color:#f3efe7;">First hundred reservations</strong> are 78% filled.
      Ship window is on track for Q4. If you've been on the fence, the deposit slot is currently still &dollar;50.</p>
    <p style="margin:0;">Questions about any of this? Reply — we'll write back.</p>`;
  return {
    html: shell({
      headline: 'News from the',
      italicTail: 'bench.',
      body,
      ctaLabel: 'Hold a slot',
      ctaUrl: `${SITE_URL.replace(/\/+$/, '')}/#order`,
      unsubscribeUrl: ctx.unsubscribeUrl,
    }),
    text:
`Hi ${ctx.firstName},

Short dispatch from the workshop this fortnight:

• Caliber T-12 / Apex passed thermal soak between −30°C and +55°C.
• Strap line expanded: brushed titanium link bracelet, vegetable-tanned leather.
• First hundred reservations are 78% filled. Deposit slot still $50.

Hold a slot: ${SITE_URL}/#order

Questions about any of this? Just hit reply.

— Tester Instruments / Berlin
Unsubscribe: ${ctx.unsubscribeUrl}`,
  };
}

function finalEmail(ctx: TemplateCtx) {
  const body = `
    <p style="margin:0 0 16px 0;">Hi ${escape(ctx.firstName)},</p>
    <p style="margin:0 0 16px 0;">
      This is the last note from the workshop on this thread — we don't keep writing to people
      who'd rather we didn't.
    </p>
    <p style="margin:0 0 16px 0;">
      But if there was a question I missed — a sizing detail, a sensor reading, the strap question —
      hit reply and ask. One human reads everything that comes in.
    </p>
    <p style="margin:0;">Either way, thanks for being curious about the Pro.</p>`;
  return {
    html: shell({
      headline: 'Last note,',
      italicTail: 'unless you want more.',
      body,
      unsubscribeUrl: ctx.unsubscribeUrl,
    }),
    text:
`Hi ${ctx.firstName},

This is the last note from the workshop on this thread — we don't keep writing to people who'd rather we didn't.

If there was a question I missed, hit reply and ask. One human reads everything that comes in.

Either way, thanks for being curious about the Pro.

— Tester Instruments / Berlin
Unsubscribe: ${ctx.unsubscribeUrl}`,
  };
}
