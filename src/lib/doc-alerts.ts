import { and, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as s from "@/db/schema";
import { daysBetween } from "@/lib/dates";
import { ALERT_OWNER_KINDS, currentDocuments } from "@/lib/documents";
import { notifyOffice, type OfficeKind } from "@/lib/office-notify";
import { notifyDriver } from "@/lib/driver-notify";

// تنبيه انتهاء الوثائق اليومي (قرار أحمد 2026-11-19): إشعار فوري للمكتب وللسائق عن وثائقنا الداخلية
// مرة عند 30 يوماً، ومرة عند 7 أيام، ويوم الانتهاء، ثم كل أسبوع حتى تُجدَّد. يعمل مرة في اليوم لكل شركة.

export const PUSH_STAGES = [30, 7] as const;

/** مرحلة الإشعار الحالية: "30" أو "7" قبل الانتهاء، ثم x0 يوم الانتهاء (وأسبوعه)، x1 بعد أسبوع، وهكذا. */
export function pushStage(expiryDate: string | null, today: string): string | null {
  if (!expiryDate) return null;
  const left = daysBetween(today, expiryDate);
  if (left > PUSH_STAGES[0]) return null;
  if (left > PUSH_STAGES[1]) return String(PUSH_STAGES[0]);
  if (left > 0) return String(PUSH_STAGES[1]);
  return `x${Math.floor(-left / 7)}`;
}

/** عدد الأيام بالعربية الصحيحة: يوم واحد، يومين، 5 أيام، 22 يوماً. */
export function days(n: number) {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومين";
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

/** «تنتهي بعد 5 أيام» أو «تنتهي اليوم» أو «منتهية منذ 3 أيام». */
export function leftText(expiryDate: string, today: string) {
  const left = daysBetween(today, expiryDate);
  if (left > 0) return `تنتهي بعد ${days(left)}`;
  if (left === 0) return "تنتهي اليوم";
  return `منتهية منذ ${days(-left)}`;
}

/** صاحب الوثيقة باختصار: اللوحة للمركبة والمقطورة، والاسم للسائق والموظف، و«الشركة». */
export function ownerShort(kind: string, owner: string) {
  return kind === "company" ? "الشركة" : owner;
}

const OFFICE_KIND: Record<string, OfficeKind> = { vehicle: "doc_expiring", trailer: "doc_expiring", driver: "doc_expiring", employee: "doc_expiring_hr", company: "doc_expiring_company" };
const HREF: Record<OfficeKind | string, string> = { doc_expiring: "/fleet-documents", doc_expiring_hr: "/fleet-documents", doc_expiring_company: "/fleet-documents/owner/company-0" };

function joinLines(items: string[], max = 300) {
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const next = out ? `${out}، ${items[i]}` : items[i];
    if (next.length > max - 20) return `${out}، و${items.length - i} غيرها`;
    out = next;
  }
  return out;
}

/**
 * يرسل مراحل التنبيه المستحقة اليوم ولم تُرسل بعد. يعيد أرقام الإشعارات المحفوظة ليرسلها المستدعي فوراً.
 * آمن للتكرار: المرحلة تُسجَّل مرة واحدة لكل وثيقة (المفتاح الأساسي)، فلا يتكرر إشعار ولو عمل مرتين.
 */
export async function sendDocumentAlerts(db: Db, today: string) {
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + PUSH_STAGES[0]);
  const rows = (await currentDocuments(db, { expiringBy: until.toISOString().slice(0, 10) })).filter((r) => ALERT_OWNER_KINDS.includes(r.type.ownerKind) && r.doc.expiryDate);
  const due = rows.map((r) => ({ r, stage: pushStage(r.doc.expiryDate, today) })).filter((x): x is { r: (typeof rows)[number]; stage: string } => !!x.stage);
  if (!due.length) return { office: [] as number[], driver: [] as number[], documents: 0 };

  // تُسجَّل المراحل أولاً؛ ما سجّلته عملية أخرى قبلنا لا يعود هنا فلا يُرسل مرتين
  const inserted = await db
    .insert(s.documentAlertSends)
    .values(due.map((x) => ({ documentId: x.r.doc.id, stage: x.stage })))
    .onConflictDoNothing()
    .returning({ documentId: s.documentAlertSends.documentId });
  const fresh = new Set(inserted.map((x) => x.documentId));
  const items = due.filter((x) => fresh.has(x.r.doc.id)).map(({ r }) => {
    const kind = r.type.ownerKind;
    return { r, kind, line: `${r.type.nameAr} (${ownerShort(kind, r.owner)}) ${leftText(r.doc.expiryDate!, today)}` };
  });
  if (!items.length) return { office: [], driver: [], documents: 0 };

  // المكتب: إشعار واحد لكل جهة صلاحية يجمع وثائق اليوم، الأقرب انتهاءً أولاً
  const office: number[] = [];
  const byKind = new Map<OfficeKind, typeof items>();
  for (const it of items) byKind.set(OFFICE_KIND[it.kind], [...(byKind.get(OFFICE_KIND[it.kind]) ?? []), it]);
  for (const [kind, list] of byKind) {
    const text = list.length === 1 ? list[0].line : `${list.length} وثائق تحتاج تجديداً: ${joinLines(list.map((x) => x.line))}`;
    office.push(await notifyOffice(db, { kind, text, href: HREF[kind] }, { push: false }));
  }

  // السائق: وثائقه ووثائق مركبته المسندة له الآن
  const vehicleIds = [...new Set(items.filter((x) => x.kind === "vehicle" || x.kind === "trailer").map((x) => x.r.doc.vehicleId!))];
  const assigned = vehicleIds.length
    ? await db
        .select({ vehicleId: s.vehicleAssignments.vehicleId, driverId: s.vehicleAssignments.driverId })
        .from(s.vehicleAssignments)
        .where(and(inArray(s.vehicleAssignments.vehicleId, vehicleIds), isNull(s.vehicleAssignments.toDate)))
    : [];
  const driverOfVehicle = new Map(assigned.map((a) => [a.vehicleId, a.driverId]));
  const byDriver = new Map<number, string[]>();
  for (const it of items) {
    const driverId = it.kind === "driver" ? it.r.doc.driverId : it.kind === "vehicle" || it.kind === "trailer" ? driverOfVehicle.get(it.r.doc.vehicleId!) : undefined;
    if (!driverId) continue;
    const label = it.kind === "driver" ? it.r.type.nameAr : `${it.r.type.nameAr} (${it.r.owner})`;
    byDriver.set(driverId, [...(byDriver.get(driverId) ?? []), `${label}: ${it.r.doc.expiryDate}`]);
  }
  const driver: number[] = [];
  for (const [driverId, lines] of byDriver) {
    const id = await notifyDriver(db, driverId, { kind: "doc_expiring", body: joinLines(lines), href: "/driver/documents" }, { push: false });
    if (id) driver.push(id);
  }
  return { office, driver, documents: items.length };
}

/** يحجز مهمة اليوم: true لأول من يطلبها في هذا اليوم فقط. */
export async function claimDailyJob(db: Db, job: string, today: string) {
  const r = await db.execute<{ job: string }>(sql`
    insert into daily_jobs (job, last_date) values (${job}, ${today}::date)
    on conflict (job) do update set last_date = excluded.last_date where daily_jobs.last_date < excluded.last_date
    returning job`);
  return [...r].length > 0;
}

/**
 * يُستدعى من الجرس ونبض تطبيق السائق: أول استخدام للبرنامج في اليوم يشغّل تنبيه الوثائق بعد انتهاء الطلب،
 * فلا يتأخر المستخدم ولا يحتاج البرنامج جدولة خارجية.
 */
const checked = new Map<string, string>(); // شركة ← آخر يوم فُحص في هذه النسخة من الخادم، فلا يُسأل الجدول كل 15 ثانية

export async function scheduleDailyDocumentAlerts(today: string) {
  try {
    const [{ after }, { currentSchema, runInTenant }] = await Promise.all([import("next/server"), import("@/db/tenant")]);
    const schema = await currentSchema();
    if (checked.get(schema) === today) return;
    checked.set(schema, today);
    after(async () => {
      try {
        const [{ db }, { deliverPush }] = await Promise.all([import("@/db"), import("@/lib/push")]);
        await runInTenant(schema, async () => {
          if (await claimDailyJob(db, "doc_alerts", today)) {
            const sent = await sendDocumentAlerts(db, today);
            await Promise.all([...sent.office.map((id) => deliverPush(db, { kind: "office", id })), ...sent.driver.map((id) => deliverPush(db, { kind: "driver", id }))]);
          }
          // جدول أقساط الدائنين: قيد تكلفة التمويل المستحقة اليوم وإشعار الأقساط
          if (await claimDailyJob(db, "installments", today)) {
            const { runDailyInstallments } = await import("@/lib/installments");
            const { sent } = await runDailyInstallments(db, today);
            await Promise.all(sent.office.map((id) => deliverPush(db, { kind: "office", id })));
          }
        });
      } catch (e) {
        console.error("doc alerts failed", e);
      }
    });
  } catch {
    // خارج طلب ويب
  }
}
