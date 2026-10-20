import { defineConfig } from '@playwright/test';
import 'dotenv/config';
// Fixtures must never repopulate a user's real catalogue or share its media folder.
const testDatabase = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!);
if (!process.env.TEST_DATABASE_URL) testDatabase.pathname += '_e2e';
if (!testDatabase.pathname.endsWith('_e2e'))
  throw new Error('TEST_DATABASE_URL must use a separate _e2e database.');
process.env.DATABASE_URL = testDatabase.toString();
process.env.TEST_DATABASE_URL = testDatabase.toString();
process.env.DATA_DIR = '.local/e2e/uploads';
process.env.DEMO_MODE = 'true';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1440, height: 900 },
    // The product plays H.264 MP4; bundled Chromium lacks that codec on Linux.
    channel: process.env.CHROMIUM_PATH ? undefined : 'chrome',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        '--no-sandbox',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node --import tsx scripts/start-test-server.ts',
    env: { PORT: '3100' },
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 240000,
  },
});
