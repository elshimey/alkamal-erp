import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { addSubAccountTx } from "@/lib/accounts";
import { EXPIRY_ALERT_DAYS } from "@/data/fleet";
import { findPgError } from "@/lib/errors";

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
  assetAccountId?: number | null;
}

/** يضيف المركبة وينشئ مركز تكلفتها في معاملة واحدة (القرار 8). */
export async function createVehicle(db: Db | Tx, input: VehicleInput) {
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
        assetAccountId: input.assetAccountId ?? null,
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

export type DriverStatus = (typeof s.employeeStatus.enumValues)[number];

/** تعديل بيانات السائق وموظفه؛ تغيير الاسم يغيّر اسم حسابَي العهدة والرواتب واسم حساب دخوله. */
export async function updateDriver(db: Db, id: number, input: DriverInput & { birthDate?: string | null; status: DriverStatus }) {
  const name = input.nameAr.trim();
  if (name.length < 2) throw new Error("الاسم إلزامي");
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(s.drivers).where(eq(s.drivers.id, id)).for("update");
    if (!d) throw new Error("السائق غير موجود");
    if (input.status === "terminated" && d.status !== "terminated") {
      const [open] = await tx
        .select({ plate: s.vehicles.plate })
        .from(s.vehicleAssignments)
        .innerJoin(s.vehicles, eq(s.vehicles.id, s.vehicleAssignments.vehicleId))
        .where(and(eq(s.vehicleAssignments.driverId, id), isNull(s.vehicleAssignments.toDate)));
      if (open) throw new Error(`السائق مسند للمركبة ${open.plate}؛ أنهِ الإسناد من شاشة «الإسناد» قبل إنهاء خدمته`);
      const [custody] = await tx
        .select({ number: s.custodyDocs.number })
        .from(s.custodyDocs)
        .where(and(eq(s.custodyDocs.employeeId, d.employeeId), sql`${s.custodyDocs.status} in ('approved','delivered')`))
        .limit(1);
      if (custody) throw new Error(`على السائق عهدة غير مسواة (${custody.number})؛ سوّها قبل إنهاء خدمته`);
    }
    await tx
      .update(s.drivers)
      .set({
        mobile: input.mobile || null,
        nationality: input.nationality || null,
        residencyNumber: input.residencyNumber || null,
        licenseNumber: input.licenseNumber || null,
        transportCardNumber: input.transportCardNumber || null,
        birthDate: input.birthDate || null,
        appLanguage: input.appLanguage ?? d.appLanguage,
        commissionClass: input.commissionClass ?? d.commissionClass,
        custodyLimit: input.custodyLimit != null ? String(input.custodyLimit) : null,
        status: input.status,
        updatedAt: new Date(),
      })
      .where(eq(s.drivers.id, id));
    const [emp] = await tx
      .update(s.employees)
      .set({
        nameAr: name,
        nationalId: input.nationalId || null,
        hireDate: input.hireDate || null,
        ...(input.basicSalary != null ? { basicSalary: String(input.basicSalary) } : {}),
        status: input.status,
        updatedAt: new Date(),
      })
      .where(eq(s.employees.id, d.employeeId))
      .returning({ payableAccountId: s.employees.payableAccountId });
    await tx.update(s.accounts).set({ nameAr: `عهدة – ${name}` }).where(eq(s.accounts.id, d.custodyAccountId));
    if (emp?.payableAccountId) await tx.update(s.accounts).set({ nameAr: `رواتب مستحقة – ${name}` }).where(eq(s.accounts.id, emp.payableAccountId));
    if (d.userId) {
      // منتهي الخدمة لا يدخل التطبيق، ويعود دخوله إن أُعيد نشطاً
      await tx.update(s.users).set({ name, isActive: input.status !== "terminated", updatedAt: new Date() }).where(eq(s.users.id, d.userId));
      if (input.status === "terminated") await tx.delete(s.sessions).where(eq(s.sessions.userId, d.userId));
    }
  });
}

/**
 * حذف السائق نهائياً مع موظفه وحساباته وحساب دخوله، ويُسمح فقط إن لم تكن له أي حركة.
 * من له حركات تُغيَّر حالته إلى «منتهية خدمته» بدل الحذف حفاظاً على القيود.
 */
export async function deleteDriver(db: Db, id: number) {
  try {
    return await db.transaction(async (tx) => {
      const [d] = await tx
        .select({ d: s.drivers, payable: s.employees.payableAccountId, name: s.employees.nameAr })
        .from(s.drivers)
        .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
        .where(eq(s.drivers.id, id))
        .for("update");
      if (!d) throw new Error("السائق غير موجود");
      await tx.delete(s.drivers).where(eq(s.drivers.id, id));
      await tx.delete(s.employees).where(eq(s.employees.id, d.d.employeeId));
      await tx.delete(s.accounts).where(eq(s.accounts.id, d.d.custodyAccountId));
      if (d.payable) await tx.delete(s.accounts).where(eq(s.accounts.id, d.payable));
      if (d.d.userId) {
        const userId = d.d.userId;
        // حساب دخول له سجلات (أنشأ مستندات مثلاً) يُوقف بدل حذفه
        await tx.transaction((sp) => sp.delete(s.users).where(eq(s.users.id, userId))).catch(async () => {
          await tx.update(s.users).set({ isActive: false }).where(eq(s.users.id, userId));
          await tx.delete(s.sessions).where(eq(s.sessions.userId, userId));
        });
      }
      return d.name;
    });
  } catch (err) {
    if (findPgError(err)?.code === "23503")
      throw new Error("لا يمكن حذف السائق لأن له حركات مسجلة (شحنات أو إسناد أو رواتب أو قيود). غيّر حالته إلى «منتهية خدمته» بدلاً من الحذف.");
    throw err;
  }
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
