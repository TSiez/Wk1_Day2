// ----------------------------------------------------------------------------
// Network mocks for the contact-form test.
// Intercepts the two outbound paths the form might hit:
//   1. Supabase PostgREST insert (current production path)
//   2. Google Apps Script Web App (legacy path — defensive)
// Both return believable success responses so the page's redirect logic fires.
// ----------------------------------------------------------------------------

/**
 * Install all mock routes on a Playwright Page.
 * Call this in test.beforeEach before page.goto().
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {'success'|'rls-block'|'network-error'} [opts.scenario] - response shape
 */
export async function installMocks(page, opts = {}) {
  const scenario = opts.scenario ?? 'success';

  // ---- Supabase REST insert ------------------------------------------------
  // supabase-js translates .from('contact_submissions').insert(...) into
  // POST <project>.supabase.co/rest/v1/contact_submissions
  await page.route('**/*.supabase.co/rest/v1/contact_submissions**', async (route) => {
    const req = route.request();

    if (req.method() !== 'POST') {
      return route.continue();
    }

    if (scenario === 'network-error') {
      return route.abort('failed');
    }

    if (scenario === 'rls-block') {
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          code: '42501',
          message: 'new row violates row-level security policy',
        }),
      });
    }

    // Default: success. Supabase returns 201 with no body when Prefer: return=minimal.
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/*' },
      body: '',
    });
  });

  // ---- Google Apps Script (legacy / defensive) -----------------------------
  await page.route('**/script.google.com/macros/**', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'success' }),
    });
  });

  // ---- Resend, if ever called from the browser (it shouldn't be) -----------
  await page.route('**/api.resend.com/**', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'mock-resend-id' }),
    });
  });
}

/**
 * Convenience: capture all requests made to mocked endpoints so the test
 * can assert what the form actually sent (e.g. correct field names).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {{ requests: import('@playwright/test').Request[] }}
 */
export function trackSubmissions(page) {
  const requests = [];
  page.on('request', (req) => {
    if (/\.supabase\.co\/rest\/v1\/contact_submissions/.test(req.url()) && req.method() === 'POST') {
      requests.push(req);
    }
  });
  return { requests };
}
