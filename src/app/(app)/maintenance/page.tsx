import Link from "next/link";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { vehicleOptions } from "@/lib/lookups";
import { cashAccounts } from "@/lib/invoices";
import { supplierOptions } from "@/lib/purchases";
import { todayRiyadh } from "@/lib/dates";
import { MAINTENANCE_PROVIDERS, MAINTENANCE_STATUS, MAINTENANCE_TYPES } from "@/data/maintenance";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { MaintenanceTabs } from "./tabs";
import { createOrder } from "./actions";

const fmt = (v: string | number) => Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Status = keyof typeof MAINTENANCE_STATUS;

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ status?: string; vehicle?: string; request?: string; plan?: string; type?: string }> }) {
  const user = await requirePermission("maintenance", "view");
  const sp = await searchParams;
  const status: Status | undefined = sp.status && sp.status in MAINTENANCE_STATUS ? (sp.status as Status) : undefined;
  const where: SQL[] = [];
  if (status) where.push(eq(s.maintenanceOrders.status, status));
  const [vehicles, suppliers, cashes, list] = await Promise.all([
    vehicleOptions(),
    supplierOptions(db),
    cashAccounts(db),
    db
      .select({ o: s.maintenanceOrders, plate: s.vehicles.plate, supplier: s.parties.nameAr, request: s.breakdownRequests.number, plan: s.maintenancePlans.title })
      .from(s.maintenanceOrders)
      .innerJoin(s.vehicles, eq(s.vehicles.id, s.maintenanceOrders.vehicleId))
      .leftJoin(s.parties, eq(s.parties.id, s.maintenanceOrders.supplierId))
      .leftJoin(s.breakdownRequests, eq(s.breakdownRequests.id, s.maintenanceOrders.breakdownRequestId))
      .leftJoin(s.maintenancePlans, eq(s.maintenancePlans.id, s.maintenanceOrders.planId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(s.maintenanceOrders.orderDate), desc(s.maintenanceOrders.id))
      .limit(300),
  ]);

  return (
    <>
      <PageHeader title="الصيانة" description="أمر الصيانة ببنوده (قطع غيار وشغل يد) يُقيد على مركبته عند الاعتماد، والمركبة تبقى «في الصيانة» حتى الإكمال." />
      <MaintenanceTabs active="orders" />
      {can(user.perms, "maintenance", "create") && (
        <Card title="أمر صيانة جديد" className="mb-6">
          <ActionForm action={createOrder} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="breakdownRequestId" value={sp.request ?? ""} />
            <input type="hidden" name="planId" value={sp.plan ?? ""} />
            <Field label="المركبة">
              <Select name="vehicleId" defaultValue={sp.vehicle ?? ""} required>
                <option value="">اختر</option>
                {vehicles.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="التاريخ">
              <Input name="orderDate" type="date" defaultValue={todayRiyadh()} />
            </Field>
            <Field label="النوع">
              <Select name="type" defaultValue={sp.type ?? "mechanical"}>
                {Object.entries(MAINTENANCE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الجهة">
              <Select name="provider" defaultValue="external">
                {Object.entries(MAINTENANCE_PROVIDERS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="الورشة / المورد" hint="للجهة الخارجية: تصبح دائنة بقيمة الأمر">
              <Select name="supplierId" defaultValue="">
                <option value="">—</option>
                {suppliers.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="رقم فاتورة الورشة">
              <Input name="supplierInvoiceNo" className="ltr-nums" />
            </Field>
            <Field label="أو الصندوق" hint="للورشة الداخلية: القطع تُشترى منه">
              <Select name="cashAccountId" defaultValue="">
                <option value="">—</option>
                {cashes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nameAr}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="قراءة العداد">
              <Input name="odometer" type="number" min={0} />
            </Field>
            <Field label="ملاحظات">
              <Input name="notes" />
            </Field>
            <div className="flex items-end">
              <SubmitButton>إنشاء الأمر وإضافة البنود</SubmitButton>
            </div>
          </ActionForm>
          {(sp.request || sp.plan) && <p className="mt-3 text-xs text-brand-700">الأمر مرتبط {sp.request ? "بطلب العطل المختار" : "بالخطة الدورية المختارة"}.</p>}
        </Card>
      )}

      <nav className="mb-4 flex flex-wrap gap-2 text-sm">
        {[{ key: undefined, label: "الكل" }, ...(Object.keys(MAINTENANCE_STATUS) as Status[]).map((k) => ({ key: k, label: MAINTENANCE_STATUS[k].label }))].map((t) => (
          <Link
            key={t.label}
            href={t.key ? `/maintenance?status=${t.key}` : "/maintenance"}
            className={`rounded-full px-3.5 py-1.5 transition ${t.key === status ? "bg-asphalt-900 font-semibold text-brand-500" : "bg-white text-gray-600 shadow-sm hover:bg-brand-50"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Table head={["الرقم", "التاريخ", "المركبة", "النوع", "الجهة", "المصدر", "الإجمالي", "الحالة"]}>
        {list.length === 0 && <EmptyRow cols={8}>لا توجد أوامر صيانة</EmptyRow>}
        {list.map(({ o, plate, supplier, request, plan }) => (
          <tr key={o.id}>
            <Td className="font-medium whitespace-nowrap">
              <Link href={`/maintenance/${o.id}`} className="ltr-nums text-brand-700 hover:underline">
                {o.number}
              </Link>
            </Td>
            <Td className="ltr-nums whitespace-nowrap">{o.orderDate}</Td>
            <Td className="font-medium">{plate}</Td>
            <Td>{MAINTENANCE_TYPES[o.type]}</Td>
            <Td>{supplier ?? MAINTENANCE_PROVIDERS.internal}</Td>
            <Td className="text-xs">{request ? `طلب ${request}` : plan ? `دورية: ${plan}` : "—"}</Td>
            <Td className="ltr-nums font-semibold">{fmt(o.total)}</Td>
            <Td>
              <Badge tone={MAINTENANCE_STATUS[o.status].tone}>{MAINTENANCE_STATUS[o.status].label}</Badge>
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
