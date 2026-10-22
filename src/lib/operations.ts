import { and, eq, gte, lte, ne } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { resolvePrice, type Rate, type Trip } from "@/lib/pricing";

// ───────────── جهات الاتصال ─────────────

export type PartyRole = (typeof s.partyRoleType.enumValues)[number];

export async function createParty(
  db: Db | Tx,
  input: {
    nameAr: string;
    nameEn?: string | null;
    kind?: "individual" | "company";
    vatNumber?: string | null;
    crNumber?: string | null;
    mobile?: string | null;
    email?: string | null;
    country?: string;
    defaultCurrency?: string;
    address?: { buildingNo?: string | null; street?: string | null; district?: string | null; city?: string | null; postalCode?: string | null; additionalNo?: string | null };
    roles: PartyRole[];
  },
) {
  if (!input.roles.length) throw new Error("اختر دوراً واحداً على الأقل (عميل، مورد، ناقل...)");
  return db.transaction(async (tx) => {
    const [party] = await tx
      .insert(s.parties)
      .values({
        nameAr: input.nameAr.trim(),
        nameEn: input.nameEn?.trim() || null,
        kind: input.kind ?? "company",
        vatNumber: input.vatNumber || null,
        crNumber: input.crNumber || null,
        buildingNo: input.address?.buildingNo || null,
        street: input.address?.street || null,
        district: input.address?.district || null,
        city: input.address?.city || null,
        postalCode: input.address?.postalCode || null,
        additionalNo: input.address?.additionalNo || null,
        mobile: input.mobile || null,
        email: input.email || null,
        country: input.country ?? "SA",
        defaultCurrency: input.defaultCurrency ?? "SAR",
      })
      .returning();
    await tx.insert(s.partyRoles).values(input.roles.map((role) => ({ partyId: party.id, role })));
    return party;
  });
}

// ───────────── المواقع والمسارات ─────────────

export async function createLocation(
  db: Db,
  input: { parentId?: number | null; nameAr: string; countryCode?: string; isBorderCrossing?: boolean },
) {
  if (!input.parentId) {
    const code = (input.countryCode ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw new Error("رمز الدولة حرفان إنجليزيان (مثل SA أو KW)");
    const [row] = await db.insert(s.locations).values({ level: "country", nameAr: input.nameAr.trim(), countryCode: code }).returning();
    return row;
  }
  const [parent] = await db.select().from(s.locations).where(eq(s.locations.id, input.parentId));
  if (!parent) throw new Error("الموقع الأب غير موجود");
  if (parent.level === "site") throw new Error("لا يمكن إضافة موقع تحت موقع؛ اختر دولة أو مدينة");
  const [row] = await db
    .insert(s.locations)
    .values({
      parentId: parent.id,
      level: parent.level === "country" ? "city" : "site",
      nameAr: input.nameAr.trim(),
      countryCode: parent.countryCode,
      isBorderCrossing: input.isBorderCrossing ?? false,
    })
    .returning();
  return row;
}

export async function createRoute(
  db: Db,
  input: { fromLocationId: number; toLocationId: number; distanceKm?: number | null; driverCommission?: number; estimatedDieselLiters?: number | null },
) {
  if (input.fromLocationId === input.toLocationId) throw new Error("نقطة الانطلاق والوصول متطابقتان");
  const [from] = await db.select().from(s.locations).where(eq(s.locations.id, input.fromLocationId));
  const [to] = await db.select().from(s.locations).where(eq(s.locations.id, input.toLocationId));
  if (!from || !to) throw new Error("الموقع غير موجود");
  const [row] = await db
    .insert(s.routes)
    .values({
      fromLocationId: from.id,
      toLocationId: to.id,
      distanceKm: input.distanceKm ?? null,
      // الرحلة دولية إذا اختلفت دولة الانطلاق عن دولة الوصول
      isInternational: from.countryCode !== to.countryCode,
      driverCommission: String(input.driverCommission ?? 0),
      estimatedDieselLiters: input.estimatedDieselLiters ?? null,
    })
    .returning();
  return row;
}

// ───────────── العقود ─────────────

export async function createContract(
  db: Db,
  input: { customerId: number; number: string; fromDate: string; toDate: string; currencyCode?: string; creditLimit?: number | null; paymentTermsDays?: number; notes?: string | null },
) {
  if (input.toDate < input.fromDate) throw new Error("تاريخ نهاية العقد قبل بدايته");
  const roles = await db.select().from(s.partyRoles).where(and(eq(s.partyRoles.partyId, input.customerId), eq(s.partyRoles.role, "customer")));
  if (!roles.length) throw new Error("الجهة المختارة ليست عميلاً");
  const [row] = await db
    .insert(s.contracts)
    .values({
      customerId: input.customerId,
      number: input.number.trim(),
      fromDate: input.fromDate,
      toDate: input.toDate,
      currencyCode: input.currencyCode ?? "SAR",
      creditLimit: input.creditLimit != null ? String(input.creditLimit) : null,
      paymentTermsDays: input.paymentTermsDays ?? 30,
      notes: input.notes || null,
    })
    .returning();
  return row;
}

/** تفعيل العقد؛ يُرفض إن تداخلت مدته مع عقد ساري آخر للعميل نفسه، أو لم يكن له بند تسعير. */
export async function setContractStatus(db: Db, contractId: number, status: "active" | "suspended" | "expired" | "draft") {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(s.contracts).where(eq(s.contracts.id, contractId)).for("update");
    if (!c) throw new Error("العقد غير موجود");
    if (status === "active") {
      const rates = await tx.select({ id: s.contractRates.id }).from(s.contractRates).where(eq(s.contractRates.contractId, c.id));
      if (!rates.length) throw new Error("أضف بند تسعير واحداً على الأقل قبل تفعيل العقد");
      const overlap = await tx
        .select({ number: s.contracts.number })
        .from(s.contracts)
        .where(
          and(
            eq(s.contracts.customerId, c.customerId),
            eq(s.contracts.status, "active"),
            ne(s.contracts.id, c.id),
            lte(s.contracts.fromDate, c.toDate),
            gte(s.contracts.toDate, c.fromDate),
          ),
        );
      if (overlap.length) throw new Error(`مدة العقد تتداخل مع العقد الساري ${overlap[0].number}`);
    }
    await tx.update(s.contracts).set({ status, updatedAt: new Date() }).where(eq(s.contracts.id, c.id));
  });
}

/** العقد الساري للعميل في تاريخ معيّن (يُقترح على الشحنة). */
export async function activeContract(db: Db | Tx, customerId: number, onDate: string) {
  const [row] = await db
    .select()
    .from(s.contracts)
    .where(
      and(
        eq(s.contracts.customerId, customerId),
        eq(s.contracts.status, "active"),
        lte(s.contracts.fromDate, onDate),
        gte(s.contracts.toDate, onDate),
      ),
    );
  return row ?? null;
}

export async function contractRatesFor(db: Db | Tx, contractId: number): Promise<Rate[]> {
  const rows = await db.select().from(s.contractRates).where(eq(s.contractRates.contractId, contractId));
  return rows.map((r) => ({ ...r, price: Number(r.price) }));
}

/** سعر الرحلة من العقد الساري للعميل، أو null إن لم يوجد عقد أو بند مطابق. */
export async function priceTrip(db: Db, customerId: number, onDate: string, trip: Trip) {
  const contract = await activeContract(db, customerId, onDate);
  if (!contract) return null;
  const price = resolvePrice(await contractRatesFor(db, contract.id), trip);
  return price ? { ...price, contractId: contract.id, currencyCode: contract.currencyCode } : null;
}
