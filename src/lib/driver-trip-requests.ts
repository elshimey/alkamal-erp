import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { lockWaybill } from "@/lib/waybills";
import { saveDataUrl } from "@/lib/attachments";
import { driverName, notifyOffice } from "@/lib/office-notify";
import { notifyDriver } from "@/lib/driver-notify";
import type { DriverProfile } from "@/lib/driver-app";

// رحلة يبدؤها السائق (قواعد الدورات، القسم 10):
// طلب ← (تحميل وتسليم بصورهما) ← المكتب يحوّله لشحنة جديدة أو يربطه بشحنة موجودة لنفس السائق، أو يرفضه بسبب.
// لا قيد ولا عهدة رحلة قبل التحويل. صورة فاتورة الطرف الأول داخلية لا يراها العميل.

export type TripRequestStatus = (typeof s.tripRequestStatus.enumValues)[number];
export type RequestStage = "loading" | "delivery";
export const REQUEST_NOTE = "رحلة بدأها السائق";

type Geo = { latitude?: number | null; longitude?: number | null };
const geo = (g: Geo) => {
  const ok = (v: number | null | undefined, max: number) => v != null && Number.isFinite(v) && Math.abs(v) <= max;
  return ok(g.latitude, 90) && ok(g.longitude, 180) ? { latitude: g.latitude!.toFixed(6), longitude: g.longitude!.toFixed(6) } : { latitude: null, longitude: null };
};

/** السائق يبدأ رحلة: صورة أو صورتان لفاتورة الطرف الأول، والمركبة من إسناده الحالي، والوقت والموقع تلقائياً. */
export async function startTripRequest(db: Db, driver: DriverProfile, input: Geo & { photos: (string | null | undefined)[]; userId?: number }) {
  if (!driver.vehicle) throw new Error("لا توجد مركبة مسندة لك");
  const photos = input.photos.filter((p): p is string => !!p);
  if (!photos.length) throw new Error("صورة فاتورة الطرف الأول إجبارية");
  if (photos.length > 2) throw new Error("صورتان على الأكثر");
  const req = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(s.driverTripRequests)
      .values({ driverId: driver.id, vehicleId: driver.vehicle!.id, ...geo(input), createdBy: input.userId ?? null })
      .returning();
    for (const p of photos) await saveDataUrl(tx, { entity: "driver_trip_requests", entityId: r.id, kind: "first_party_invoice", dataUrl: p, userId: input.userId });
    return r;
  });
  await notifyOffice(db, { kind: "trip_started", text: `${driver.name} بدأ رحلة جديدة من التطبيق (${driver.vehicle.plate})، بانتظار التحويل لشحنة`, href: `/waybills/driver-requests?open=${req.id}`, driverId: driver.id });
  return req;
}

export async function requestStages(db: Db | Tx, ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(s.driverTripRequestStages).where(inArray(s.driverTripRequestStages.requestId, ids)).orderBy(asc(s.driverTripRequestStages.at), asc(s.driverTripRequestStages.id));
}

/** المرحلة التالية للطلب: التحميل ثم التسليم. */
export const nextRequestStage = (done: string[]): RequestStage | null => (!done.includes("loading") ? "loading" : !done.includes("delivery") ? "delivery" : null);

async function lockRequest(tx: Tx, id: number) {
  const [r] = await tx.select().from(s.driverTripRequests).where(eq(s.driverTripRequests.id, id)).for("update");
  if (!r) throw new Error("الطلب غير موجود");
  return r;
}

async function ownPending(tx: Tx, driverId: number, id: number) {
  const r = await lockRequest(tx, id);
  if (r.driverId !== driverId) throw new Error("هذه الرحلة ليست لك");
  if (r.status !== "pending") throw new Error("حوّل المكتب هذه الرحلة أو أغلقها؛ تابعها من رحلاتك");
  return r;
}

/** طلبات السائق في التطبيق: ما ينتظر المكتب، وما رُفض أو أُلغي في آخر 7 أيام. */
export async function driverTripRequests(db: Db | Tx, driverId: number) {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const rows = await db
    .select()
    .from(s.driverTripRequests)
    .where(and(eq(s.driverTripRequests.driverId, driverId), sql`(${s.driverTripRequests.status} = 'pending' or (${s.driverTripRequests.status} = 'rejected' and ${s.driverTripRequests.decidedAt} >= ${since}::timestamptz))`))
    .orderBy(desc(s.driverTripRequests.requestedAt));
  const stages = await requestStages(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, stages: stages.filter((x) => x.requestId === r.id).map((x) => x.stage) }));
}

export async function driverTripRequest(db: Db | Tx, driverId: number, id: number) {
  const [r] = await db.select().from(s.driverTripRequests).where(and(eq(s.driverTripRequests.id, id), eq(s.driverTripRequests.driverId, driverId)));
  if (!r) throw new Error("هذه الرحلة ليست لك");
  const stages = await requestStages(db, [id]);
  return { ...r, stages, next: r.status === "pending" ? nextRequestStage(stages.map((x) => x.stage)) : null };
}

/** السائق يسجل التحميل أو التسليم قبل أن يحوّل المكتب الطلب، بصورة إجبارية وثانية اختيارية. */
export async function recordRequestStage(db: Db, driver: DriverProfile, id: number, stage: RequestStage, input: Geo & { odometer?: number | null; photos: (string | null | undefined)[]; userId?: number }) {
  const photos = input.photos.filter((p): p is string => !!p);
  if (!photos.length) throw new Error("الصورة إجبارية");
  await db.transaction(async (tx) => {
    await ownPending(tx, driver.id, id);
    const done = (await requestStages(tx, [id])).map((x) => x.stage);
    if (nextRequestStage(done) !== stage) throw new Error("هذه المرحلة غير متاحة الآن");
    await tx.insert(s.driverTripRequestStages).values({ requestId: id, stage, odometer: input.odometer ?? null, ...geo(input), createdBy: input.userId ?? null });
    for (const p of photos) await saveDataUrl(tx, { entity: "driver_trip_requests", entityId: id, kind: stage === "delivery" ? "pod" : "other", dataUrl: p, userId: input.userId });
  });
  await notifyOffice(db, {
    kind: "request_stage",
    text: `${driver.name} ${stage === "delivery" ? "سلّم" : "حمّل"} الرحلة التي بدأها من التطبيق، وما زالت بانتظار التحويل لشحنة`,
    href: `/waybills/driver-requests?open=${id}`,
    driverId: driver.id,
  });
}

/** التراجع عن آخر مرحلة سجّلها السائق في طلب لم يُحوَّل بعد (صورها تبقى للمكتب). */
export async function undoRequestStage(db: Db, driverId: number, id: number) {
  await db.transaction(async (tx) => {
    await ownPending(tx, driverId, id);
    const last = (await requestStages(tx, [id])).at(-1);
    if (!last) throw new Error("لا توجد مرحلة للتراجع عنها");
    await tx.delete(s.driverTripRequestStages).where(eq(s.driverTripRequestStages.id, last.id));
  });
}

/** السائق يلغي طلباً بدأه بالخطأ ما دام لم يُحوَّل. */
export async function cancelTripRequest(db: Db, driverId: number, id: number) {
  await db.transaction(async (tx) => {
    await ownPending(tx, driverId, id);
    await tx.update(s.driverTripRequests).set({ status: "cancelled", decidedAt: new Date() }).where(eq(s.driverTripRequests.id, id));
  });
}

// ───────────── المكتب ─────────────

/** طلبات الرحلات للمكتب مع السائق والمركبة والمراحل والصور، وأعداد كل حالة. */
export async function listTripRequests(db: Db | Tx, f: { status?: TripRequestStatus } = {}, limit = 200) {
  const rows = await db
    .select({ r: s.driverTripRequests, driver: s.employees.nameAr, plate: s.vehicles.plate, waybillNumber: s.waybills.number })
    .from(s.driverTripRequests)
    .innerJoin(s.drivers, eq(s.drivers.id, s.driverTripRequests.driverId))
    .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.driverTripRequests.vehicleId))
    .leftJoin(s.waybills, eq(s.waybills.id, s.driverTripRequests.waybillId))
    .where(f.status ? eq(s.driverTripRequests.status, f.status) : undefined)
    .orderBy(desc(s.driverTripRequests.requestedAt), desc(s.driverTripRequests.id))
    .limit(limit);
  const ids = rows.map((x) => x.r.id);
  const [stages, counts] = await Promise.all([
    requestStages(db, ids),
    db.select({ status: s.driverTripRequests.status, n: sql<number>`count(*)::int` }).from(s.driverTripRequests).groupBy(s.driverTripRequests.status),
  ]);
  return {
    rows: rows.map((x) => ({ ...x, stages: stages.filter((st) => st.requestId === x.r.id) })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<TripRequestStatus, number>>,
  };
}

export async function pendingTripRequestsCount(db: Db | Tx) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.driverTripRequests).where(eq(s.driverTripRequests.status, "pending"));
  return r.n;
}

/** شحنات يمكن ربط الطلب بها: لنفس السائق والمركبة، قبل الاعتماد، ولم يسجل السائق عليها مراحل بعد. */
export async function linkableWaybills(db: Db | Tx, requestId: number) {
  const [r] = await db.select().from(s.driverTripRequests).where(eq(s.driverTripRequests.id, requestId));
  if (!r) return [];
  return db
    .select({ id: s.waybills.id, number: s.waybills.number, date: s.waybills.waybillDate, customer: s.parties.nameAr, status: s.waybills.status })
    .from(s.waybills)
    .innerJoin(s.parties, eq(s.parties.id, s.waybills.customerId))
    .where(
      and(
        eq(s.waybills.driverId, r.driverId),
        eq(s.waybills.vehicleId, r.vehicleId),
        inArray(s.waybills.status, ["draft", "in_transit", "delivered"]),
        gte(s.waybills.waybillDate, new Date(r.requestedAt.getTime() - 30 * 86400_000).toISOString().slice(0, 10)),
        sql`not exists (select 1 from trip_stages ts join drivers dr on dr.user_id = ts.created_by where ts.waybill_id = ${s.waybills.id} and dr.id = ${r.driverId})`,
        sql`not exists (select 1 from driver_trip_requests q where q.waybill_id = ${s.waybills.id})`,
      ),
    )
    .orderBy(desc(s.waybills.waybillDate), desc(s.waybills.id))
    .limit(50);
}

/**
 * تحويل الطلب إلى شحنة (منشأة للتو في نفس المعاملة، أو موجودة لنفس السائق والمركبة):
 * تنتقل المراحل بأوقاتها وعداداتها والصور كلها، وتُكتب ملاحظة «رحلة بدأها السائق»،
 * وتظهر الشحنة في تطبيق السائق ليكمل منها. لا قيد هنا؛ القيد عند الاعتماد كأي شحنة.
 */
export async function convertTripRequestTx(tx: Tx, requestId: number, waybillId: number, userId?: number) {
  const r = await lockRequest(tx, requestId);
  if (r.status !== "pending") throw new Error("الطلب محوّل أو مغلق مسبقاً");
  const w = await lockWaybill(tx, waybillId);
  if (w.driverId !== r.driverId) throw new Error(`الشحنة ${w.number} لسائق آخر`);
  if (w.vehicleId !== r.vehicleId) throw new Error(`مركبة الشحنة ${w.number} غير مركبة الطلب؛ صحّح المركبة في الشحنة أولاً`);
  if (!["draft", "in_transit", "delivered"].includes(w.status)) throw new Error(`الشحنة ${w.number} معتمدة أو مرفوضة؛ لا تُربط بطلب`);
  const [other] = await tx.select({ id: s.driverTripRequests.id }).from(s.driverTripRequests).where(eq(s.driverTripRequests.waybillId, waybillId));
  if (other) throw new Error(`الشحنة ${w.number} مربوطة بطلب آخر`);
  const driverStage = await tx.execute(sql`select 1 from trip_stages ts join drivers dr on dr.user_id = ts.created_by where ts.waybill_id = ${waybillId} and dr.id = ${r.driverId} limit 1`);
  if ([...driverStage].length) throw new Error(`السائق سجّل مراحل على الشحنة ${w.number}؛ فهي رحلة أخرى`);

  const stages = await requestStages(tx, [requestId]);
  if (stages.length) {
    await tx.insert(s.tripStages).values(stages.map((x) => ({ waybillId, stage: x.stage, at: x.at, latitude: x.latitude, longitude: x.longitude, odometer: x.odometer, createdBy: x.createdBy })));
  }
  const loading = stages.find((x) => x.stage === "loading");
  const delivery = stages.find((x) => x.stage === "delivery");
  const notes = w.notes?.includes(REQUEST_NOTE) ? w.notes : [REQUEST_NOTE, w.notes].filter(Boolean).join(" · ");
  await tx
    .update(s.waybills)
    .set({
      status: delivery ? "delivered" : loading && w.status === "draft" ? "in_transit" : w.status,
      odometerStart: loading?.odometer ?? w.odometerStart,
      odometerEnd: delivery?.odometer ?? w.odometerEnd,
      notes,
      // تظهر في تطبيق السائق كرحلة استلمها؛ العهدة تبقى كما في الشحنة (لا عهدة رحلة قبل التحويل)
      sentToDriverAt: w.sentToDriverAt ?? new Date(),
      driverAcceptedAt: w.driverAcceptedAt ?? r.requestedAt,
      updatedAt: new Date(),
    })
    .where(eq(s.waybills.id, waybillId));
  await tx.update(s.attachments).set({ entity: "waybills", entityId: waybillId }).where(and(eq(s.attachments.entity, "driver_trip_requests"), eq(s.attachments.entityId, requestId)));
  await tx.update(s.driverTripRequests).set({ status: "converted", waybillId, decidedBy: userId ?? null, decidedAt: new Date() }).where(eq(s.driverTripRequests.id, requestId));
  await notifyDriver(tx, r.driverId, { kind: "request_accepted", body: w.number, href: `/driver/trips/${waybillId}` });
  return w;
}

export async function linkTripRequest(db: Db, requestId: number, waybillId: number, userId?: number) {
  return db.transaction((tx) => convertTripRequestTx(tx, requestId, waybillId, userId));
}

/** رفض الطلب بسبب يصل للسائق. */
export async function rejectTripRequest(db: Db, requestId: number, reason: string, userId?: number) {
  if (!reason.trim()) throw new Error("اكتب سبب الرفض");
  await db.transaction(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (r.status !== "pending") throw new Error("الطلب محوّل أو مغلق مسبقاً");
    await tx.update(s.driverTripRequests).set({ status: "rejected", rejectionReason: reason.trim(), decidedBy: userId ?? null, decidedAt: new Date() }).where(eq(s.driverTripRequests.id, requestId));
    await notifyDriver(tx, r.driverId, { kind: "request_rejected", body: reason.trim(), href: `/driver/requests/${requestId}` });
  });
}

/** بيانات تعبئة نافذة الشحنة الجديدة من الطلب. */
export async function requestPrefill(db: Db | Tx, requestId: number) {
  const [r] = await db.select().from(s.driverTripRequests).where(eq(s.driverTripRequests.id, requestId));
  if (!r || r.status !== "pending") return null;
  const date = r.requestedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  return { id: r.id, date, vehicleId: r.vehicleId, driverId: r.driverId, driver: await driverName(db, r.driverId) };
}
