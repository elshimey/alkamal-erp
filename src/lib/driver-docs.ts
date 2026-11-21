import { and, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { ownerDocuments, type DocState } from "@/lib/documents";

/**
 * وثائق السائق في تطبيقه (قرار أحمد 2026-11-21): وثائقه، ووثائق مركبته المسندة، ووثائق مقطورته.
 * المقطورة تتبدّل بين الرؤوس فلا إسناد لها؛ هي مقطورة آخر رحلة له (المفتوحة أولاً).
 */
export async function driverTrailer(db: Db | Tx, driverId: number): Promise<{ id: number; plate: string } | null> {
  const [row] = await db
    .select({ id: s.vehicles.id, plate: s.vehicles.plate })
    .from(s.waybills)
    .innerJoin(s.vehicles, eq(s.vehicles.id, s.waybills.trailerId))
    .where(and(eq(s.waybills.driverId, driverId), isNotNull(s.waybills.trailerId), ne(s.waybills.status, "rejected")))
    .orderBy(sql`(${s.waybills.status} in ('draft','in_transit','delivered')) desc`, desc(s.waybills.waybillDate), desc(s.waybills.id))
    .limit(1);
  return row ?? null;
}

export interface DriverDocRow {
  typeId: number;
  name: string;
  number: string | null;
  expiryDate: string | null;
  state: DocState;
  /** الأيام الباقية (موجبة) أو منذ الانتهاء (سالبة) */
  days: number | null;
  fileId: number | null;
  isPdf: boolean;
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

async function rowsFor(db: Db | Tx, kind: "driver" | "vehicle" | "trailer", id: number, today: string): Promise<DriverDocRow[]> {
  const docs = (await ownerDocuments(db, kind, id, today)).filter((r) => r.current || r.type.required);
  // الرقم يصل من الاستعلام الفرعي نصاً
  const fileOf = (c: (typeof docs)[number]["current"]) => (c?.attachmentId != null ? Number(c.attachmentId) : null);
  const ids = docs.map((r) => fileOf(r.current)).filter((x): x is number => x != null);
  const mimes = ids.length ? await db.select({ id: s.attachments.id, mime: s.attachments.mime }).from(s.attachments).where(inArray(s.attachments.id, ids)) : [];
  const pdf = new Set(mimes.filter((m) => m.mime === "application/pdf").map((m) => m.id));
  return docs.map(({ type, current, state }) => {
    const exp = current?.doc.expiryDate ?? null;
    const fileId = fileOf(current);
    return { typeId: type.id, name: type.nameAr, number: current?.doc.number ?? null, expiryDate: exp, state, days: exp ? dayDiff(today, exp) : null, fileId, isPdf: fileId != null && pdf.has(fileId) };
  });
}

/** الوثائق الثلاث كما تظهر في صفحة «وثائقي». */
export async function driverDocuments(db: Db | Tx, driver: { id: number; vehicle: { id: number; plate: string } | null }, today: string) {
  const trailer = await driverTrailer(db, driver.id);
  const [mine, vehicle, trailerDocs] = await Promise.all([
    rowsFor(db, "driver", driver.id, today),
    driver.vehicle ? rowsFor(db, "vehicle", driver.vehicle.id, today) : Promise.resolve([]),
    trailer ? rowsFor(db, "trailer", trailer.id, today) : Promise.resolve([]),
  ]);
  return { mine, vehicle, trailer, trailerDocs };
}

/** المركبات التي يرى السائق وثائقها: المسندة له الآن ومقطورته. */
async function driverVehicleIds(db: Db | Tx, driverId: number) {
  const [a] = await db
    .select({ id: s.vehicleAssignments.vehicleId })
    .from(s.vehicleAssignments)
    .where(and(eq(s.vehicleAssignments.driverId, driverId), sql`${s.vehicleAssignments.toDate} is null`));
  const trailer = await driverTrailer(db, driverId);
  return [a?.id, trailer?.id].filter((x): x is number => x != null);
}

/** هل يفتح السائق ملف وثيقة السجل هذه؟ وثائقه، ووثائق مركبته ومقطورته فقط. */
export async function driverCanSeeDocument(db: Db | Tx, driverId: number, fleetDocumentId: number) {
  const vehicles = await driverVehicleIds(db, driverId);
  const [row] = await db
    .select({ id: s.fleetDocuments.id })
    .from(s.fleetDocuments)
    .where(
      and(
        eq(s.fleetDocuments.id, fleetDocumentId),
        or(eq(s.fleetDocuments.driverId, driverId), vehicles.length ? inArray(s.fleetDocuments.vehicleId, vehicles) : sql`false`),
      ),
    );
  return !!row;
}

/** ملفات الوثائق الحالية التي تُحفظ في جوال السائق لتفتح دون إنترنت. */
export async function driverDocumentFiles(db: Db | Tx, driver: { id: number; vehicle: { id: number; plate: string } | null }, today: string) {
  const { mine, vehicle, trailerDocs } = await driverDocuments(db, driver, today);
  return [...mine, ...vehicle, ...trailerDocs].map((r) => r.fileId).filter((x): x is number => x != null);
}
