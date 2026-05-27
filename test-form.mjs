// ----------------------------------------------------------------------------
// Contact-form end-to-end test.
// Runs against the live local index.html with all external services mocked.
// Covers: happy-path submission → redirect → thank-you page rendered.
// ----------------------------------------------------------------------------
import { test, expect } from '@playwright/test';
import { installMocks, trackSubmissions } from './tests/helpers/mock-network.mjs';

test.describe('Contact form', () => {
  test.beforeEach(async ({ page }) => {
    await installMocks(page);
  });

  test('submits the form and redirects to thank-you.html', async ({ page }) => {
    const { requests } = trackSubmissions(page);

    // 1. Land on the homepage
    // domcontentloaded — don't block on the hero <video> finishing buffering.
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // 2. Wait until the inline submit handler is wired up.
    //    The Supabase ESM bundle loads from a CDN — give it a moment.
    await page.waitForFunction(() => typeof window.submitForm === 'function', null, {
      timeout: 10_000,
    });

    // 3. Scroll the form into view so data-reveal animations complete
    const form = page.locator('#contact-form');
    await form.scrollIntoViewIfNeeded();
    await expect(form).toBeVisible();

    // 4. Fill the three required fields + the optional newsletter checkbox
    await page.fill('#cf-name',    'Playwright Tester');
    await page.fill('#cf-email',   'qa@example.com');
    await page.fill('#cf-message', 'This message was sent by an automated end-to-end test.');
    // The checkbox input is visually hidden behind a styled label.
    // Click the label — what a real user does, works cross-browser.
    await page.locator('label[for="cf-newsletter"]').click();
    await expect(page.locator('#cf-newsletter')).toBeChecked();

    // 5. Submit and wait for the redirect
    await Promise.all([
      page.waitForURL(/\/thank-you\.html(\?.*)?$/, { timeout: 10_000 }),
      page.locator('.contact__submit').click(),
    ]);

    // 6. Confirm the thank-you page rendered correctly
    await expect(page).toHaveURL(/\/thank-you\.html(\?.*)?$/);
    await expect(page.locator('.thanks__title')).toContainText(/landed/i);
    await expect(page.locator('.thanks__card')).toBeVisible();

    // 7. Confirm exactly one insert was attempted, with the right payload shape
    expect(requests.length).toBe(1);
    const body = JSON.parse(requests[0].postData() ?? '{}');
    expect(body).toMatchObject({
      name:                  'Playwright Tester',
      email:                 'qa@example.com',
      message:               'This message was sent by an automated end-to-end test.',
      newsletter_subscribed: true,
      source:                'landing_contact_form',
    });
    expect(body.user_agent).toBeTruthy();
  });

  test('shows an error and stays on the page when Supabase rejects the insert', async ({ page }) => {
    // Re-install mocks with the rls-block scenario
    await installMocks(page, { scenario: 'rls-block' });

    // domcontentloaded — don't block on the hero <video> finishing buffering.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.submitForm === 'function');

    const form = page.locator('#contact-form');
    await form.scrollIntoViewIfNeeded();

    await page.fill('#cf-name',    'Blocked User');
    await page.fill('#cf-email',   'blocked@example.com');
    await page.fill('#cf-message', 'This should trigger an RLS error path.');

    await page.locator('.contact__submit').click();

    // Status line shows an error, URL has not changed
    await expect(page.locator('#contactStatus')).toHaveClass(/is-error/, { timeout: 5_000 });
    await expect(page).toHaveURL(/\/(index\.html)?(#.*)?$/);
  });
});
