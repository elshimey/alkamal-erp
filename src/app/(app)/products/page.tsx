import Link from "next/link";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SOURCE_HREF, listProducts, productCard, stockByWarehouse } from "@/lib/inventory";
import { isExpenseAccount } from "@/data/purchases";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { ImportLink } from "@/components/import-link";
import { Badge, Card, EmptyRow, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { ProductFields } from "./product-fields";
import { addProduct, editProduct } from "./actions";

const fmt = (v: number | string) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qfmt = (v: number) => v.toLocaleString("en", { maximumFractionDigits: 3 });

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; wh?: string; low?: string; open?: string }> }) {
  const user = await requirePermission("inventory", "view");
  const sp = await searchParams;
  const warehouseId = Number(sp.wh) || null;
  const kind = sp.kind === "stock" || sp.kind === "service" ? sp.kind : undefined;
  const openId = Number(sp.open) || null;
  const postable = and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true));
  const [rows, warehouses, accounts, cats, byWh] = await Promise.all([
    listProducts(db, { q: sp.q, kind, warehouseId, low: sp.low === "1" }),
    db.select().from(s.warehouses).orderBy(asc(s.warehouses.code)),
    db.select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr }).from(s.accounts).where(postable).orderBy(asc(s.accounts.code)),
    db.selectDistinct({ c: s.products.category }).from(s.products).where(isNotNull(s.products.category)),
    stockByWarehouse(db),
  ]);
  const open = rows.find((r) => r.p.id === openId) ?? null;
  const card = open?.p.kind === "stock" ? await productCard(db, open.p.id, warehouseId) : [];
  const stockAccounts = accounts.filter((a) => a.code.startsWith("11"));
  const serviceAccounts = accounts.filter((a) => isExpenseAccount(a.code));
  const categories = cats.map((c) => c.c!).sort();
  const canCreate = can(user.perms, "inventory", "create");
  const canEdit = can(user.perms, "inventory", "update");
  const stock = rows.filter((r) => r.p.kind === "stock");
  const total = stock.reduce((t, r) => t + r.value, 0);
  const lowCount = stock.filter((r) => r.low).length;
  const href = (o: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ q: sp.q, kind: sp.kind, wh: sp.wh, low: sp.low, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/products${q.size ? `?${q}` : ""}`;
  };
  const whName = (id: number) => warehouses.find((w) => w.id === id)?.nameAr ?? "";

  return (
    <>
      <PageHeader title="الأصناف والخدمات" description="قطع الغيار والزيوت والإطارات بأرصدتها ومتوسط تكلفتها، والخدمات التي تُستخدم في فواتير الموردين وأوامر الصيانة.">
        <div className="flex flex-wrap items-center gap-2">
          <ImportLink entity="products" />
          <Link href="/inventory" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
            المخزون والمستودعات
          </Link>
        </div>
      </PageHeader>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">قيمة المخزون{warehouseId ? ` – ${whName(warehouseId)}` : ""}</div>
          <div className="ltr-nums font-display text-xl font-semibold text-brand-900">{fmt(total)}</div>
        </div>
        <div className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">الأصناف المخزنية / الخدمات</div>
          <div className="ltr-nums font-display text-xl font-semibold text-brand-900">
            {stock.length} / {rows.length - stock.length}
          </div>
        </div>
        <Link href={href({ low: sp.low === "1" ? undefined : "1" })} className={`rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 ${lowCount ? "border-amber-300 bg-amber-50" : "border-black/[0.06] bg-white"}`}>
          <div className="text-xs text-gray-500">وصلت حد إعادة الطلب</div>
          <div className={`ltr-nums font-display text-xl font-semibold ${lowCount ? "text-amber-700" : "text-brand-900"}`}>{lowCount}</div>
        </Link>
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/products">
        <Input name="q" defaultValue={sp.q} placeholder="ابحث بالاسم أو الرمز أو الفئة" className="w-64" />
        <Select name="kind" defaultValue={sp.kind ?? ""} className="w-36">
          <option value="">كل الأنواع</option>
          <option value="stock">أصناف مخزنية</option>
          <option value="service">خدمات</option>
        </Select>
        <Select name="wh" defaultValue={sp.wh ?? ""} className="w-44">
          <option value="">كل المستودعات</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.nameAr}
            </option>
          ))}
        </Select>
        {sp.low === "1" && <input type="hidden" name="low" value="1" />}
        <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">تصفية</button>
        <span className="ms-auto text-xs text-gray-400">{rows.length} صنف</span>
      </form>

      {open && (
        <section className="animate-flyout mb-6 rounded-2xl bg-gray-100/70 shadow-inner">
          <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
            <Link href={href({ open: undefined })} scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <Icon name="close" className="size-4" />
            </Link>
            <span className="ltr-nums font-display text-lg font-semibold text-brand-900">{open.p.code}</span>
            <span className="font-medium">{open.p.nameAr}</span>
            <Badge tone={open.p.kind === "stock" ? "blue" : "gray"}>{open.p.kind === "stock" ? "مخزني" : "خدمة"}</Badge>
            {!open.p.isActive && <Badge tone="red">موقوف</Badge>}
            {open.p.kind === "stock" && (
              <span className="ms-auto text-sm text-gray-600">
                الرصيد <b className="ltr-nums">{qfmt(open.qty)}</b> {open.p.unit} · المتوسط <b className="ltr-nums">{fmt(open.avgCost)}</b>
              </span>
            )}
          </div>
          <div className="grid gap-6 p-5 lg:grid-cols-[1.3fr_1fr]">
            {open.p.kind === "stock" ? (
              <div>
                <div className="mb-2 flex flex-wrap gap-2 text-xs">
                  {byWh
                    .filter((b) => Number(b.product_id) === open.p.id)
                    .map((b) => (
                      <span key={b.warehouse_id} className="rounded-full bg-white px-3 py-1 shadow-sm">
                        {whName(Number(b.warehouse_id))}: <b className="ltr-nums">{qfmt(Number(b.qty))}</b>
                      </span>
                    ))}
                </div>
                <h3 className="mb-2 text-sm font-semibold">كرت الصنف{warehouseId ? ` – ${whName(warehouseId)}` : ""}</h3>
                <div className="max-h-80 overflow-auto rounded-xl bg-white">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="p-2 text-start">التاريخ</th>
                        <th className="p-2 text-start">البيان</th>
                        <th className="p-2 text-start">المستودع</th>
                        <th className="p-2 text-start">وارد</th>
                        <th className="p-2 text-start">صادر</th>
                        <th className="p-2 text-start">الرصيد</th>
                        <th className="p-2 text-start">القيمة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-4 text-center text-gray-500">
                            لا حركات بعد
                          </td>
                        </tr>
                      )}
                      {card.map(({ m, warehouse, balance, balanceValue }) => (
                        <tr key={m.id} className="border-t border-gray-100">
                          <td className="ltr-nums p-2 whitespace-nowrap">{m.moveDate}</td>
                          <td className="p-2">
                            <Link href={SOURCE_HREF[m.sourceType]?.(m.sourceId) ?? "#"} className="text-brand-700 hover:underline">
                              {m.description}
                            </Link>
                          </td>
                          <td className="p-2 text-xs">{warehouse}</td>
                          <td className="ltr-nums p-2 text-green-700">{Number(m.quantity) > 0 ? qfmt(Number(m.quantity)) : ""}</td>
                          <td className="ltr-nums p-2 text-red-700">{Number(m.quantity) < 0 ? qfmt(-Number(m.quantity)) : ""}</td>
                          <td className="ltr-nums p-2 font-medium">{qfmt(balance)}</td>
                          <td className="ltr-nums p-2">{fmt(balanceValue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600">الخدمة لا رصيد لها؛ تُختار في فواتير الموردين وأوامر الصيانة فيُقترح حسابها ووصفها.</p>
            )}
            {canEdit && (
              <div className="rounded-xl bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold">تعديل الصنف</h3>
                <ActionForm action={editProduct.bind(null, open.p.id)} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-2">
                  <ProductFields p={open.p} stockAccounts={stockAccounts} serviceAccounts={serviceAccounts} categories={categories} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isActive" defaultChecked={open.p.isActive} /> نشط
                  </label>
                  <div className="col-span-full">
                    <SubmitButton>حفظ</SubmitButton>
                  </div>
                </ActionForm>
              </div>
            )}
          </div>
        </section>
      )}

      <Table head={["الرمز", "الصنف", "الفئة", "الوحدة", "الرصيد", "متوسط التكلفة", "القيمة", "سعر الشراء", ""]}>
        {rows.length === 0 && <EmptyRow cols={9}>{sp.q || sp.kind || sp.low ? "لا أصناف بهذه الشروط" : "لا أصناف بعد؛ أضفها أدناه أو استوردها من Excel"}</EmptyRow>}
        {rows.map((r) => (
          <tr key={r.p.id} className={r.p.id === openId ? "bg-brand-50/70" : !r.p.isActive ? "opacity-60" : undefined}>
            <Td>
              <Link href={href({ open: String(r.p.id) })} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                {r.p.code}
              </Link>
            </Td>
            <Td className="font-medium">{r.p.nameAr}</Td>
            <Td className="text-xs text-gray-600">{r.p.category ?? "—"}</Td>
            <Td className="text-xs">{r.p.unit}</Td>
            <Td className={`ltr-nums font-semibold ${r.low ? "text-amber-700" : ""}`}>{r.p.kind === "stock" ? qfmt(r.qty) : "—"}</Td>
            <Td className="ltr-nums">{r.p.kind === "stock" ? fmt(r.avgCost) : "—"}</Td>
            <Td className="ltr-nums">{r.p.kind === "stock" ? fmt(r.value) : "—"}</Td>
            <Td className="ltr-nums">{fmt(r.p.purchasePrice)}</Td>
            <Td>{r.p.kind === "service" ? <Badge>خدمة</Badge> : r.low ? <Badge tone="amber">أعد الطلب</Badge> : null}</Td>
          </tr>
        ))}
      </Table>

      {canCreate && (
        <Card title="إضافة صنف أو خدمة" className="mt-6">
          <ActionForm action={addProduct} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ProductFields stockAccounts={stockAccounts} serviceAccounts={serviceAccounts} categories={categories} />
            <div className="flex items-end">
              <SubmitButton>إضافة</SubmitButton>
            </div>
          </ActionForm>
          <p className="mt-3 text-xs text-gray-500">الرصيد يدخل من فواتير الموردين (اختر الصنف والمستودع والكمية في السطر)، أو بتسوية افتتاحية من مستندات المخزون.</p>
        </Card>
      )}
    </>
  );
}
