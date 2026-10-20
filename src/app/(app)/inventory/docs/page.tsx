import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listStockDocs, onHand, stockDoc } from "@/lib/inventory";
import { STOCK_DOC_KINDS, type StockDocKind } from "@/data/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Badge, EmptyRow, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { postDoc, removeDoc, revertDoc, saveCounted } from "../actions";

const fmt = (v: number | string) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qfmt = (v: number | string) => Number(v).toLocaleString("en", { maximumFractionDigits: 3 });

export default async function StockDocsPage({ searchParams }: { searchParams: Promise<{ kind?: string; open?: string; from?: string; to?: string }> }) {
  const user = await requirePermission("inventory", "view");
  const sp = await searchParams;
  const kind = sp.kind && sp.kind in STOCK_DOC_KINDS ? (sp.kind as StockDocKind) : undefined;
  const openId = Number(sp.open) || null;
  const [list, doc] = await Promise.all([listStockDocs(db, { kind, from: sp.from, to: sp.to }), openId ? stockDoc(db, openId) : Promise.resolve(null)]);
  // الجرد المسودة يعرض الرصيد الحالي ليُقارن بالمعدود
  const current = doc && doc.d.kind === "count" && doc.d.status === "draft" ? await Promise.all(doc.lines.map((l) => onHand(db, l.l.productId, doc.d.warehouseId))) : [];
  const canPost = can(user.perms, "inventory", "approve");
  const canRevert = can(user.perms, "inventory", "revert");
  const canDelete = can(user.perms, "inventory", "delete");
  const canEdit = can(user.perms, "inventory", "update");
  const href = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ kind: sp.kind, from: sp.from, to: sp.to, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/inventory/docs${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <PageHeader title="مستندات المخزون" description="التسويات والتحويلات والجرد. المسودة لا تمس الأرصدة حتى ترحيلها.">
        <div className="flex gap-2">
          {Object.entries(STOCK_DOC_KINDS).map(([k, v]) => (
            <Link key={k} href={`/inventory/docs/new?kind=${k}`} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
              + {v.label}
            </Link>
          ))}
        </div>
      </PageHeader>

      <form action="/inventory/docs" className="mb-4 flex flex-wrap items-center gap-2">
        <Select name="kind" defaultValue={sp.kind ?? ""} className="w-48">
          <option value="">كل الأنواع</option>
          {Object.entries(STOCK_DOC_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={sp.from} className="w-40" />
        <Input type="date" name="to" defaultValue={sp.to} className="w-40" />
        <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">تصفية</button>
      </form>

      {doc && (
        <section className="animate-flyout mb-6 rounded-2xl bg-gray-100/70 shadow-inner">
          <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
            <Link href={href({ open: undefined })} scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <Icon name="close" className="size-4" />
            </Link>
            <span className="ltr-nums font-display text-lg font-semibold text-brand-900">{doc.d.number}</span>
            <span className="text-sm">{STOCK_DOC_KINDS[doc.d.kind].label}</span>
            <Badge tone={doc.d.status === "posted" ? "green" : "amber"}>{doc.d.status === "posted" ? "مرحّل" : "مسودة"}</Badge>
            <span className="text-xs text-gray-500">
              <span className="ltr-nums">{doc.d.docDate}</span> · {doc.warehouse.nameAr}
              {doc.toWarehouse && <> ← {doc.toWarehouse.nameAr}</>}
              {doc.d.reason && <> · {doc.d.reason}</>}
              {doc.entry && (
                <>
                  {" · "}
                  <Link href={`/journal?open=${doc.d.journalEntryId}`} className="ltr-nums text-brand-700 hover:underline">
                    {doc.entry}
                  </Link>
                </>
              )}
            </span>
            <div className="ms-auto flex flex-wrap gap-2">
              {doc.d.status === "draft" && canPost && doc.d.kind !== "count" && (
                <ActionForm action={postDoc.bind(null, doc.d.id)} resetOnSuccess={false}>
                  <SubmitButton>ترحيل</SubmitButton>
                </ActionForm>
              )}
              {doc.d.status === "posted" && canRevert && (
                <ActionForm action={revertDoc.bind(null, doc.d.id)} resetOnSuccess={false}>
                  <SubmitButton variant="secondary">إرجاع لمسودة</SubmitButton>
                </ActionForm>
              )}
            </div>
          </div>
          <div className="p-5">
            {doc.d.kind === "count" && doc.d.status === "draft" && canEdit ? (
              <ActionForm action={saveCounted.bind(null, doc.d.id)} resetOnSuccess={false}>
                <div className="overflow-auto rounded-xl bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="p-2 text-start">الرمز</th>
                        <th className="p-2 text-start">الصنف</th>
                        <th className="p-2 text-start">رصيد النظام</th>
                        <th className="p-2 text-start">المعدود</th>
                        <th className="p-2 text-start">الوحدة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.lines.map((l, i) => (
                        <tr key={l.l.id} className="border-t border-gray-100">
                          <td className="ltr-nums p-2">{l.code}</td>
                          <td className="p-2">{l.name}</td>
                          <td className="ltr-nums p-2">{qfmt(current[i])}</td>
                          <td className="p-2">
                            <Input name={`c_${l.l.id}`} inputMode="decimal" defaultValue={l.l.countedQty == null ? "" : Number(l.l.countedQty)} placeholder="لم يُعد" className="w-28" />
                          </td>
                          <td className="p-2 text-xs">{l.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <SubmitButton>حفظ الكميات</SubmitButton>
                  {canPost && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="post" value="1" /> وترحيل الفروقات
                    </label>
                  )}
                  <span className="text-xs text-gray-500">الصنف الذي تُرك فارغاً لا يتغير رصيده.</span>
                </div>
              </ActionForm>
            ) : (
              <div className="overflow-auto rounded-xl bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="p-2 text-start">الرمز</th>
                      <th className="p-2 text-start">الصنف</th>
                      {doc.d.kind === "count" && <th className="p-2 text-start">النظام</th>}
                      {doc.d.kind === "count" && <th className="p-2 text-start">المعدود</th>}
                      <th className="p-2 text-start">{doc.d.kind === "count" ? "الفرق" : "الكمية"}</th>
                      <th className="p-2 text-start">تكلفة الوحدة</th>
                      <th className="p-2 text-start">القيمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l) => (
                      <tr key={l.l.id} className="border-t border-gray-100">
                        <td className="ltr-nums p-2">{l.code}</td>
                        <td className="p-2">{l.name}</td>
                        {doc.d.kind === "count" && <td className="ltr-nums p-2">{l.l.systemQty == null ? "" : qfmt(l.l.systemQty)}</td>}
                        {doc.d.kind === "count" && <td className="ltr-nums p-2">{l.l.countedQty == null ? "—" : qfmt(l.l.countedQty)}</td>}
                        <td className={`ltr-nums p-2 font-medium ${Number(l.l.quantity) < 0 ? "text-red-700" : ""}`}>
                          {qfmt(l.l.quantity)} {l.unit}
                        </td>
                        <td className="ltr-nums p-2">{fmt(l.l.unitCost)}</td>
                        <td className="ltr-nums p-2">{fmt(Number(l.l.quantity) * Number(l.l.unitCost))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {doc.d.status === "draft" && canDelete && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-red-700">حذف المسودة</summary>
                <ActionForm action={removeDoc.bind(null, doc.d.id)} className="mt-2 flex gap-2">
                  <Input name="reason" required placeholder="سبب الحذف" />
                  <SubmitButton variant="secondary">حذف</SubmitButton>
                </ActionForm>
              </details>
            )}
          </div>
        </section>
      )}

      <Table head={["الرقم", "التاريخ", "النوع", "المستودع", "السبب", "السطور", "القيمة", "الحالة"]}>
        {list.length === 0 && <EmptyRow cols={8}>لا مستندات</EmptyRow>}
        {list.map(({ d, warehouse, toWarehouse, lines, value }) => (
          <tr key={d.id} className={d.id === openId ? "bg-brand-50/70" : undefined}>
            <Td>
              <Link href={href({ open: String(d.id) })} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                {d.number}
              </Link>
            </Td>
            <Td className="ltr-nums whitespace-nowrap">{d.docDate}</Td>
            <Td>{STOCK_DOC_KINDS[d.kind].label}</Td>
            <Td>
              {warehouse}
              {toWarehouse && <> ← {toWarehouse}</>}
            </Td>
            <Td className="text-xs text-gray-600">{d.reason ?? "—"}</Td>
            <Td className="ltr-nums">{lines}</Td>
            <Td className="ltr-nums">{d.status === "posted" ? fmt(value) : "—"}</Td>
            <Td>
              <Badge tone={d.status === "posted" ? "green" : "amber"}>{d.status === "posted" ? "مرحّل" : "مسودة"}</Badge>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
