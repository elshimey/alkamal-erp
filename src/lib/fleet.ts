import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { addSubAccountTx } from "@/lib/accounts";
import { EXPIRY_ALERT_DAYS } from "@/data/fleet";

export { EXPIRY_ALERT_DAYS };

export interface VehicleInput {
  plate: string;
  chassis: string;
  vehicleTypeId?: number | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  ownership?: "owned" | "leased";
  odometer?: number;
}

/** يضيف المركبة وينشئ مركز تكلفتها في معاملة واحدة (القرار 8). */
export async function createVehicle(db: Db, input: VehicleInput) {
  const plate = input.plate.trim();
  return db.transaction(async (tx) => {
    const [cc] = await tx
      .insert(s.costCenters)
      .values({ code: `V-${plate}`, nameAr: `المركبة ${plate}`, type: "vehicle" })
      .returning({ id: s.costCenters.id });
    const [vehicle] = await tx
      .insert(s.vehicles)
      .values({
        plate,
        chassis: input.chassis.trim(),
        vehicleTypeId: input.vehicleTypeId ?? null,
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        ownership: input.ownership ?? "owned",
        odometer: input.odometer ?? 0,
        costCenterId: cc.id,
      })
      .returning();
    return vehicle;
  });
}

// ───────────── السائقون ─────────────

export interface DriverInput {
  nameAr: string;
  mobile?: string | null;
  nationality?: string | null;
  nationalId?: string | null;
  residencyNumber?: string | null;
  licenseNumber?: string | null;
  transportCardNumber?: string | null;
  appLanguage?: "ar" | "ur" | "hi" | "en";
  commissionClass?: "domestic" | "international";
  hireDate?: string | null;
  basicSalary?: number;
  custodyLimit?: number | null;
}

async function accountIdByCode(tx: Tx, code: string) {
  const [row] = await tx.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.code, code));
  if (!row) throw new Error(`الحساب ${code} غير موجود في الشجرة`);
  return row.id;
}

/**
 * ينشئ السائق مع موظفه (إلزامي)، وحساب رواتبه المستحقة تحت 2107،
 * وحساب عهدته تحت 1105، في معاملة واحدة.
 */
export async function createDriver(db: Db, input: DriverInput) {
  const name = input.nameAr.trim();
  return db.transaction(async (tx) => {
    const payable = await addSubAccountTx(tx, await accountIdByCode(tx, "2107"), `رواتب مستحقة – ${name}`);
    const custody = await addSubAccountTx(tx, await accountIdByCode(tx, "1105"), `عهدة – ${name}`);
    const [employee] = await tx
      .insert(s.employees)
      .values({
        nameAr: name,
        nationalId: input.nationalId || null,
        jobTitle: "سائق",
        hireDate: input.hireDate || null,
        basicSalary: String(input.basicSalary ?? 0),
        payableAccountId: payable.id,
      })
      .returning({ id: s.employees.id });
    const [driver] = await tx
      .insert(s.drivers)
      .values({
        employeeId: employee.id,
        mobile: input.mobile || null,
        nationality: input.nationality || null,
        residencyNumber: input.residencyNumber || null,
        licenseNumber: input.licenseNumber || null,
        transportCardNumber: input.transportCardNumber || null,
        appLanguage: input.appLanguage ?? "ar",
        commissionClass: input.commissionClass ?? "domestic",
        custodyAccountId: custody.id,
        custodyLimit: input.custodyLimit != null ? String(input.custodyLimit) : null,
      })
      .returning();
    return { ...driver, payableAccountCode: payable.code, custodyAccountCode: custody.code };
  });
}

// ───────────── الإسناد والتسليم ─────────────

export async function assignVehicle(
  db: Db,
  input: { vehicleId: number; driverId: number; fromDate: string; odometerStart?: number | null; notes?: string | null; userId?: number },
) {
  return db.transaction(async (tx) => {
    const [vehicle] = await tx.select().from(s.vehicles).where(eq(s.vehicles.id, input.vehicleId)).for("update");
    if (!vehicle) throw new Error("المركبة غير موجودة");
    const [driver] = await tx.select().from(s.drivers).where(eq(s.drivers.id, input.driverId));
    if (!driver || driver.status !== "active") throw new Error("السائق غير نشط");
    const open = await tx
      .select({ vehicleId: s.vehicleAssignments.vehicleId, driverId: s.vehicleAssignments.driverId })
      .from(s.vehicleAssignments)
      .where(
        and(
          isNull(s.vehicleAssignments.toDate),
          or(eq(s.vehicleAssignments.vehicleId, input.vehicleId), eq(s.vehicleAssignments.driverId, input.driverId)),
        ),
      );
    if (open.some((o) => o.vehicleId === input.vehicleId)) throw new Error("المركبة مسندة لسائق آخر؛ سجّل تسليمها أولاً");
    if (open.length) throw new Error("السائق مسند لمركبة أخرى؛ سجّل تسليمها أولاً");
    const odometerStart = input.odometerStart ?? vehicle.odometer;
    if (odometerStart < vehicle.odometer) throw new Error(`قراءة العداد أقل من آخر قراءة مسجلة (${vehicle.odometer})`);
    const [row] = await tx
      .insert(s.vehicleAssignments)
      .values({ ...input, odometerStart, createdBy: input.userId })
      .returning();
    if (odometerStart > vehicle.odometer) {
      await tx.update(s.vehicles).set({ odometer: odometerStart, updatedAt: new Date() }).where(eq(s.vehicles.id, vehicle.id));
    }
    return row;
  });
}

export async function releaseAssignment(
  db: Db,
  input: { assignmentId: number; toDate: string; odometerEnd?: number | null; notes?: string | null },
) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(s.vehicleAssignments).where(eq(s.vehicleAssignments.id, input.assignmentId)).for("update");
    if (!a) throw new Error("الإسناد غير موجود");
    if (a.toDate) throw new Error("سُجّل تسليم هذه المركبة مسبقاً");
    if (input.toDate < a.fromDate) throw new Error("تاريخ التسليم قبل تاريخ الاستلام");
    if (input.odometerEnd != null && a.odometerStart != null && input.odometerEnd < a.odometerStart) {
      throw new Error(`قراءة العداد أقل من قراءة الاستلام (${a.odometerStart})`);
    }
    await tx
      .update(s.vehicleAssignments)
      .set({ toDate: input.toDate, odometerEnd: input.odometerEnd ?? null, notes: input.notes ?? a.notes })
      .where(eq(s.vehicleAssignments.id, a.id));
    if (input.odometerEnd != null) {
      await tx
        .update(s.vehicles)
        .set({ odometer: sql`greatest(${s.vehicles.odometer}, ${input.odometerEnd})`, updatedAt: new Date() })
        .where(eq(s.vehicles.id, a.vehicleId));
    }
  });
}

/** من كان يقود المركبة في تاريخ معيّن (يُقترح تلقائياً على المخالفة). */
export async function driverOnDate(db: Db | Tx, vehicleId: number, onDate: string) {
  const [row] = await db
    .select({ driverId: s.vehicleAssignments.driverId })
    .from(s.vehicleAssignments)
    .where(
      and(
        eq(s.vehicleAssignments.vehicleId, vehicleId),
        lte(s.vehicleAssignments.fromDate, onDate),
        or(isNull(s.vehicleAssignments.toDate), gte(s.vehicleAssignments.toDate, onDate)),
      ),
    )
    .orderBy(desc(s.vehicleAssignments.fromDate))
    .limit(1);
  return row?.driverId ?? null;
}

// ───────────── الوثائق ─────────────


/** الوثائق المنتهية أو التي تنتهي خلال المدة المحددة، الأقرب أولاً. */
export async function expiringDocuments(db: Db, today: string, days = EXPIRY_ALERT_DAYS) {
  return db
    .select({
      doc: s.fleetDocuments,
      plate: s.vehicles.plate,
      driverName: s.employees.nameAr,
    })
    .from(s.fleetDocuments)
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.fleetDocuments.vehicleId))
    .leftJoin(s.drivers, eq(s.drivers.id, s.fleetDocuments.driverId))
    .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .where(lte(s.fleetDocuments.expiryDate, sql`${today}::date + ${days}::int`))
    .orderBy(asc(s.fleetDocuments.expiryDate));
}
