import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { BLOCKING, OWNER_KINDS, ownerDocuments, ownerKey, ownerLabel, parseOwnerKey, STATE_LABEL, type DocState } from "@/lib/documents";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DocumentFileInput } from "@/components/document-file-input";
import { EditLink } from "@/components/edit-link";
import { ExpiryBadge } from "@/components/expiry-badge";
import { Badge, Card, PageHeader } from "@/components/ui";
import { DocumentForm } from "../../document-form";
import { addDocumentAction, attachDocumentAction } from "../../actions";

const TONE: Record<DocState, "green" | "amber" | "red" | "gray" | "blue"> = { valid: "green", soon: "amber", expired: "red", missing: "red", none: "gray" };

export default async function OwnerDocumentsPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ add?: string; saved?: string }> }) {
  const user = await requirePermission("fleet_documents", "view");
  const parsed = parseOwnerKey(decodeURIComponent((await params).key).replace("-", ":"));
  if (!parsed) notFound();
  const sp = await searchParams;
  const today = todayRiyadh();
  const owner = await ownerLabel(db, parsed.kind, parsed.id);
  if (!owner) notFound();
  const rows = await ownerDocuments(db, parsed.kind, parsed.id, today);
  const canCreate = can(user.perms, "fleet_documents", "create");
  const canUpdate = can(user.perms, "fleet_documents", "update");
  const key = ownerKey(parsed.kind, parsed.id);
  const self = `/fleet-documents/owner/${parsed.kind}-${parsed.id}`;
  const addType = sp.add ?? "";
  const issues = rows.filter((r) => r.state === "expired" || r.state === "missing").length;

  return (
    <>
      <PageHeader title={`وثائق ${owner.label}`} description={`${OWNER_KINDS[parsed.kind].label}. ${issues ? `وثائق منتهية أو ناقصة: ${issues}.` : "كل الوثائق الإلزامية مسجلة وسارية."}`}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {owner.href && (
            <Link href={owner.href} className="text-brand-700 hover:underline">
              بيانات {OWNER_KINDS[parsed.kind].label}
            </Link>
          )}
          <Link href={`/fleet-documents?kind=${parsed.kind}`} className="text-brand-700 hover:underline">
            → سجل الوثائق
          </Link>
        </div>
      </PageHeader>

      {sp.saved && <p className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">حُفظت الوثيقة.</p>}

      {canCreate && addType !== "" && (
        <Card title={rows.find((r) => String(r.type.id) === addType)?.current ? "تجديد الوثيقة" : "إضافة وثيقة"} className="mb-6">
          <DocumentForm
            action={addDocumentAction}
            owners={[{ value: key, label: owner.label }]}
            types={rows.filter((r) => r.type.isActive).map((r) => ({ id: r.type.id, nameAr: r.type.nameAr, ownerKind: r.type.ownerKind, authority: r.type.authority }))}
            defaultOwner={key}
            defaultType={addType === "new" ? "" : addType}
            fixedOwner
          />
          <p className="mt-3 text-xs text-gray-500">التجديد يُسجَّل وثيقة جديدة، وتبقى السابقة في التاريخ أدناه.</p>
        </Card>
      )}

      <div className="grid gap-3">
        {rows.length === 0 && <Card>لا توجد أنواع وثائق لهذا الصاحب؛ أضفها من إعدادات أنواع الوثائق.</Card>}
        {rows.map(({ type, current, history, state }) => (
          <section key={type.id} className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-48 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-brand-900">{type.nameAr}</span>
                  {current ? (
                    <ExpiryBadge expiryDate={current.doc.expiryDate} today={today} alertDays={type.alertDays} />
                  ) : (
                    <Badge tone={TONE[state]}>{STATE_LABEL[state]}</Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {type.required ? "إلزامية" : "اختيارية"} · {BLOCKING[type.blocking]}
                </div>
              </div>
              {current && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <Item label="الرقم" value={current.doc.number} ltr />
                  <Item label="الإصدار" value={current.doc.issueDate} ltr />
                  <Item label="الانتهاء" value={current.doc.expiryDate ?? "لا تنتهي"} ltr />
                  <Item label="الجهة" value={current.doc.authority} />
                </dl>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {current?.attachmentId && (
                  <a href={`/files/${current.attachmentId}`} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-brand-700 hover:bg-brand-50">
                    📎 عرض المرفق
                  </a>
                )}
                {current && <EditLink href={`/records/fleet_documents/${current.doc.id}`} />}
                {canCreate && type.isActive && (
                  <Link
                    href={`${self}?add=${type.id}`}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${current ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50" : "bg-brand-600 text-brand-900 hover:bg-brand-500"}`}
                  >
                    {current ? "تجديد" : "+ إضافة"}
                  </Link>
                )}
              </div>
            </div>
            {current && !current.attachmentId && canUpdate && (
              <ActionForm action={attachDocumentAction} className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-gray-200 pt-3">
                <input type="hidden" name="id" value={current.doc.id} />
                <span className="text-xs text-amber-700">لا يوجد مرفق.</span>
                <DocumentFileInput label="اختر صورة أو PDF" />
                <SubmitButton variant="secondary">إرفاق</SubmitButton>
              </ActionForm>
            )}
            {history.length > 0 && (
              <details className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-600">
                <summary className="cursor-pointer select-none text-gray-500">الوثائق السابقة ({history.length})</summary>
                <ul className="mt-2 space-y-1">
                  {history.map((h) => (
                    <li key={h.doc.id} className="flex flex-wrap items-center gap-3">
                      <span className="ltr-nums">{h.doc.number ?? "بلا رقم"}</span>
                      <span className="ltr-nums">
                        {h.doc.issueDate ?? "—"} ← {h.doc.expiryDate ?? "—"}
                      </span>
                      {h.doc.cost && <span className="ltr-nums">رسوم {Number(h.doc.cost).toLocaleString("en")}</span>}
                      {h.attachmentId && (
                        <a href={`/files/${h.attachmentId}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                          📎
                        </a>
                      )}
                      <EditLink href={`/records/fleet_documents/${h.doc.id}`} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

function Item({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className={ltr ? "ltr-nums" : ""}>{value || "—"}</dd>
    </div>
  );
}
