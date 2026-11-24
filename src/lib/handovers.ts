import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { assignVehicle, handoverVehicle, releaseAssignment } from "@/lib/fleet";
import { nextDocumentNumber } from "@/lib/ledger";

// محضر استلام وتسليم المركبة (طلب أحمد 2026-11-24): مستند عهدة يُطبع ويوقّعه السائق.
// النوع يحدد ما يحدث للإسناد: استلام يفتحه، تسليم للشركة يغلقه، لسائق آخر يغلقه ويفتح غيره.

export type HandoverKind = s.HandoverKind;
export { CONDITION, DEFAULT_HANDOVER_ITEMS, FUEL_LEVEL, HANDOVER_KIND, type FuelLevel } from "@/data/handovers";
import { DEFAULT_HANDOVER_ITEMS, type FuelLevel } from "@/data/handovers";

export interface HandoverItemInput {
  name: string;
  qty?: number | null;
  condition?: string | null;
}

export interface HandoverInput {
  kind: HandoverKind;
  /** الاستلام: المركبة؛ التسليم وللسائق الآخر: الإسناد المفتوح */
  vehicleId?: number | null;
  assignmentId?: number | null;
  driverId?: number | null;
  date: string;
  odometer?: number | null;
  fuelLevel?: FuelLevel | null;
  condition?: "good" | "notes" | null;
  companyRep?: string | null;
  notes?: string | null;
  items?: HandoverItemInput[];
  userId?: number;
}

/** يفحص بنود العدد والأدوات: الصنف الفارغ يُترك، والعدد صحيح موجب. */
export function cleanHandoverItems(items: HandoverItemInput[] = []) {
  const out: { name: string; qty: number; condition: string | null }[] = [];
  items.forEach((it, i) => {
    const name = it.name?.trim();
    if (!name) return;
    const qty = it.qty == null || Number.isNaN(Number(it.qty)) ? 1 : Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`العدد في سطر «${name}» (${i + 1}) يجب أن يكون رقماً صحيحاً أكبر من صفر`);
    out.push({ name, qty, condition: it.condition?.trim() || null });
  });
  return out;
}

/**
 * يسجل المحضر وأثره على الإسناد في معاملة واحدة: استلام = إسناد جديد، تسليم للشركة = إغلاق الإسناد،
 * لسائق آخر = إغلاق وفتح بنفس التاريخ والعداد. الوثائق المانعة المنتهية تمنع كما في الإسناد.
 */
export async function createHandover(db: Db | Tx, input: HandoverInput, opts: { canOverride?: boolean; overrideReason?: string | null } = {}) {
  const items = cleanHandoverItems(input.items);
  const notes = input.notes?.trim() || null;
  return db.transaction(async (tx) => {
    let vehicleId: number;
    let fromDriverId: number | null = null;
    let toDriverId: number | null = null;
    let assignmentId: number | null = null;
    let closedAssignmentId: number | null = null;
    let odometer = input.odometer ?? null;

    if (input.kind === "receive") {
      if (!input.vehicleId) throw new Error("اختر المركبة");
      if (!input.driverId) throw new Error("اختر السائق المستلم");
      const row = await assignVehicle(
        tx,
        { vehicleId: input.vehicleId, driverId: input.driverId, fromDate: input.date, odometerStart: odometer, notes, userId: input.userId },
        opts,
      );
      vehicleId = row.vehicleId;
      toDriverId = row.driverId;
      assignmentId = row.id;
      odometer = row.odometerStart;
    } else {
      if (!input.assignmentId) throw new Error("اختر المركبة المسندة");
      const [a] = await tx.select().from(s.vehicleAssignments).where(eq(s.vehicleAssignments.id, input.assignmentId));
      if (!a) throw new Error("الإسناد غير موجود");
      if (a.toDate) throw new Error("سُجّل تسليم هذه المركبة مسبقاً");
      vehicleId = a.vehicleId;
      fromDriverId = a.driverId;
      closedAssignmentId = a.id;
      if (input.kind === "return") {
        await releaseAssignment(tx, { assignmentId: a.id, toDate: input.date, odometerEnd: odometer, notes });
      } else {
        if (!input.driverId) throw new Error("اختر السائق الجديد (المستلم)");
        const row = await handoverVehicle(tx, { assignmentId: a.id, driverId: input.driverId, date: input.date, odometer, notes, userId: input.userId }, opts);
        toDriverId = row.driverId;
        assignmentId = row.id;
        odometer = row.odometerStart;
      }
    }

    const number = await nextDocumentNumber(tx, "vehicle_handover", "HO", Number(input.date.slice(0, 4)));
    const [doc] = await tx
      .insert(s.vehicleHandovers)
      .values({
        number,
        kind: input.kind,
        vehicleId,
        fromDriverId,
        toDriverId,
        handoverDate: input.date,
        odometer,
        fuelLevel: input.fuelLevel ?? null,
        condition: input.condition ?? null,
        companyRep: input.companyRep?.trim() || null,
        notes,
        assignmentId,
        closedAssignmentId,
        createdBy: input.userId,
      })
      .returning();
    if (items.length) {
      await tx.insert(s.vehicleHandoverItems).values(items.map((it, i) => ({ handoverId: doc.id, lineNo: i + 1, ...it })));
    }
    return doc;
  });
}

export type HandoverTarget = { docId: number } | { assignmentId: number; side: "opened" | "closed" };

export interface HandoverEditInput {
  /** السائق المستلم (الاستلام ولسائق آخر)؛ فارغ = كما هو */
  driverId?: number | null;
  date: string;
  odometer?: number | null;
  fuelLevel?: FuelLevel | null;
  condition?: "good" | "notes" | null;
  companyRep?: string | null;
  notes?: string | null;
  items?: HandoverItemInput[];
  userId?: number;
}

/**
 * هيكل محضر لإسناد سُجّل قبل المحاضر (أو المحضر الموجود له): «opened» = محضر الاستلام الذي بدأه
 * (لسائق آخر إن انتهى إسناد سابق للمركبة في اليوم نفسه)، و«closed» = محضر التسليم الذي أنهاه
 * (لسائق آخر إن بدأ بعده إسناد للمركبة في اليوم نفسه). لا يغيّر شيئاً.
 */
export async function handoverDraftFor(db: Db | Tx, assignmentId: number, side: "opened" | "closed") {
  const [a] = await db.select().from(s.vehicleAssignments).where(eq(s.vehicleAssignments.id, assignmentId));
  if (!a) throw new Error("الإسناد غير موجود");
  if (side === "closed" && !a.toDate) throw new Error("المركبة ما زالت مسندة؛ سجّل تسليمها أولاً");
  const linked = side === "opened" ? eq(s.vehicleHandovers.assignmentId, a.id) : eq(s.vehicleHandovers.closedAssignmentId, a.id);
  const [existing] = await db.select({ id: s.vehicleHandovers.id }).from(s.vehicleHandovers).where(linked).orderBy(desc(s.vehicleHandovers.id)).limit(1);
  // الطرف الآخر في التسليم لسائق آخر: إسناد للمركبة نفسها ينتهي (أو يبدأ) في اليوم نفسه
  const day = side === "opened" ? a.fromDate : a.toDate!;
  const [other] = await db
    .select()
    .from(s.vehicleAssignments)
    .where(
      and(
        eq(s.vehicleAssignments.vehicleId, a.vehicleId),
        ne(s.vehicleAssignments.id, a.id),
        side === "opened" ? eq(s.vehicleAssignments.toDate, day) : eq(s.vehicleAssignments.fromDate, day),
      ),
    )
    .orderBy(desc(s.vehicleAssignments.id))
    .limit(1);
  const opened = side === "opened" ? a : other;
  const closed = side === "closed" ? a : other;
  return {
    existingId: existing?.id ?? null,
    kind: (other ? "transfer" : side === "opened" ? "receive" : "return") as HandoverKind,
    vehicleId: a.vehicleId,
    fromDriverId: closed?.driverId ?? null,
    toDriverId: opened?.driverId ?? null,
    date: day,
    odometer: side === "opened" ? a.odometerStart : (a.odometerEnd ?? other?.odometerStart ?? null),
    assignmentId: opened?.id ?? null,
    closedAssignmentId: closed?.id ?? null,
  };
}

/** يتأكد أن فترة الإسناد بعد التعديل لا تتداخل مع إسناد آخر للمركبة نفسها أو السائق نفسه. */
async function assertNoOverlap(tx: Tx, id: number) {
  const [a] = await tx.select().from(s.vehicleAssignments).where(eq(s.vehicleAssignments.id, id));
  if (!a) return;
  const end = a.toDate ?? "9999-12-31";
  const [clash] = await tx
    .select({ id: s.vehicleAssignments.id, vehicleId: s.vehicleAssignments.vehicleId })
    .from(s.vehicleAssignments)
    .where(
      and(
        ne(s.vehicleAssignments.id, a.id),
        or(eq(s.vehicleAssignments.vehicleId, a.vehicleId), eq(s.vehicleAssignments.driverId, a.driverId)),
        sql`${s.vehicleAssignments.fromDate} < ${end}`,
        sql`coalesce(${s.vehicleAssignments.toDate}, '9999-12-31') > ${a.fromDate}`,
      ),
    )
    .limit(1);
  if (clash) {
    throw new Error(clash.vehicleId === a.vehicleId ? "التاريخ يتداخل مع إسناد آخر لهذه المركبة في السجل" : "التاريخ يتداخل مع إسناد آخر لهذا السائق في السجل");
  }
}

/**
 * تعديل محضر أو إنشاء محضر لإسناد قديم ثم طباعته (طلب أحمد 2026-11-24): التاريخ والعداد يُعدَّلان في
 * الإسناد نفسه (بداية المفتوح ونهاية المغلق)، والسائق المستلم في الإسناد الذي بدأه المحضر، والباقي في المحضر.
 * النوع والمركبة ثابتان. لا يتداخل الإسناد مع غيره بعد التعديل.
 */
export async function saveHandoverEdit(db: Db | Tx, target: HandoverTarget, input: HandoverEditInput) {
  const items = cleanHandoverItems(input.items);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("أدخل التاريخ");
  return db.transaction(async (tx) => {
    let base: {
      existingId: number | null;
      kind: HandoverKind;
      vehicleId: number;
      fromDriverId: number | null;
      toDriverId: number | null;
      assignmentId: number | null;
      closedAssignmentId: number | null;
    };
    if ("docId" in target) {
      const [h] = await tx.select().from(s.vehicleHandovers).where(eq(s.vehicleHandovers.id, target.docId)).for("update");
      if (!h) throw new Error("المحضر غير موجود");
      base = { existingId: h.id, ...h };
    } else {
      base = await handoverDraftFor(tx, target.assignmentId, target.side);
    }
    const odometer = input.odometer ?? null;
    let toDriverId = base.toDriverId;
    if (base.assignmentId) {
      const [a] = await tx.select().from(s.vehicleAssignments).where(eq(s.vehicleAssignments.id, base.assignmentId));
      if (input.driverId && input.driverId !== a.driverId) {
        if (input.driverId === base.fromDriverId) throw new Error("السائق المستلم هو نفسه المسلِّم");
        const [d] = await tx.select({ status: s.drivers.status }).from(s.drivers).where(eq(s.drivers.id, input.driverId));
        if (!d) throw new Error("السائق غير موجود");
        if (!a.toDate) {
          const [busy] = await tx
            .select({ id: s.vehicleAssignments.id })
            .from(s.vehicleAssignments)
            .where(and(eq(s.vehicleAssignments.driverId, input.driverId), sql`${s.vehicleAssignments.toDate} is null`));
          if (busy) throw new Error("السائق مسند لمركبة أخرى؛ سجّل تسليمها أولاً");
        }
        toDriverId = input.driverId;
      }
      if (a.toDate && input.date > a.toDate) throw new Error("تاريخ الاستلام بعد تاريخ تسليم هذا الإسناد");
      await tx
        .update(s.vehicleAssignments)
        .set({ fromDate: input.date, odometerStart: odometer ?? a.odometerStart, driverId: toDriverId ?? a.driverId })
        .where(eq(s.vehicleAssignments.id, a.id));
    }
    if (base.closedAssignmentId) {
      const [c] = await tx.select().from(s.vehicleAssignments).where(eq(s.vehicleAssignments.id, base.closedAssignmentId));
      if (input.date < c.fromDate) throw new Error("تاريخ التسليم قبل تاريخ الاستلام");
      if (odometer != null && c.odometerStart != null && odometer < c.odometerStart) throw new Error(`قراءة العداد أقل من قراءة الاستلام (${c.odometerStart})`);
      await tx
        .update(s.vehicleAssignments)
        .set({ toDate: input.date, odometerEnd: odometer ?? c.odometerEnd })
        .where(eq(s.vehicleAssignments.id, c.id));
    }
    for (const id of [base.assignmentId, base.closedAssignmentId]) if (id) await assertNoOverlap(tx, id);
    if (odometer != null) {
      await tx
        .update(s.vehicles)
        .set({ odometer: sql`greatest(${s.vehicles.odometer}, ${odometer})`, updatedAt: new Date() })
        .where(eq(s.vehicles.id, base.vehicleId));
    }

    const fields = {
      toDriverId,
      handoverDate: input.date,
      odometer,
      fuelLevel: input.fuelLevel ?? null,
      condition: input.condition ?? null,
      companyRep: input.companyRep?.trim() || null,
      notes: input.notes?.trim() || null,
    };
    let docId = base.existingId;
    if (docId) {
      await tx.update(s.vehicleHandovers).set(fields).where(eq(s.vehicleHandovers.id, docId));
      await tx.delete(s.vehicleHandoverItems).where(eq(s.vehicleHandoverItems.handoverId, docId));
    } else {
      const number = await nextDocumentNumber(tx, "vehicle_handover", "HO", Number(input.date.slice(0, 4)));
      const [doc] = await tx
        .insert(s.vehicleHandovers)
        .values({
          number,
          kind: base.kind,
          vehicleId: base.vehicleId,
          fromDriverId: base.fromDriverId,
          assignmentId: base.assignmentId,
          closedAssignmentId: base.closedAssignmentId,
          createdBy: input.userId,
          ...fields,
        })
        .returning();
      docId = doc.id;
    }
    if (items.length) {
      await tx.insert(s.vehicleHandoverItems).values(items.map((it, i) => ({ handoverId: docId!, lineNo: i + 1, ...it })));
    }
    const [doc] = await tx.select().from(s.vehicleHandovers).where(eq(s.vehicleHandovers.id, docId));
    return doc;
  });
}

/** العدد والأدوات التي استلمها السائق مع إسناده الحالي، لتأتي جاهزة عند تسليمه المركبة. */
export async function itemsOfAssignment(db: Db | Tx, assignmentId: number) {
  const [doc] = await db
    .select({ id: s.vehicleHandovers.id })
    .from(s.vehicleHandovers)
    .where(eq(s.vehicleHandovers.assignmentId, assignmentId))
    .orderBy(desc(s.vehicleHandovers.id))
    .limit(1);
  if (!doc) return [];
  return db
    .select({ name: s.vehicleHandoverItems.name, qty: s.vehicleHandoverItems.qty, condition: s.vehicleHandoverItems.condition })
    .from(s.vehicleHandoverItems)
    .where(eq(s.vehicleHandoverItems.handoverId, doc.id))
    .orderBy(asc(s.vehicleHandoverItems.lineNo));
}

/** أسماء الأصناف المقترحة: الأساسية ثم ما كُتب في محاضر سابقة. */
export async function handoverItemNames(db: Db | Tx) {
  const rows = await db
    .selectDistinct({ name: s.vehicleHandoverItems.name })
    .from(s.vehicleHandoverItems)
    .orderBy(asc(s.vehicleHandoverItems.name))
    .limit(200);
  return [...new Set([...DEFAULT_HANDOVER_ITEMS, ...rows.map((r) => r.name)])];
}

/** آخر محضر لكل إسناد (لزر الطباعة في القائمة). */
export async function handoverByAssignment(db: Db | Tx, ids: number[]) {
  const rows = await db
    .select({ id: s.vehicleHandovers.id, number: s.vehicleHandovers.number, a: s.vehicleHandovers.assignmentId, c: s.vehicleHandovers.closedAssignmentId })
    .from(s.vehicleHandovers)
    .where(ids.length ? or(inArray(s.vehicleHandovers.assignmentId, ids), inArray(s.vehicleHandovers.closedAssignmentId, ids)) : eq(s.vehicleHandovers.id, -1))
    .orderBy(asc(s.vehicleHandovers.id));
  // opened: محضر الاستلام الذي بدأ الإسناد، closed: محضر التسليم الذي أنهاه
  const opened = new Map<number, { id: number; number: string }>();
  const closed = new Map<number, { id: number; number: string }>();
  for (const r of rows) {
    if (r.a != null) opened.set(r.a, { id: r.id, number: r.number });
    if (r.c != null) closed.set(r.c, { id: r.id, number: r.number });
  }
  return { opened, closed };
}

const fromEmp = alias(s.employees, "from_emp");
const toEmp = alias(s.employees, "to_emp");
const fromDrv = alias(s.drivers, "from_drv");
const toDrv = alias(s.drivers, "to_drv");

/** المحضر كاملاً للطباعة والمعاينة. */
export async function handoverDoc(db: Db | Tx, id: number) {
  const [row] = await db
    .select({
      h: s.vehicleHandovers,
      plate: s.vehicles.plate,
      make: s.vehicles.make,
      model: s.vehicles.model,
      year: s.vehicles.year,
      chassis: s.vehicles.chassis,
      fromName: fromEmp.nameAr,
      fromId: fromEmp.nationalId,
      toName: toEmp.nameAr,
      toId: toEmp.nationalId,
    })
    .from(s.vehicleHandovers)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.vehicleHandovers.vehicleId))
    .leftJoin(fromDrv, eq(fromDrv.id, s.vehicleHandovers.fromDriverId))
    .leftJoin(fromEmp, eq(fromEmp.id, fromDrv.employeeId))
    .leftJoin(toDrv, eq(toDrv.id, s.vehicleHandovers.toDriverId))
    .leftJoin(toEmp, eq(toEmp.id, toDrv.employeeId))
    .where(eq(s.vehicleHandovers.id, id));
  if (!row) return null;
  const items = await db
    .select()
    .from(s.vehicleHandoverItems)
    .where(eq(s.vehicleHandoverItems.handoverId, id))
    .orderBy(asc(s.vehicleHandoverItems.lineNo));
  return { ...row, items };
}

/** المحاضر الأخيرة للسجل. */
export async function recentHandovers(db: Db | Tx, limit = 50) {
  return db
    .select({ h: s.vehicleHandovers, plate: s.vehicles.plate, fromName: fromEmp.nameAr, toName: toEmp.nameAr })
    .from(s.vehicleHandovers)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.vehicleHandovers.vehicleId))
    .leftJoin(fromDrv, eq(fromDrv.id, s.vehicleHandovers.fromDriverId))
    .leftJoin(fromEmp, eq(fromEmp.id, fromDrv.employeeId))
    .leftJoin(toDrv, eq(toDrv.id, s.vehicleHandovers.toDriverId))
    .leftJoin(toEmp, eq(toEmp.id, toDrv.employeeId))
    .orderBy(desc(s.vehicleHandovers.id))
    .limit(limit);
}

/** المحضر للتعديل: الموجود كما هو، أو هيكله من الإسناد القديم بالأسماء والمركبة (والأدوات من محضر استلامه عند التسليم). */
export async function handoverForEdit(db: Db | Tx, target: HandoverTarget) {
  if ("docId" in target) return handoverDoc(db, target.docId);
  const d = await handoverDraftFor(db, target.assignmentId, target.side);
  if (d.existingId) return handoverDoc(db, d.existingId);
  const [v] = await db
    .select({ plate: s.vehicles.plate, make: s.vehicles.make, model: s.vehicles.model, year: s.vehicles.year, chassis: s.vehicles.chassis })
    .from(s.vehicles)
    .where(eq(s.vehicles.id, d.vehicleId));
  const person = async (driverId: number | null) => {
    if (!driverId) return { name: null, nid: null };
    const [p] = await db
      .select({ name: s.employees.nameAr, nid: s.employees.nationalId })
      .from(s.drivers)
      .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .where(eq(s.drivers.id, driverId));
    return p ?? { name: null, nid: null };
  };
  const [from, to] = await Promise.all([person(d.fromDriverId), person(d.toDriverId)]);
  const items = d.closedAssignmentId ? await itemsOfAssignment(db, d.closedAssignmentId) : [];
  return {
    h: {
      id: 0,
      number: "HO-…",
      kind: d.kind,
      vehicleId: d.vehicleId,
      fromDriverId: d.fromDriverId,
      toDriverId: d.toDriverId,
      handoverDate: d.date,
      odometer: d.odometer,
      fuelLevel: null,
      condition: null,
      companyRep: null,
      notes: null,
      assignmentId: d.assignmentId,
      closedAssignmentId: d.closedAssignmentId,
      createdBy: null,
      createdAt: new Date(0),
    } as typeof s.vehicleHandovers.$inferSelect,
    plate: v?.plate ?? "",
    make: v?.make ?? null,
    model: v?.model ?? null,
    year: v?.year ?? null,
    chassis: v?.chassis ?? null,
    fromName: from.name,
    fromId: from.nid,
    toName: to.name,
    toId: to.nid,
    items: items.map((it, i) => ({ id: i, handoverId: 0, lineNo: i + 1, ...it })),
  };
}
