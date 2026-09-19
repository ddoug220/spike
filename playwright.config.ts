import { defineConfig, devices } from '@playwright/test';

const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4201',
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: process.env['SPIKE_E2E_OFFLINE'] === '1' ? 'npm run start:e2e:offline' : 'npm run start:e2e',
    url: 'http://127.0.0.1:4201',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
