import { db } from "@/db";
import { ensureAdminUser, seedReferenceData } from "@/lib/seed";

async function main() {
  await seedReferenceData(db);
  console.log("✓ العملات، شجرة الحسابات، رموز الضريبة، الفترات، الأدوار الأساسية");

  const login = process.env.ADMIN_LOGIN || "admin";
  const result = await ensureAdminUser(db, login, process.env.ADMIN_PASSWORD || undefined);
  if (result.created) {
    console.log(`✓ أُنشئ مدير النظام: ${login}`);
    if (result.generatedPassword) {
      console.log(`  كلمة المرور المؤقتة (تظهر مرة واحدة، غيّرها بعد الدخول): ${result.generatedPassword}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
