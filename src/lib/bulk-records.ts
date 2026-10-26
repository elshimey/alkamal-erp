import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { errorMessage, findPgError } from "@/lib/errors";
import { deleteRecord, loadRecord, RECORDS, resolveOptions, saveRecord, type FieldDef, type RecordKind } from "@/lib/records";
import type { GridColumn } from "@/components/data-grid";

// التعديل الجماعي لأي كيان معرّف في RECORDS: شيت بكل السجلات، والحفظ يمر على قواعد صفحة التعديل نفسها.

type Row = Record<string, unknown>;
export interface BulkChange {
  id: number;
  values: Record<string, string>;
}
export interface BulkResult {
  saved: number;
  deleted: number;
  errors: Record<number, string>;
  error?: string;
}

/** الكيانات التي لا يناسبها التعديل الجماعي (كلمات مرور، صلاحيات). */
const EXCLUDED = new Set<RecordKind>(["users"]);
export const canBulkEdit = (kind: RecordKind) => !EXCLUDED.has(kind);

const YES_NO = [
  { value: "true", label: "نعم" },
  { value: "false", label: "لا" },
];
const gridFields = (kind: RecordKind) => RECORDS[kind].fields.filter((f) => f.type !== "password");

export async function bulkColumns(kind: RecordKind): Promise<GridColumn[]> {
  return Promise.all(
    gridFields(kind).map(async (f): Promise<GridColumn> => {
      const base = { key: f.key, label: f.label, required: f.required, ltr: f.ltr };
      if (f.readOnly) return { ...base, readOnly: true, width: "11rem" };
      if (f.type === "bool") return { ...base, type: "select", options: YES_NO, width: "6rem" };
      if (f.type === "select") {
        const options = await resolveOptions(f);
        // عرض العمود يتسع لأطول خيار (أنواع الوثائق بأسماء أصحابها مثلاً) دون أن يبالغ
        const longest = Math.max(0, ...options.map((o) => o.label.length));
        return { ...base, type: "select", options, width: `${Math.min(18, Math.max(11, Math.ceil(longest * 0.55)))}rem` };
      }
      if (f.type === "number") return { ...base, type: "number", width: "8rem" };
      if (f.type === "date") return { ...base, type: "date", width: "9rem" };
      // متعدد الاختيار: أسماء مفصولة بفاصلة
      if (f.type === "multi") return { ...base, width: "12rem", placeholder: (await resolveOptions(f)).map((o) => o.label).join("، ") };
      return { ...base, width: f.type === "textarea" ? "16rem" : "10rem" };
    }),
  );
}

async function toCell(f: FieldDef, v: unknown, opts: Map<string, { value: string; label: string }[]>): Promise<string> {
  if (v == null) return "";
  if (f.type === "bool") return v ? "true" : "false";
  if (f.type === "multi") {
    const o = opts.get(f.key) ?? [];
    return (v as string[]).map((x) => o.find((p) => p.value === String(x))?.label ?? String(x)).join("، ");
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** كل السجلات بقيم نصية جاهزة للشيت. */
export async function bulkRows(kind: RecordKind) {
  const def = RECORDS[kind];
  const t = def.table as unknown as typeof s.vehicles;
  const rows = (await db.select().from(t).orderBy(asc(t.id))) as Row[];
  const extra = def.loadAll ? await def.loadAll() : def.load ? new Map(await Promise.all(rows.map(async (r) => [Number(r.id), await def.load!(Number(r.id))] as const))) : null;
  const fields = gridFields(kind);
  const opts = new Map(await Promise.all(fields.filter((f) => f.type === "multi").map(async (f) => [f.key, await resolveOptions(f)] as const)));
  return Promise.all(
    rows.map(async (r) => {
      const id = Number(r.id);
      const full: Row = { ...r, ...(extra?.get(id) ?? {}) };
      if (def.loadAll && !extra?.has(id)) for (const f of fields) if (f.type === "multi") full[f.key] = [];
      return { id, values: Object.fromEntries(await Promise.all(fields.map(async (f) => [f.key, await toCell(f, full[f.key], opts)] as const))) as Record<string, string> };
    }),
  );
}

/** يقرأ قيمة خلية حسب نوع الحقل (نفس قواعد نموذج التعديل). */
async function parseCell(f: FieldDef, raw: string): Promise<unknown> {
  const v = raw.trim();
  if (f.type === "multi") {
    const o = await resolveOptions(f);
    return v
      .split(/[,،]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const hit = o.find((p) => p.label === x || p.value === x);
        if (!hit) throw new Error(`${f.label}: «${x}» غير معروف`);
        return hit.value;
      });
  }
  if (f.type === "bool") return v === "true" || v === "نعم";
  if (!v) {
    if (f.required) throw new Error(`${f.label}: إلزامي`);
    return null;
  }
  if (f.type === "number") {
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n)) throw new Error(`${f.label}: رقم غير صحيح`);
    return n;
  }
  if (f.type === "select") {
    const o = await resolveOptions(f);
    const hit = o.find((p) => p.value === v || p.label === v);
    if (!hit) throw new Error(`${f.label}: «${v}» غير موجود في القائمة`);
    return f.numeric ? Number(hit.value) : hit.value;
  }
  if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${f.label}: تاريخ غير صحيح`);
  return v;
}

/** يحفظ الصفوف المعدّلة ويحذف المحددة؛ كل صف مستقل، والمرفوض يعود بسببه. */
export async function saveBulk(kind: RecordKind, changes: BulkChange[], deletes: number[]): Promise<BulkResult> {
  if (!Array.isArray(changes) || !Array.isArray(deletes) || changes.length + deletes.length > 2000) return { saved: 0, deleted: 0, errors: {}, error: "عدد التغييرات أكبر من المسموح (2000)" };
  const def = RECORDS[kind];
  const fields = new Map(gridFields(kind).map((f) => [f.key, f]));
  const errors: Record<number, string> = {};
  let saved = 0;
  let deleted = 0;
  for (const c of changes) {
    const id = Number(c.id);
    try {
      const current = await loadRecord(kind, id);
      if (!current) throw new Error(`${def.noun} غير موجود`);
      const values: Row = { ...current };
      for (const [key, raw] of Object.entries(c.values ?? {})) {
        const f = fields.get(key);
        if (f && !f.readOnly) values[key] = await parseCell(f, String(raw ?? ""));
      }
      await saveRecord(kind, id, values);
      saved++;
    } catch (err) {
      errors[id] = errorMessage(err);
    }
  }
  for (const raw of deletes) {
    const id = Number(raw);
    try {
      await deleteRecord(kind, id);
      deleted++;
    } catch (err) {
      errors[id] = findPgError(err)?.code === "23503" ? `لا يمكن الحذف لوجود حركات مرتبطة.${def.instead ? ` ${def.instead}.` : ""}` : errorMessage(err);
    }
  }
  return { saved, deleted, errors };
}
