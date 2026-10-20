import Link from "next/link";
import { and, asc, eq, like, or } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { assetSchedule, listAssets } from "@/lib/assets";
import { todayRiyadh } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Icon } from "@/components/icons";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { addAsset, depreciate, dispose, removeAsset, undoDepreciation } from "./actions";

const fmt = (v: number | string) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const life = (m: number) => (m % 12 === 0 ? `${m / 12} سنوات` : `${m} شهراً`);

export default async function FixedAssetsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const user = await requirePermission("fixed_assets", "view");
  const sp = await searchParams;
  const openId = Number(sp.open) || null;
  const postable = (prefix: string) => and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true), like(s.accounts.code, `${prefix}%`));
  const [rows, categories, vehicles, centers, offsets, proceeds] = await Promise.all([
    listAssets(db),
    db.select().from(s.accounts).where(postable("1201")).orderBy(asc(s.accounts.code)),
    db.select({ id: s.vehicles.id, plate: s.vehicles.plate }).from(s.vehicles).orderBy(asc(s.vehicles.plate)),
    db.select({ id: s.costCenters.id, nameAr: s.costCenters.nameAr }).from(s.costCenters).orderBy(asc(s.costCenters.code)),
    db.select().from(s.accounts).where(or(postable("1101"), postable("1102"), postable("21"), postable("3104"))).orderBy(asc(s.accounts.code)),
    db.select().from(s.accounts).where(or(postable("1101"), postable("1102"), postable("1103"))).orderBy(asc(s.accounts.code)),
  ]);
  const open = rows.find((r) => r.a.id === openId) ?? null;
  const schedule = open ? await assetSchedule(db, open.a.id) : [];
  const active = rows.filter((r) => r.a.status === "active");
  const totals = active.reduce((t, r) => ({ cost: t.cost + Number(r.a.cost), acc: t.acc + r.accumulated, book: t.book + r.book, monthly: t.monthly + (r.book > Number(r.a.salvageValue) ? r.monthly : 0) }), { cost: 0, acc: 0, book: 0, monthly: 0 });
  const today = todayRiyadh();
  const canCreate = can(user.perms, "fixed_assets", "create");
  const canRun = can(user.perms, "fixed_assets", "approve");
  const canUpdate = can(user.perms, "fixed_assets", "update");
  const canDelete = can(user.perms, "fixed_assets", "delete");
  const lastRun = rows.reduce<string | null>((m, r) => (r.lastPeriod && (!m || r.lastPeriod > m) ? r.lastPeriod : m), null);

  return (
    <>
      <PageHeader title="الأصول الثابتة" description="سجل الأصول وإهلاكها الشهري بالقسط الثابت. قيد الإهلاك يُحمّل على مركز تكلفة الأصل (المركبة) فيظهر في ربحيتها.">
        {canRun && (
          <div className="flex flex-wrap items-end gap-2">
            <ActionForm action={depreciate} resetOnSuccess={false} className="flex flex-wrap items-end gap-2">
              <Field label="إهلاك حتى شهر">
                <Input type="month" name="upTo" defaultValue={today.slice(0, 7)} className="w-40" />
              </Field>
              <SubmitButton pendingLabel="جارٍ الإهلاك…">تشغيل الإهلاك</SubmitButton>
            </ActionForm>
            {lastRun && (
              <ActionForm action={undoDepreciation} resetOnSuccess={false}>
                <SubmitButton variant="secondary" pendingLabel="جارٍ الإلغاء…">
                  إلغاء إهلاك {lastRun.slice(0, 7)}
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </PageHeader>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ["التكلفة", totals.cost],
          ["مجمع الإهلاك", totals.acc],
          ["القيمة الدفترية", totals.book],
          ["الإهلاك الشهري", totals.monthly],
        ].map(([label, v]) => (
          <div key={label} className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="ltr-nums font-display text-xl font-semibold text-brand-900">{fmt(v)}</div>
          </div>
        ))}
      </div>

      {open && (
        <section className="animate-flyout mb-6 rounded-2xl bg-gray-100/70 shadow-inner">
          <div className="flex flex-wrap items-center gap-3 rounded-t-2xl border-b border-gray-200 bg-white px-5 py-3">
            <Link href="/fixed-assets" scroll={false} aria-label="إغلاق المعاينة" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <Icon name="close" className="size-4" />
            </Link>
            <span className="ltr-nums font-display text-lg font-semibold text-brand-900">{open.a.number}</span>
            <span className="font-medium">{open.a.nameAr}</span>
            <Badge tone={open.a.status === "active" ? "green" : "gray"}>{open.a.status === "active" ? "قيد الاستخدام" : `مستبعد ${open.a.disposalDate}`}</Badge>
          </div>
          <div className="grid gap-6 p-5 lg:grid-cols-[1fr_1fr]">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {[
                ["الفئة", `${open.code} ${open.account}`],
                ["المركبة / المركز", open.plate ?? open.costCenter ?? "—"],
                ["تاريخ الاقتناء", open.a.acquisitionDate],
                ["بداية الإهلاك", open.a.depreciationStart],
                ["التكلفة", fmt(open.a.cost)],
                ["قيمة الخردة", fmt(open.a.salvageValue)],
                ["العمر الإنتاجي", life(open.a.usefulLifeMonths)],
                ["الإهلاك الشهري", fmt(open.monthly)],
                ["إهلاك سابق (افتتاحي)", fmt(open.a.openingDepreciation)],
                ["مجمع الإهلاك", fmt(open.accumulated)],
                ["القيمة الدفترية", fmt(open.book)],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="ltr-nums font-medium">{v}</dd>
                </div>
              ))}
              {open.a.notes && <dd className="col-span-2 text-xs text-gray-500">{open.a.notes}</dd>}
            </dl>
            <div>
              <h3 className="mb-2 text-sm font-semibold">جدول الإهلاك المرحّل</h3>
              <div className="max-h-64 overflow-auto rounded-xl bg-white">
                <table className="w-full text-sm">
                  <tbody>
                    {schedule.length === 0 && (
                      <tr>
                        <td className="p-3 text-gray-500">لم يُهلك بعد</td>
                      </tr>
                    )}
                    {schedule.map((d) => (
                      <tr key={d.periodEnd} className="border-b border-gray-100">
                        <td className="ltr-nums px-3 py-1.5">{d.periodEnd.slice(0, 7)}</td>
                        <td className="ltr-nums px-3 py-1.5">{fmt(d.amount)}</td>
                        <td className="px-3 py-1.5">
                          <Link href={`/journal?open=${d.entryId}`} className="ltr-nums text-brand-700 hover:underline">
                            {d.entry}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {open.a.status === "active" && canUpdate && (
                <details className="mt-4 rounded-xl bg-white p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-gray-700">استبعاد الأصل (بيع أو تخريد)</summary>
                  <ActionForm action={dispose.bind(null, open.a.id)} className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field label="التاريخ">
                      <Input type="date" name="date" defaultValue={today} />
                    </Field>
                    <Field label="مبلغ البيع">
                      <Input name="proceeds" inputMode="decimal" placeholder="0.00" />
                    </Field>
                    <Field label="استُلم في">
                      <Select name="proceedsAccountId" defaultValue="">
                        <option value="">— تخريد بلا مقابل —</option>
                        {proceeds.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.nameAr}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <p className="col-span-full text-xs text-gray-500">يُقفل الأصل ومجمع إهلاكه، والفرق بين المبلغ والقيمة الدفترية ربح (4202) أو خسارة (7104). شغّل إهلاك شهر الاستبعاد أولاً.</p>
                    <div>
                      <SubmitButton>استبعاد</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              )}
              {canDelete && schedule.length === 0 && open.a.status === "active" && (
                <details className="mt-2 rounded-xl bg-white p-3 text-sm">
                  <summary className="cursor-pointer text-red-700">حذف الأصل</summary>
                  <ActionForm action={removeAsset.bind(null, open.a.id)} className="mt-3 flex items-end gap-2">
                    <Input name="reason" required placeholder="سبب الحذف" />
                    <SubmitButton variant="secondary">حذف</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </div>
          </div>
        </section>
      )}

      <Table head={["الرقم", "الأصل", "الفئة", "المركبة / المركز", "التكلفة", "العمر", "الإهلاك الشهري", "مجمع الإهلاك", "القيمة الدفترية", "آخر إهلاك", "الحالة"]}>
        {rows.length === 0 && <EmptyRow cols={11}>لا توجد أصول بعد</EmptyRow>}
        {rows.map((r) => (
          <tr key={r.a.id} className={r.a.id === openId ? "bg-brand-50/70" : undefined}>
            <Td>
              <Link href={`/fixed-assets?open=${r.a.id}`} scroll={false} className="ltr-nums text-brand-700 hover:underline">
                {r.a.number}
              </Link>
            </Td>
            <Td className="font-medium">{r.a.nameAr}</Td>
            <Td className="text-xs text-gray-600">{r.account}</Td>
            <Td className="ltr-nums">{r.plate ?? r.costCenter ?? "—"}</Td>
            <Td className="ltr-nums">{fmt(r.a.cost)}</Td>
            <Td>{life(r.a.usefulLifeMonths)}</Td>
            <Td className="ltr-nums">{fmt(r.monthly)}</Td>
            <Td className="ltr-nums">{fmt(r.accumulated)}</Td>
            <Td className="ltr-nums font-semibold">{fmt(r.book)}</Td>
            <Td className="ltr-nums">{r.lastPeriod?.slice(0, 7) ?? "—"}</Td>
            <Td>
              <Badge tone={r.a.status === "active" ? "green" : "gray"}>{r.a.status === "active" ? "قيد الاستخدام" : "مستبعد"}</Badge>
            </Td>
          </tr>
        ))}
      </Table>

      {canCreate && (
        <Card title="إضافة أصل" className="mt-6">
          <ActionForm action={addAsset} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="اسم الأصل">
              <Input name="nameAr" required placeholder="مثل: شاحنة مرسيدس أكتروس 2024" />
            </Field>
            <Field label="الفئة">
              <Select name="assetAccountId" required defaultValue="">
                <option value="" disabled>
                  اختر
                </option>
                {categories.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.nameAr}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="المركبة" hint="للشاحنات والمقطورات؛ الإهلاك على مركزها">
              <Select name="vehicleId" defaultValue="">
                <option value="">—</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="أو مركز التكلفة">
              <Select name="costCenterId" defaultValue="">
                <option value="">—</option>
                {centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameAr}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="تاريخ الاقتناء">
              <Input type="date" name="acquisitionDate" required defaultValue={today} />
            </Field>
            <Field label="بداية الإهلاك" hint="افتراضياً شهر الاقتناء">
              <Input type="date" name="depreciationStart" />
            </Field>
            <Field label="التكلفة">
              <Input name="cost" required inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="قيمة الخردة">
              <Input name="salvageValue" inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="العمر الإنتاجي (سنوات)">
              <Input name="lifeYears" required inputMode="decimal" defaultValue="5" />
            </Field>
            <Field label="إهلاك سابق" hint="لأصل قديم: المجمع حتى بداية الإهلاك هنا">
              <Input name="openingDepreciation" inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="قيد الاقتناء مقابل" hint="اتركه فارغاً إن كان الشراء مقيداً من فاتورة مورد">
              <Select name="offsetAccountId" defaultValue="">
                <option value="">— بدون قيد —</option>
                {offsets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.nameAr}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ملاحظات">
              <Input name="notes" />
            </Field>
            <div className="flex items-end">
              <SubmitButton>إضافة الأصل</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
