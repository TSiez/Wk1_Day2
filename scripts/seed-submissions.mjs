// ----------------------------------------------------------------------------
// Seeds public.contact_submissions with 20 realistic test rows.
// Uses the service role key from .env via a tiny fetch-based PostgREST client,
// so RLS is bypassed and we can set reply_status, replied_at, replied_by,
// unsubscribed_at, etc. to look real.
//
// Run from the project root:    node scripts/seed-submissions.mjs
// ----------------------------------------------------------------------------
import 'dotenv/config';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { rest } = require('../lib/supabase-rest.js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const db = rest(SUPABASE_URL, SERVICE_KEY);

// ---- Believable-looking sample data ----
const people = [
  ['Mara Lindqvist',     'mara.lindqvist@nordhavn.no',     'Field-testing the Pro for a documentary shoot in Svalbard next month. Curious about the cold-rating spec beyond -30C.'],
  ['Daichi Yamashita',   'd.yamashita@kogei-lab.jp',       'We commission custom watch straps for a Tokyo design firm. Open to a partnership conversation around your Series 2 launch?'],
  ['Pedro Faria',        'pedrof@maritime-consult.pt',     'I freedive competitively in Sesimbra. The L1+L5 GNSS spec is what brought me here. Can it log dives below 30m without surface-fix loss?'],
  ['Eleni Papadakis',    'eleni@papadakisstudio.gr',       'Industrial designer based in Athens. Would love to see the unfinished titanium prototype if you ever do studio visits.'],
  ['Tomas Ortega',       'tomas@ortega-arquitectos.es',    'Reserved unit #47. Just confirming the Q4 ship window is still on for European reservations. Thanks.'],
  ['Aoife McKenna',      'aoifemck@gmail.com',             'Question about strap sizes - my wrist is 14.2cm and I worry the small bracelet still drops. Do you offer a half-link option?'],
  ['Henrik Olausson',    'henrik.o@nordlys-design.se',     'How is the AMOLED panel rated for daylight readability above 50,000 lux? Field photography work in white-desert conditions.'],
  ['Yusra Abdul-Karim',  'yusra@abdulkarim.ae',            'Considering a bulk order for our diving school in Muscat (12 units). Please share enterprise pricing if it exists.'],
  ['Linnea Carlsson',    'l.carlsson@klimat-data.se',      'Working on alpine atmospheric sensors. Curious if the Pro accepts custom data streams via the BLE channel, or is the API closed?'],
  ['Marc Bisset',        'marc.bisset@quaiseventeen.fr',   'The dissection video is gorgeous. What lens setup did you use for the macro work on the sensor block? Asking as a fellow filmmaker.'],
  ['Sofia Aravena',      'sofia.aravena@cl-andes.cl',      'Trekking the Cordillera in October. Need a watch that survives 5 weeks unsupported. Is the 14-day spec with always-on GPS or just standby?'],
  ['Idris Bennett',      'idrisb@thefieldnotes.co.uk',     'Editor at The Field Notes magazine. We profile small precision-instrument makers. Open to a workshop visit in Berlin this autumn?'],
  ['Mei-Lin Chen',       'meilin@chen-strap.tw',           'Strap manufacturer in Taipei. Curious about your bracelet end-link tolerances. Happy to share spec docs if useful.'],
  ['Joaquin Vega',       'j.vega@correosvega.es',          'Hi! Bought watches for 20 years. The titanium grade-5 detail sold me. Order placed last week, just saying thanks for the integrity of the spec sheet.'],
  ['Greta Kohl',         'greta.kohl@hoerakustik.de',      'Audiologist in Munich. Will the heart-rate sensor cause interference with cochlear implants? Could not find this in the FAQ.'],
  ['Tariq Hassan',       'tariq@hassan-marine.com',        'Sailing crew supplier for offshore racing. Need 6 units IP-rated to your 200m spec. When does Series 2 hit available stock?'],
  ['Maya Berkowitz',     'maya.b@berkowitz-photo.com',     'Documentary photographer. Want to see the strap-cleaning protocol - saltwater shoots wreck most leather rapidly. Synthetic option available?'],
  ['Lukas Schneider',    'lukas.schneider@trauerhalle.at', 'Watchmaker in Vienna. Your decision to use a coprocessor instead of a coin-cell for AOD is interesting. Would love a deeper read on that choice.'],
  ['Naomi Tanaka',       'naomi.tanaka@odc-jp.com',        'Considering as a 60th-birthday gift for my father. Is there a gift-wrapping or engraving option available with the reservation?'],
  ['Bram Visser',        'bram@visser-marathon.nl',        'Marathon runner in Rotterdam. Curious about the cadence tracking - does it differentiate uphill vs flat strides in the IMU fusion?'],
];

const STATUSES   = ['pending','pending','pending','pending','replied','replied','archived','spam'];
const REPLIED_BY = ['hello@tester.tech', 'workshop@tester.tech'];

const pick   = (arr) => arr[Math.floor(Math.random() * arr.length)];
const within = (days) => new Date(Date.now() - Math.random() * days * 86_400_000).toISOString();

const rows = people.map(([name, email, message]) => {
  const created_at = within(45);
  const status     = pick(STATUSES);
  const newsletter = Math.random() > 0.35;
  const unsub      = newsletter && Math.random() < 0.10
    ? new Date(Date.now() - Math.random() * 7 * 86_400_000).toISOString()
    : null;

  return {
    created_at,
    name,
    email,
    message,
    reply_status: status,
    replied_at:   status === 'replied'
      ? new Date(new Date(created_at).getTime() + (1 + Math.random() * 36) * 3600_000).toISOString()
      : null,
    replied_by:   status === 'replied' ? pick(REPLIED_BY) : null,
    newsletter_subscribed: newsletter,
    newsletter_opt_in_at:  newsletter ? created_at : null,
    unsubscribed_at:       unsub,
    source:        'landing_contact_form',
    user_agent:    'Mozilla/5.0 (seed) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  };
});

console.log(`Seeding ${rows.length} submissions to ${SUPABASE_URL}…`);

let ok = 0, dup = 0, err = 0;
for (const row of rows) {
  const { error } = await db.insert('contact_submissions', row, { return: false });
  if (!error)                       { ok++; }
  else if (error.code === '23505')  { dup++; console.log(`  skip dup: ${row.email}`); }
  else                              { err++; console.error(`  fail ${row.email}: ${error.message}`); }
}

console.log(`\nDone. inserted=${ok}  duplicates=${dup}  errors=${err}`);
process.exit(err > 0 ? 1 : 0);
