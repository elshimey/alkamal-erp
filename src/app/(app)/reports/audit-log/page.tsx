import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { todayRiyadh } from "@/lib/dates";
import { auditTrail } from "@/lib/reports";
import { TABLES } from "@/lib/export";
import { fieldLabel } from "@/lib/records";
import { C, param, PeriodFilter, periodFrom, ReportHeader, RTable, type ReportParams } from "../report-ui";

const ACTION = { create: "إنشاء", update: "تعديل", delete: "حذف" } as Record<string, string>;
const TABLE = new Map(TABLES);
const LIMIT = 1000;

const show = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60));

/** سجل التدقيق: من أنشأ أو عدّل أو حذف ماذا ومتى، وما الذي تغيّر (للمحاسب والمراجع). */
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requirePermission("financial_reports", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const { from, to } = periodFrom(sp, today);
  const userId = Number(param(sp, "user")) || null;
  const entity = param(sp, "entity") || null;
  const [rows, users] = await Promise.all([auditTrail(db, { from, to, userId, entity, limit: LIMIT }), db.select({ id: s.users.id, name: s.users.name }).from(s.users).orderBy(asc(s.users.name))]);
  return (
    <>
      <ReportHeader title="سجل التدقيق" period={`من ${from} إلى ${to}`} filename={`سجل-التدقيق-${from}-${to}`} wide note="كل إنشاء وتعديل وحذف مع المستخدم والوقت">
        <PeriodFilter from={from} to={to} today={today}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">المستخدم</span>
            <select name="user" defaultValue={userId ?? ""} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">الكل</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">النوع</span>
            <select name="entity" defaultValue={entity ?? ""} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">الكل</option>
              {TABLES.filter(([t]) => t !== "audit_log").map(([t, label]) => (
                <option key={t} value={t}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </PeriodFilter>
      </ReportHeader>
      <RTable name="سجل التدقيق" head={["الوقت", "المستخدم", "العملية", "النوع", "الرقم", "ما تغيّر"]}>
        {rows.length === 0 && (
          <tr>
            <C colSpan={6} className="py-8 text-center text-gray-500">
              لا عمليات في هذه الفترة
            </C>
          </tr>
        )}
        {rows.map((r) => {
          const changes = r.action === "update" && r.changes && typeof r.changes === "object" ? Object.entries(r.changes as Record<string, [unknown, unknown]>) : [];
          return (
            <tr key={r.id}>
              <C className="ltr-nums text-xs whitespace-nowrap">{r.at.toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" })}</C>
              <C className="whitespace-nowrap">{r.user ?? "النظام"}</C>
              <C className={r.action === "delete" ? "text-red-700" : ""}>{ACTION[r.action] ?? r.action}</C>
              <C className="text-xs">{TABLE.get(r.entity) ?? r.entity}</C>
              <C className="ltr-nums text-xs">{r.entityId}</C>
              <C className="text-xs text-gray-600">
                {changes.slice(0, 6).map(([k, [before, after]]) => (
                  <div key={k}>
                    {fieldLabel(k)}: <span className="text-gray-400 line-through">{show(before)}</span> ← {show(after)}
                  </div>
                ))}
                {changes.length > 6 && <div>و{changes.length - 6} خانات أخرى</div>}
              </C>
            </tr>
          );
        })}
      </RTable>
      {rows.length === LIMIT && <p className="mt-2 text-xs text-amber-700">يُعرض آخر {LIMIT} عملية؛ ضيّق الفترة أو اختر مستخدماً أو نوعاً لرؤية الباقي.</p>}
    </>
  );
}
