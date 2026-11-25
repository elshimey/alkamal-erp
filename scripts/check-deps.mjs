// فحص المكتبات ضد «Slopsquatting» (مكتبة وهمية يقترحها الذكاء الاصطناعي ويحجز المهاجم اسمها):
// 1) كل مكتبة في package.json لا بد أن تكون في القائمة المعتمدة أدناه. أي مكتبة جديدة توقف الفحص
//    حتى يُتحقق منها على npm (موجودة، قديمة، مشهورة، لها مستودع معروف) وتُضاف هنا بسببها.
// 2) كل مكتبة في package-lock.json تأتي من registry.npmjs.org وعليها بصمة integrity
//    (لا روابط git أو ملفات من مواقع أخرى).
// يعمل دون تثبيت: node scripts/check-deps.mjs
import { readFileSync } from "node:fs";

// الاسم ← سبب الاعتماد (تحقق 2026-11-25: كلها على npm منذ سنوات ولها مستودع GitHub معروف)
const APPROVED = {
  // يعمل في البرنامج
  bcryptjs: "تشفير كلمات المرور (2013)",
  "drizzle-orm": "الوصول لقاعدة البيانات (2021، فريق Drizzle)",
  exceljs: "قراءة وكتابة Excel (2014)",
  "html-to-image": "تحويل المستند لصورة قبل PDF (2017)",
  jspdf: "إنشاء PDF (2015)",
  jszip: "ملفات ZIP للتصدير (2013)",
  next: "إطار البرنامج (Vercel)",
  nodemailer: "إرسال البريد (2011)",
  postgres: "اتصال PostgreSQL (2015)",
  qrcode: "رمز QR في الفاتورة الضريبية (2010)",
  react: "الواجهة (Meta)",
  "react-dom": "الواجهة (Meta)",
  "server-only": "يمنع وصول كود الخادم للمتصفح (React/Next الرسمية)",
  "web-push": "الإشعار الفوري (2015)",
  zod: "فحص المدخلات (2020)",
  // للتطوير والاختبار فقط
  "@eslint/eslintrc": "فحص الكود (ESLint الرسمية)",
  "@playwright/test": "اختبارات المتصفح (Microsoft)",
  "@tailwindcss/postcss": "التنسيق (Tailwind الرسمية)",
  "@types/node": "أنواع TypeScript (DefinitelyTyped)",
  "@types/nodemailer": "أنواع TypeScript (DefinitelyTyped)",
  "@types/qrcode": "أنواع TypeScript (DefinitelyTyped)",
  "@types/react": "أنواع TypeScript (DefinitelyTyped)",
  "@types/react-dom": "أنواع TypeScript (DefinitelyTyped)",
  "@types/web-push": "أنواع TypeScript (DefinitelyTyped)",
  "@xmldom/xmldom": "قراءة XML للفوترة الإلكترونية (2021)",
  "drizzle-kit": "الترحيلات (فريق Drizzle)",
  eslint: "فحص الكود (2013)",
  "eslint-config-next": "قواعد Next (Vercel)",
  tailwindcss: "التنسيق (2017)",
  tsx: "تشغيل سكربتات TypeScript (2015)",
  typescript: "اللغة (Microsoft)",
  vitest: "الاختبارات (2021)",
  xmldsigjs: "توقيع XML للفوترة الإلكترونية ZATCA (2016، PeculiarVentures)",
  // overrides
  uuid: "نسخة آمنة لمكتبة فرعية (2011)",
};

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const errors = [];

const declared = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.optionalDependencies,
  ...pkg.overrides,
};
for (const [name, spec] of Object.entries(declared)) {
  if (!APPROVED[name]) {
    errors.push(
      `مكتبة غير معتمدة: ${name}. تحقق منها على https://www.npmjs.com/package/${name} (موجودة، عمرها، تنزيلاتها، مستودعها) ثم أضفها إلى APPROVED في scripts/check-deps.mjs بسببها.`,
    );
  }
  if (typeof spec === "string" && /^(git|github:|https?:|file:|link:)/.test(spec)) {
    errors.push(`${name}: المصدر "${spec}" ليس سجل npm.`);
  }
}

for (const [path, info] of Object.entries(lock.packages ?? {})) {
  if (!path || info.link) continue;
  if (!info.resolved) continue;
  if (!info.resolved.startsWith("https://registry.npmjs.org/")) {
    errors.push(`${path}: يأتي من ${info.resolved} وليس من registry.npmjs.org.`);
  }
  if (!info.integrity) errors.push(`${path}: بلا بصمة integrity في ملف القفل.`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `✓ ${Object.keys(declared).length} مكتبة معتمدة، و${Object.keys(lock.packages).length - 1} في ملف القفل كلها من registry.npmjs.org ببصمتها.`,
);
