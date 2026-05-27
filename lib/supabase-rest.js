// ----------------------------------------------------------------------------
// Tiny PostgREST client using only Node's built-in fetch.
// Avoids @supabase/supabase-js so this works on Node 18 (no `ws` dep needed).
// Used by server.js and scripts/seed-submissions.mjs.
// ----------------------------------------------------------------------------

function rest(supabaseUrl, serviceKey) {
  const base = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1`;

  const headers = (extra = {}) => ({
    apikey:        serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type':'application/json',
    ...extra,
  });

  async function query(pathAndQuery, opts = {}) {
    const h = headers();
    if (opts.count) h.Prefer = `count=${opts.count}`;
    const res = await fetch(`${base}/${pathAndQuery}`, {
      method:  opts.head ? 'HEAD' : 'GET',
      headers: h,
    });

    let count = null;
    const cr = res.headers.get('content-range');
    if (cr) {
      const total = cr.split('/')[1];
      if (total && total !== '*') count = parseInt(total, 10);
    }

    if (!res.ok && !opts.head) {
      const text = await res.text();
      throw Object.assign(new Error(text || `${res.status}`), { status: res.status });
    }
    const data = opts.head ? null : await res.json();
    return { data, count };
  }

  async function insert(table, row, opts = {}) {
    const want = opts.return !== false;
    const res = await fetch(`${base}/${table}`, {
      method: 'POST',
      headers: headers({ Prefer: want ? 'return=representation' : 'return=minimal' }),
      body:   JSON.stringify(row),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { data: null, error: { code: err.code, message: err.message ?? `HTTP ${res.status}`, details: err.details } };
    }
    const data = want ? await res.json() : null;
    return { data, error: null };
  }

  async function update(table, queryString, patch) {
    const res = await fetch(`${base}/${table}?${queryString}`, {
      method:  'PATCH',
      headers: headers({ Prefer: 'return=minimal' }),
      body:    JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: { message: err.message ?? `HTTP ${res.status}`, code: err.code } };
    }
    return { error: null };
  }

  async function remove(table, queryString) {
    const res = await fetch(`${base}/${table}?${queryString}`, {
      method:  'DELETE',
      headers: headers({ Prefer: 'return=minimal' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: { message: err.message ?? `HTTP ${res.status}`, code: err.code } };
    }
    return { error: null };
  }

  return { query, insert, update, remove };
}

module.exports = { rest };
