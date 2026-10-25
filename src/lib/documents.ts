import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { daysBetween } from "@/lib/dates";
import { getCompany } from "@/lib/company";

// سجل الوثائق: لكل صاحب (رأس، مقطورة، سائق، موظف، الشركة، عميل) وثائقه حسب الأنواع المعرّفة في الإعدادات.
// الوثيقة المجدَّدة سجل جديد؛ الأحدث انتهاءً هو المعتمد، والأقدم يبقى في التاريخ.

export type OwnerKind = (typeof s.documentOwnerKind.enumValues)[number];
export type Blocking = (typeof s.documentBlocking.enumValues)[number];
export type DocumentType = typeof s.documentTypes.$inferSelect;
export type DocState = "valid" | "soon" | "expired" | "missing" | "none";

export const OWNER_KINDS: Record<OwnerKind, { label: string; plural: string }> = {
  vehicle: { label: "رأس (شاحنة)", plural: "الرؤوس" },
  trailer: { label: "مقطورة (سطحة)", plural: "المقطورات" },
  driver: { label: "سائق", plural: "السائقون" },
  employee: { label: "موظف", plural: "الموظفون" },
  company: { label: "الشركة", plural: "الشركة" },
  customer: { label: "عميل", plural: "العملاء" },
};

export const BLOCKING: Record<Blocking, string> = {
  block: "تمنع",
  international: "تمنع الدولي فقط",
  alert: "تنبيه فقط",
};

export const STATE_LABEL: Record<DocState, string> = {
  valid: "سارية",
  soon: "تنتهي قريباً",
  expired: "منتهية",
  missing: "ناقصة",
  none: "غير مُدخلة",
};

/** أيام التنبيه مرتبة تنازلياً، مثل "60,30,7" → [60, 30, 7]. */
export function parseAlertDays(raw: string | null | undefined): number[] {
  const days = String(raw ?? "")
    .split(/[,،\s]+/)
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d > 0 && d <= 365);
  return [...new Set(days)].sort((a, b) => b - a);
}

/** أول مرحلة تنبيه (أكبر عدد أيام)، وافتراضياً 60. */
export const alertWindow = (raw: string | null | undefined) => parseAlertDays(raw)[0] ?? 60;

export function stateOf(expiryDate: string | null, today: string, window: number): Exclude<DocState, "missing" | "none"> {
  if (!expiryDate) return "valid";
  const left = daysBetween(today, expiryDate);
  if (left < 0) return "expired";
  return left <= window ? "soon" : "valid";
}

/** مفتاح صاحب الوثيقة في الروابط والنماذج: vehicle:5، company:0 */
export const ownerKey = (kind: OwnerKind, id: number) => `${kind}:${id}`;
export function parseOwnerKey(key: string | null | undefined): { kind: OwnerKind; id: number } | null {
  const [kind, raw] = String(key ?? "").split(":");
  const id = Number(raw);
  if (!(kind in OWNER_KINDS) || !Number.isInteger(id) || id < 0) return null;
  if ((kind === "company") !== (id === 0)) return null;
  return { kind: kind as OwnerKind, id };
}

/** أعمدة الصاحب في جدول الوثائق */
export function ownerColumns(kind: OwnerKind, id: number) {
  return {
    vehicleId: kind === "vehicle" || kind === "trailer" ? id : null,
    driverId: kind === "driver" ? id : null,
    employeeId: kind === "employee" ? id : null,
    partyId: kind === "customer" ? id : null,
  };
}

function ownerIdOf(kind: OwnerKind, d: { vehicleId: number | null; driverId: number | null; employeeId: number | null; partyId: number | null }) {
  if (kind === "vehicle" || kind === "trailer") return d.vehicleId;
  if (kind === "driver") return d.driverId;
  if (kind === "employee") return d.employeeId;
  if (kind === "customer") return d.partyId;
  return 0;
}

export async function listDocumentTypes(db: Db | Tx, opts: { activeOnly?: boolean; kind?: OwnerKind } = {}) {
  const where = [];
  if (opts.activeOnly) where.push(eq(s.documentTypes.isActive, true));
  if (opts.kind) where.push(eq(s.documentTypes.ownerKind, opts.kind));
  return db
    .select()
    .from(s.documentTypes)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(s.documentTypes.sortOrder), asc(s.documentTypes.id));
}

export interface Owner {
  kind: OwnerKind;
  id: number;
  label: string;
  /** صفحة الصاحب نفسه (للعودة إليها) */
  href?: string;
}

/** أصحاب الوثائق الفاعلون من كل نوع (المباعة والمنتهية خدمتهم والعملاء غير النشطين لا يُطالبون بوثائق). */
export async function listOwners(db: Db | Tx, kinds: OwnerKind[] = Object.keys(OWNER_KINDS) as OwnerKind[]): Promise<Owner[]> {
  const out: Owner[] = [];
  const want = new Set(kinds);
  if (want.has("vehicle") || want.has("trailer")) {
    const rows = await db
      .select({ id: s.vehicles.id, plate: s.vehicles.plate, kind: s.vehicles.assetKind })
      .from(s.vehicles)
      .where(ne(s.vehicles.status, "sold"))
      .orderBy(asc(s.vehicles.plate));
    for (const r of rows) {
      const kind = r.kind === "trailer" ? "trailer" : "vehicle";
      if (want.has(kind)) out.push({ kind, id: r.id, label: r.plate, href: `/records/vehicles/${r.id}` });
    }
  }
  if (want.has("driver")) {
    const rows = await db
      .select({ id: s.drivers.id, name: s.employees.nameAr })
      .from(s.drivers)
      .innerJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
      .where(ne(s.drivers.status, "terminated"))
      .orderBy(asc(s.employees.nameAr));
    out.push(...rows.map((r) => ({ kind: "driver" as const, id: r.id, label: r.name, href: `/drivers/${r.id}` })));
  }
  if (want.has("employee")) {
    // الموظف السائق وثائقه في قسم السائقين
    const rows = await db
      .select({ id: s.employees.id, name: s.employees.nameAr })
      .from(s.employees)
      .where(and(ne(s.employees.status, "terminated"), sql`not exists (select 1 from drivers d where d.employee_id = ${s.employees.id})`))
      .orderBy(asc(s.employees.nameAr));
    out.push(...rows.map((r) => ({ kind: "employee" as const, id: r.id, label: r.name, href: `/records/employees/${r.id}` })));
  }
  if (want.has("company")) {
    const company = await getCompany(db as Db);
    out.push({ kind: "company", id: 0, label: company.nameAr, href: "/settings/company" });
  }
  if (want.has("customer")) {
    const rows = await db
      .select({ id: s.parties.id, name: s.parties.nameAr })
      .from(s.parties)
      .innerJoin(s.partyRoles, and(eq(s.partyRoles.partyId, s.parties.id), eq(s.partyRoles.role, "customer")))
      .where(eq(s.parties.isActive, true))
      .orderBy(asc(s.parties.nameAr));
    out.push(...rows.map((r) => ({ kind: "customer" as const, id: r.id, label: r.name, href: `/customers?open=${r.id}` })));
  }
  return out;
}

export async function ownerLabel(db: Db | Tx, kind: OwnerKind, id: number) {
  return (await listOwners(db, [kind])).find((o) => o.id === id) ?? null;
}

const docSelect = {
  doc: s.fleetDocuments,
  type: s.documentTypes,
  attachmentId: sql<number | null>`(select a.id from attachments a where a.entity = 'fleet_documents' and a.entity_id = ${s.fleetDocuments.id} order by a.id desc limit 1)`,
};

/** حالة كل نوع وثيقة لصاحب واحد، مع تاريخ الوثائق السابقة. */
export async function ownerDocuments(db: Db | Tx, kind: OwnerKind, id: number, today: string) {
  const types = await listDocumentTypes(db, { kind });
  const cols = ownerColumns(kind, id);
  const docs = await db
    .select(docSelect)
    .from(s.fleetDocuments)
    .innerJoin(s.documentTypes, eq(s.documentTypes.id, s.fleetDocuments.documentTypeId))
    .where(
      and(
        eq(s.documentTypes.ownerKind, kind),
        cols.vehicleId != null ? eq(s.fleetDocuments.vehicleId, cols.vehicleId) : sql`${s.fleetDocuments.vehicleId} is null`,
        cols.driverId != null ? eq(s.fleetDocuments.driverId, cols.driverId) : sql`${s.fleetDocuments.driverId} is null`,
        cols.employeeId != null ? eq(s.fleetDocuments.employeeId, cols.employeeId) : sql`${s.fleetDocuments.employeeId} is null`,
        cols.partyId != null ? eq(s.fleetDocuments.partyId, cols.partyId) : sql`${s.fleetDocuments.partyId} is null`,
      ),
    )
    .orderBy(sql`${s.fleetDocuments.expiryDate} desc nulls first`, desc(s.fleetDocuments.id));
  return types
    .map((type) => {
      const all = docs.filter((d) => d.type.id === type.id);
      const current = all[0] ?? null;
      const state: DocState = current ? stateOf(current.doc.expiryDate, today, alertWindow(type.alertDays)) : type.required ? "missing" : "none";
      return { type, current, history: all.slice(1), state };
    })
    .filter((r) => r.type.isActive || r.current);
}

export interface RegisterRow extends Owner {
  counts: Record<DocState, number>;
}

/** ملخص كل صاحب: كم وثيقة سارية وقريبة ومنتهية وناقصة. */
export async function documentRegister(db: Db | Tx, today: string): Promise<RegisterRow[]> {
  const [types, owners, latest] = await Promise.all([
    listDocumentTypes(db, { activeOnly: true }),
    listOwners(db),
    // أحدث وثيقة لكل نوع وصاحب
    db
      .selectDistinctOn([s.fleetDocuments.documentTypeId, s.fleetDocuments.vehicleId, s.fleetDocuments.driverId, s.fleetDocuments.employeeId, s.fleetDocuments.partyId], {
        typeId: s.fleetDocuments.documentTypeId,
        vehicleId: s.fleetDocuments.vehicleId,
        driverId: s.fleetDocuments.driverId,
        employeeId: s.fleetDocuments.employeeId,
        partyId: s.fleetDocuments.partyId,
        expiryDate: s.fleetDocuments.expiryDate,
      })
      .from(s.fleetDocuments)
      .orderBy(
        s.fleetDocuments.documentTypeId,
        s.fleetDocuments.vehicleId,
        s.fleetDocuments.driverId,
        s.fleetDocuments.employeeId,
        s.fleetDocuments.partyId,
        sql`${s.fleetDocuments.expiryDate} desc nulls first`,
      ),
  ]);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const found = new Map<string, string | null>();
  for (const d of latest) {
    const type = typeById.get(d.typeId);
    if (!type) continue;
    found.set(`${ownerKey(type.ownerKind, ownerIdOf(type.ownerKind, d) ?? -1)}|${type.id}`, d.expiryDate);
  }
  return owners.map((o) => {
    const counts: Record<DocState, number> = { valid: 0, soon: 0, expired: 0, missing: 0, none: 0 };
    for (const t of types) {
      if (t.ownerKind !== o.kind) continue;
      const key = `${ownerKey(o.kind, o.id)}|${t.id}`;
      if (found.has(key)) counts[stateOf(found.get(key) ?? null, today, alertWindow(t.alertDays))]++;
      else counts[t.required ? "missing" : "none"]++;
    }
    return { ...o, counts };
  });
}

/** الوثائق السارية الحالية (الأحدث لكل نوع وصاحب) المنتهية أو التي دخلت أول مرحلة تنبيه لنوعها، الأقرب أولاً. */
export async function expiringDocuments(db: Db | Tx, today: string) {
  const rows = await db
    .select({
      doc: s.fleetDocuments,
      type: s.documentTypes,
      plate: s.vehicles.plate,
      driverName: s.employees.nameAr,
      employeeName: sql<string | null>`(select e.name_ar from employees e where e.id = ${s.fleetDocuments.employeeId})`,
      partyName: s.parties.nameAr,
    })
    .from(s.fleetDocuments)
    .innerJoin(s.documentTypes, eq(s.documentTypes.id, s.fleetDocuments.documentTypeId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.fleetDocuments.vehicleId))
    .leftJoin(s.drivers, eq(s.drivers.id, s.fleetDocuments.driverId))
    .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .leftJoin(s.parties, eq(s.parties.id, s.fleetDocuments.partyId))
    .where(
      and(
        eq(s.documentTypes.isActive, true),
        sql`${s.fleetDocuments.expiryDate} <= ${today}::date + 365`,
        // الوثيقة المجدَّدة (أحدث منها لنفس الصاحب ونفس النوع) لا تُنبَّه
        sql`not exists (select 1 from fleet_documents f2 where f2.document_type_id = ${s.fleetDocuments.documentTypeId}
          and f2.vehicle_id is not distinct from ${s.fleetDocuments.vehicleId} and f2.driver_id is not distinct from ${s.fleetDocuments.driverId}
          and f2.employee_id is not distinct from ${s.fleetDocuments.employeeId} and f2.party_id is not distinct from ${s.fleetDocuments.partyId}
          and (f2.expiry_date is null or f2.expiry_date > ${s.fleetDocuments.expiryDate}))`,
        sql`coalesce(${s.vehicles.status}::text, '') <> 'sold' and coalesce(${s.drivers.status}::text, '') <> 'terminated'`,
      ),
    )
    .orderBy(asc(s.fleetDocuments.expiryDate));
  return rows
    .filter((r) => stateOf(r.doc.expiryDate, today, alertWindow(r.type.alertDays)) !== "valid")
    .map((r) => ({ ...r, owner: r.plate ?? r.driverName ?? r.employeeName ?? r.partyName ?? "الشركة" }));
}

/** عدد الوثائق المنتهية والقريبة من الانتهاء، لتنبيه أعلى الشاشة. */
export async function expiryCounts(db: Db | Tx, today: string) {
  const rows = await expiringDocuments(db, today);
  const expired = rows.filter((r) => r.doc.expiryDate! < today).length;
  return { expired, soon: rows.length - expired };
}

export interface DocumentInput {
  documentTypeId: number;
  owner: { kind: OwnerKind; id: number };
  number?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  authority?: string | null;
  cost?: number | null;
  notes?: string | null;
  userId?: number;
}

/** يضيف وثيقة (أو تجديداً لوثيقة سابقة من النوع نفسه) بعد التحقق من أن النوع يناسب الصاحب. */
export async function addDocument(db: Db | Tx, input: DocumentInput) {
  const [type] = await db.select().from(s.documentTypes).where(eq(s.documentTypes.id, input.documentTypeId));
  if (!type) throw new Error("اختر نوع الوثيقة");
  const { kind, id } = input.owner;
  if (type.ownerKind !== kind) throw new Error(`«${type.nameAr}» وثيقة ${OWNER_KINDS[type.ownerKind].label}، لا ${OWNER_KINDS[kind].label}`);
  if (kind === "vehicle" || kind === "trailer") {
    const [v] = await db.select({ kind: s.vehicles.assetKind, plate: s.vehicles.plate }).from(s.vehicles).where(eq(s.vehicles.id, id));
    if (!v) throw new Error("المركبة غير موجودة");
    if ((v.kind === "trailer") !== (kind === "trailer")) throw new Error(`${v.plate} ${v.kind === "trailer" ? "مقطورة" : "رأس"}؛ اختر نوع وثيقة يناسبها`);
  }
  if (input.issueDate && input.expiryDate && input.issueDate > input.expiryDate) throw new Error("تاريخ الإصدار بعد تاريخ الانتهاء");
  const [row] = await db
    .insert(s.fleetDocuments)
    .values({
      documentTypeId: type.id,
      ...ownerColumns(kind, id),
      number: input.number || null,
      issueDate: input.issueDate || null,
      expiryDate: input.expiryDate || null,
      authority: input.authority || type.authority || null,
      cost: input.cost != null ? String(input.cost) : null,
      notes: input.notes || null,
      createdBy: input.userId ?? null,
    })
    .returning();
  return { row, type };
}
