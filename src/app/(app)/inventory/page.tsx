import { EditLink } from "@/components/edit-link";
import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listProducts, listStockDocs, listWarehouses } from "@/lib/inventory";
import { STOCK_DOC_KINDS } from "@/data/inventory";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Input, PageHeader } from "@/components/ui";
import { addWarehouse } from "./actions";

const fmt = (v: number | string) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function InventoryPage() {
  const user = await requirePermission("inventory", "view");
  const [warehouses, low, docs] = await Promise.all([listWarehouses(db), listProducts(db, { kind: "stock", low: true }), listStockDocs(db)]);
  const total = warehouses.reduce((t, w) => t + Number(w.value), 0);
  const canCreate = can(user.perms, "inventory", "create");

  return (
    <>
      <PageHeader title="المخزون والمستودعات" description="أرصدة قطع الغيار في كل مستودع بقيمتها، والتسويات والتحويلات والجرد. القيمة تطابق حساب المخزون 1110 في الميزانية.">
        <div className="rounded-2xl bg-asphalt-900 px-5 py-3 text-white">
          <div className="text-xs text-white/70">قيمة المخزون</div>
          <div className="ltr-nums font-display text-xl font-semibold">{fmt(total)}</div>
        </div>
      </PageHeader>

      {canCreate && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {Object.entries(STOCK_DOC_KINDS).map(([k, v]) => (
            <Link key={k} href={`/inventory/docs/new?kind=${k}`} className="group rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-md">
              <div className="font-semibold text-brand-900 group-hover:text-brand-700">+ {v.label}</div>
              <div className="mt-1 text-xs text-gray-500">{v.hint}</div>
            </Link>
          ))}
        </div>
      )}

      <h2 className="mb-3 font-semibold text-brand-900">المستودعات</h2>
      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {warehouses.map(({ w, items, value }) => (
          <article key={w.id} className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">
                  {w.nameAr}
                  <EditLink href={`/records/warehouses/${w.id}`} />
                </div>
                <div className="ltr-nums text-xs text-gray-500">
                  {w.code}
                  {w.location && <> · {w.location}</>}
                </div>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{items} صنف</span>
            </div>
            <div className="ltr-nums mt-4 font-display text-2xl font-semibold text-brand-900">{fmt(value)}</div>
            <div className="mt-3 flex gap-3 border-t border-gray-100 pt-3 text-xs">
              <Link href={`/products?wh=${w.id}&kind=stock`} className="text-brand-700 hover:underline">
                الأرصدة
              </Link>
              <Link href={`/inventory/docs/new?kind=count&wh=${w.id}`} className="text-brand-700 hover:underline">
                جرد
              </Link>
            </div>
          </article>
        ))}
        {canCreate && (
          <Card title="مستودع جديد">
            <ActionForm action={addWarehouse} className="grid gap-2">
              <Input name="nameAr" required placeholder="اسم المستودع" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="code" placeholder="الرمز (اختياري)" dir="ltr" />
                <Input name="location" placeholder="الموقع" />
              </div>
              <SubmitButton>إضافة</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-brand-900">
            أصناف تحتاج إعادة طلب <Badge tone={low.length ? "amber" : "green"}>{low.length}</Badge>
          </h2>
          {low.length === 0 && <p className="text-sm text-gray-500">كل الأصناف فوق حد إعادة الطلب.</p>}
          <ul className="divide-y divide-gray-100 text-sm">
            {low.slice(0, 12).map((r) => (
              <li key={r.p.id} className="flex justify-between py-2">
                <Link href={`/products?open=${r.p.id}`} className="text-brand-700 hover:underline">
                  {r.p.nameAr}
                </Link>
                <span className="ltr-nums text-amber-700">
                  {r.qty} / {Number(r.p.reorderLevel)} {r.p.unit}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-brand-900">آخر مستندات المخزون</h2>
            <Link href="/inventory/docs" className="text-xs text-brand-700 hover:underline">
              الكل
            </Link>
          </div>
          {docs.length === 0 && <p className="text-sm text-gray-500">لا مستندات بعد.</p>}
          <ul className="divide-y divide-gray-100 text-sm">
            {docs.slice(0, 8).map(({ d, warehouse, toWarehouse }) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/inventory/docs?open=${d.id}`} className="ltr-nums text-brand-700 hover:underline">
                  {d.number}
                </Link>
                <span className="flex-1 text-xs text-gray-600">
                  {STOCK_DOC_KINDS[d.kind].label} · {warehouse}
                  {toWarehouse && <> ← {toWarehouse}</>}
                </span>
                <Badge tone={d.status === "posted" ? "green" : "amber"}>{d.status === "posted" ? "مرحّل" : "مسودة"}</Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
