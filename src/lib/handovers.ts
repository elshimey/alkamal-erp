import { asc, desc, eq, inArray, or } from "drizzle-orm";
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
