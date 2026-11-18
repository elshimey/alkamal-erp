// اختبارات المتصفح (Playwright): تجرّب البرنامج كما يستخدمه العميل، من الدخول حتى القيد.
// التشغيل: npm run e2e  (يجهّز قاعدة E2E_DATABASE_URL من الصفر ثم يشغّل البرنامج المبني ويختبره)
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const dbUrl = process.env.E2E_DATABASE_URL ?? "postgres://erp:erp@localhost:5432/alkamal_erp_e2e";

export default defineConfig({
  testDir: "e2e",
  // كل الاختبارات على قاعدة واحدة، فتعمل واحداً بعد الآخر
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ar",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DATABASE_URL: dbUrl },
  },
});
