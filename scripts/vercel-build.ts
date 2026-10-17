// أمر البناء على Vercel: يحدّث قاعدة البيانات ثم يبني التطبيق.
// إن لم تُربط قاعدة بيانات بعد يُبنى التطبيق فقط، ويُعاد النشر بعد ربطها.
import { execSync } from "node:child_process";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

if (process.env.DATABASE_URL) {
  run("npm run db:setup");
} else {
  console.warn("⚠ لا توجد قاعدة بيانات مربوطة (DATABASE_URL)؛ اربط Neon من تبويب Storage ثم أعد النشر");
}
run("npx next build");
