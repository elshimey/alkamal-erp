// أمر البناء على Vercel: يحدّث قاعدة البيانات ثم يبني التطبيق.
// إن لم تُربط قاعدة بيانات بعد يُبنى التطبيق فقط، ويُعاد النشر بعد ربطها.
import { execSync } from "node:child_process";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

// نسخ المعاينة (لكل طلب دمج) لا تعدّل قاعدة البيانات: قد تكون نفس قاعدة الإنتاج،
// فتصل جداول تغيير لم يُدمج بعد إلى بيانات الشركات. التحديث عند نشر الإنتاج فقط،
// إلا إن كانت للمعاينة قاعدة منفصلة (فرع Neon) وضُبط PREVIEW_DB_ISOLATED=1.
const env = process.env.VERCEL_ENV;
const mayMigrate = env === "production" || !env || process.env.PREVIEW_DB_ISOLATED === "1";

if (process.env.DATABASE_URL && mayMigrate) {
  run("npm run db:setup");
} else if (process.env.DATABASE_URL) {
  console.warn(`ℹ نسخة ${env}: لن تُحدَّث قاعدة البيانات؛ يحدث ذلك عند الدمج والنشر للإنتاج`);
} else {
  console.warn("⚠ لا توجد قاعدة بيانات مربوطة (DATABASE_URL)؛ اربط Neon من تبويب Storage ثم أعد النشر");
}
run("npx next build");
