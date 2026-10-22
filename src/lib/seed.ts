import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { CHART_OF_ACCOUNTS } from "@/data/chart-of-accounts";
import { CORE_ROLES } from "@/lib/permissions";
import { hashPassword } from "@/lib/password";

// التهيئة آمنة للتكرار: تضيف الناقص ولا تمس ما عدّله المستخدم،
// إلا صلاحيات الأدوار الأساسية فتُعاد لما في الكود.

const VEHICLE_TYPES = ["رأس تريلا", "سطحة", "ستارة", "براد", "لوبد"];

export async function seedReferenceData(db: Db, year = new Date().getFullYear()) {
  await db
    .insert(s.currencies)
    .values([
      { code: "SAR", nameAr: "ريال سعودي", decimals: 2, isBase: true },
      { code: "KWD", nameAr: "دينار كويتي", decimals: 3, isBase: false },
    ])
    .onConflictDoNothing();

  // شجرة الحسابات: إدراج ثم ربط الآباء بالرمز
  await db
    .insert(s.accounts)
    .values(
      CHART_OF_ACCOUNTS.map((a) => ({
        code: a.code,
        nameAr: a.nameAr,
        level: a.level,
        type: a.type,
        normalBalance: a.normalBalance,
        isPostable: a.isPostable,
        requiresCostCenter: a.requiresCostCenter,
        currencyCode: a.currency ?? null,
        note: a.note ?? null,
        isSystem: true,
      })),
    )
    .onConflictDoNothing({ target: s.accounts.code });
  await db.execute(sql`
    update accounts c set parent_id = p.id
    from accounts p
    where c.parent_id is null and c.level > 1
      and p.code = case when c.level = 2 then left(c.code, 1) else left(c.code, length(c.code) - 2) end
  `);

  const byCode = new Map(
    (await db.select({ id: s.accounts.id, code: s.accounts.code }).from(s.accounts)).map((a) => [a.code, a.id]),
  );
  await db
    .insert(s.taxCodes)
    .values([
      { code: "VAT15-OUT", nameAr: "ضريبة مخرجات 15%", kind: "output", rate: "15", accountId: byCode.get("2109") },
      { code: "VAT15-IN", nameAr: "ضريبة مدخلات 15%", kind: "input", rate: "15", accountId: byCode.get("1108") },
      { code: "ZERO", nameAr: "نسبة صفر (نقل دولي)", kind: "zero_rated", rate: "0", accountId: byCode.get("2109") },
      { code: "EXEMPT", nameAr: "معفى", kind: "exempt", rate: "0" },
    ])
    .onConflictDoNothing({ target: s.taxCodes.code });

  await db
    .insert(s.costCenters)
    .values([
      { code: "ADM", nameAr: "الإدارة العامة", type: "admin" },
      { code: "WS", nameAr: "الورشة", type: "workshop" },
      // تكاليف شحنات الناقلين الخارجيين (لا مركبة لها من أسطولنا)
      { code: "EXT", nameAr: "الناقلون الخارجيون", type: "other" },
    ])
    .onConflictDoNothing({ target: s.costCenters.code });

  await db
    .insert(s.vehicleTypes)
    .values(VEHICLE_TYPES.map((nameAr) => ({ nameAr })))
    .onConflictDoNothing({ target: s.vehicleTypes.nameAr });

  await db
    .insert(s.fiscalPeriods)
    .values(
      Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const mm = String(month).padStart(2, "0");
        return { year, month, startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-${last}` };
      }),
    )
    .onConflictDoNothing();

  await db
    .insert(s.locations)
    .values([
      { level: "country", nameAr: "السعودية", countryCode: "SA" },
      { level: "country", nameAr: "الكويت", countryCode: "KW" },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.chargeTypes)
    .values(
      ["انتظار", "تحميل", "تخليص", "مبيت", "أخرى"].map((nameAr) => ({
        nameAr,
        revenueAccountId: byCode.get("4103"),
        costAccountId: byCode.get("5104"),
      })),
    )
    .onConflictDoNothing({ target: s.chargeTypes.nameAr });

  await seedCoreRoles(db);
}

export async function seedCoreRoles(db: Db) {
  for (const role of CORE_ROLES) {
    const [row] = await db
      .insert(s.roles)
      .values({ key: role.key, nameAr: role.nameAr, description: role.description, isSystem: true })
      .onConflictDoUpdate({
        target: s.roles.key,
        set: { nameAr: role.nameAr, description: role.description, isSystem: true },
      })
      .returning({ id: s.roles.id });
    await db.delete(s.rolePermissions).where(eq(s.rolePermissions.roleId, row.id));
    if (role.permissions.length) {
      await db.insert(s.rolePermissions).values(role.permissions.map((p) => ({ ...p, roleId: row.id })));
    }
  }
}

/** ينشئ مدير النظام الأول إن لم يوجد. يُرجع كلمة المرور المولّدة إن وُلّدت. */
export async function ensureAdminUser(db: Db, login: string, password?: string) {
  const [adminRole] = await db.select().from(s.roles).where(eq(s.roles.key, "admin"));
  const existing = await db
    .select({ id: s.userRoles.userId })
    .from(s.userRoles)
    .innerJoin(s.users, eq(s.users.id, s.userRoles.userId))
    .where(and(eq(s.userRoles.roleId, adminRole.id), eq(s.users.isActive, true)));
  if (existing.length) return { created: false as const };

  const taken = await db.select({ id: s.users.id }).from(s.users).where(inArray(s.users.login, [login]));
  if (taken.length) throw new Error(`اسم الدخول ${login} مستخدم لحساب ليس مدير نظام`);

  const generated = password ? undefined : randomBytes(9).toString("base64url");
  const [user] = await db
    .insert(s.users)
    .values({ name: "مدير النظام", login, passwordHash: await hashPassword(password ?? generated!) })
    .returning({ id: s.users.id });
  await db.insert(s.userRoles).values({ userId: user.id, roleId: adminRole.id });
  return { created: true as const, generatedPassword: generated };
}
