import { fieldLabel, recordHistory } from "@/lib/records";
import { Card } from "@/components/ui";

const ACTION = { create: "أنشأه", update: "عدّله", delete: "حذفه" } as Record<string, string>;
const fmtVal = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "boolean" ? (v ? "نعم" : "لا") : typeof v === "object" ? JSON.stringify(v) : String(v));
const HIDDEN = new Set(["id", "created_at", "updated_at"]);

/** من أنشأ السجل ومن عدّله ومتى، وما الذي تغيّر. */
export async function RecordHistory({ entity, id, also = [], title = "سجل التعديلات" }: { entity: string; id: number | string; also?: [string, number][]; title?: string }) {
  const rows = await recordHistory([[entity, id], ...also]);
  return (
    <Card title={title} className="mb-6">
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">لا توجد تعديلات مسجلة بعد (يبدأ التسجيل من تاريخ تفعيل هذه الميزة).</p>
      ) : (
        <ol className="space-y-3 border-s-2 border-brand-200 ps-4">
          {rows.map((r) => {
            const changes = r.action === "update" && r.changes ? Object.entries(r.changes as Record<string, [unknown, unknown]>).filter(([k]) => !HIDDEN.has(k)) : [];
            return (
              <li key={r.id} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-gray-900">{r.user ?? "النظام"}</span>
                  <span className="text-gray-600">{ACTION[r.action] ?? r.action}</span>
                  <span className="ltr-nums text-xs text-gray-400" dir="ltr">
                    {new Date(r.at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
                {changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                    {changes.map(([k, [a, b]]) => (
                      <li key={k}>
                        {fieldLabel(k)}: <del className="text-red-600/80">{fmtVal(a)}</del> ← <span className="text-green-700">{fmtVal(b)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
