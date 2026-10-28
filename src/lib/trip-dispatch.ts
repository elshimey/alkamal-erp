import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { createPayment, deletePayment, revertPayment } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { notifyDriver } from "@/lib/driver-notify";

// الإرسال للسائق: تظهر الرحلة في تطبيقه، وتُصرف عهدتها (إن وُجدت) بسند عهدة مرحّل على حسابه.
// إلغاء الإرسال يسحبها من التطبيق ويعكس سند العهدة، ما دام السائق لم يسجّل عليها شيئاً.

const STAGE_LABEL: Record<string, string> = { loading: "تحميل", in_transit: "في الطريق", border: "منفذ", delivery: "تسليم" };

/** ما سجّله السائق على الرحلة (مراحل ومصاريف)؛ فارغ = يمكن سحبها منه. */
export async function driverActivity(db: Db | Tx, waybillId: number) {
  const [stages, expenses] = await Promise.all([
    db.select({ stage: s.tripStages.stage }).from(s.tripStages).where(eq(s.tripStages.waybillId, waybillId)),
    db
      .select({ number: s.expenses.number })
      .from(s.expenses)
      .where(and(eq(s.expenses.waybillId, waybillId), notInArray(s.expenses.status, ["rejected", "voided"]))),
  ]);
  return [...stages.map((x) => STAGE_LABEL[x.stage] ?? x.stage), ...expenses.map((e) => `مصروف ${e.number}`)];
}

export interface SendOptions {
  // الصندوق أو البنك الذي تُصرف منه عهدة الرحلة
  cashAccountId?: number | null;
  date?: string;
  userId?: number;
}

/** إرسال شحنة واحدة للسائق مع صرف عهدتها. */
export async function sendTrip(db: Db, id: number, opts: SendOptions = {}) {
  const [w] = await db
    .select({ w: s.waybills, mobile: s.drivers.mobile, driver: s.employees.nameAr })
    .from(s.waybills)
    .leftJoin(s.drivers, eq(s.drivers.id, s.waybills.driverId))
    .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .where(eq(s.waybills.id, id));
  if (!w) throw new Error("الشحنة غير موجودة");
  const t = w.w;
  if (t.execution !== "fleet" || !t.driverId) throw new Error(`${t.number}: منفذة بناقل خارجي؛ لا يوجد سائق في التطبيق`);
  if (t.sentToDriverAt) throw new Error(`${t.number}: أُرسلت للسائق من قبل`);
  if (t.status === "rejected") throw new Error(`${t.number}: مرفوضة`);
  if (t.status === "approved" || t.status === "invoiced") throw new Error(`${t.number}: معتمدة؛ انتهت رحلتها`);
  const custody = Number(t.tripCustody);
  let paymentId: number | null = null;
  let paymentNumber: string | null = null;
  if (custody > 0) {
    if (!opts.cashAccountId) throw new Error(`${t.number}: اختر الصندوق أو البنك الذي تُصرف منه عهدة الرحلة`);
    const [acc] = await db.select({ code: s.accounts.code }).from(s.accounts).where(eq(s.accounts.id, opts.cashAccountId));
    const p = await createPayment(db, {
      paymentDate: opts.date ?? todayRiyadh(),
      kind: "custody",
      driverId: t.driverId,
      amount: custody,
      method: acc?.code.startsWith("1102") ? "transfer" : "cash",
      cashAccountId: opts.cashAccountId,
      reference: t.number,
      notes: `عهدة رحلة الشحنة ${t.number}`,
      post: true,
      userId: opts.userId,
    });
    paymentId = p.id;
    paymentNumber = p.number;
  }
  try {
    await db.update(s.waybills).set({ sentToDriverAt: new Date(), driverAcceptedAt: null, custodyPaymentId: paymentId, updatedAt: new Date() }).where(eq(s.waybills.id, id));
  } catch (err) {
    if (paymentId) await dropPayment(db, paymentId, "تعذّر إرسال الرحلة");
    throw err;
  }
  await notifyDriver(db, t.driverId, { kind: "trip_sent", body: custody > 0 ? `${t.number} · ${custody}` : t.number, href: `/driver/trips/${id}` });
  return { number: t.number, driver: w.driver, mobile: w.mobile, custody, paymentNumber };
}

async function dropPayment(db: Db, id: number, reason: string, userId?: number) {
  const [p] = await db.select({ status: s.payments.status }).from(s.payments).where(eq(s.payments.id, id));
  if (!p) return;
  if (p.status === "posted") await revertPayment(db, id);
  await deletePayment(db, id, { reason, userId });
}

/** إلغاء الإرسال: يُسحب من التطبيق ويُعكس سند عهدته؛ يُرفض إن سجّل السائق شيئاً عليها. */
export async function unsendTrip(db: Db, id: number, userId?: number) {
  const [t] = await db.select().from(s.waybills).where(eq(s.waybills.id, id));
  if (!t) throw new Error("الشحنة غير موجودة");
  if (!t.sentToDriverAt) throw new Error(`${t.number}: لم تُرسل للسائق`);
  const acts = await driverActivity(db, id);
  if (acts.length)
    throw new Error(`${t.number}: سجّل السائق عليها (${acts.join("، ")})؛ لا يُلغى الإرسال حتى يتراجع عنها السائق أو تُرفض مصاريفه`);
  if (t.status === "approved" || t.status === "invoiced") throw new Error(`${t.number}: معتمدة؛ انتهت رحلتها`);
  await db.update(s.waybills).set({ sentToDriverAt: null, driverAcceptedAt: null, custodyPaymentId: null, updatedAt: new Date() }).where(eq(s.waybills.id, id));
  if (t.custodyPaymentId) await dropPayment(db, t.custodyPaymentId, `إلغاء إرسال الرحلة ${t.number}`, userId);
  await notifyDriver(db, t.driverId, { kind: "trip_unsent", body: t.number, href: "/driver" });
  return { number: t.number };
}

/** إرسال أو إلغاء عدة شحنات: ما لا يصلح يُذكر برقمه ولا يمنع الباقي. */
export async function bulkTrips(db: Db, ids: number[], op: "send" | "unsend", opts: SendOptions = {}) {
  const done: string[] = [];
  const skipped: string[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const r = op === "send" ? await sendTrip(db, id, opts) : await unsendTrip(db, id, opts.userId);
      done.push(r.number);
    } catch (err) {
      skipped.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { done, skipped };
}

/** رحلات الفواتير: الشحنات المدمجة فيها ورحلة الفاتورة المباشرة. */
export async function invoiceTripIds(db: Db | Tx, invoiceIds: number[]) {
  if (!invoiceIds.length) return [];
  const rows = await db
    .select({ id: s.waybills.id })
    .from(s.waybills)
    .where(
      sql`${s.waybills.execution} = 'fleet' and (${inArray(s.waybills.sourceInvoiceId, invoiceIds)} or ${s.waybills.id} in (select waybill_id from sales_invoice_lines where kind = 'waybill' and ${inArray(s.salesInvoiceLines.invoiceId, invoiceIds)}))`,
    );
  return rows.map((r) => r.id);
}
