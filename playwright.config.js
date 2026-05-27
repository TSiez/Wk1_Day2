// ----------------------------------------------------------------------------
// Playwright config — Tester landing page
// Runs the contact-form e2e test across Chromium, Firefox, and WebKit.
// Auto-starts the local Express server (npm start) and tears it down after.
// CommonJS because the project's Node version doesn't load ESM configs yet.
// ----------------------------------------------------------------------------
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  // Root test file + anything under ./tests
  testMatch: [
    'test-form.mjs',
    'tests/**/*.{spec,test}.mjs',
  ],
  testIgnore: ['node_modules/**', 'skills-main/**', 'animated-websites-skills/**'],

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://localhost:3030',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome']  } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari']  } },
  ],

  // Boot the Express server on port 3030 before tests run, kill it after.
  // We use 3030 (not 3000) so the test always starts a fresh server even when
  // another local project is already serving on 3000.
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3030',
    env: { PORT: '3030' },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
