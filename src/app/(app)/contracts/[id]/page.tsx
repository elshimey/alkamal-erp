import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can, hasSpecial } from "@/lib/permissions";
import { routeOptions, vehicleOptions, vehicleTypeOptions } from "@/lib/lookups";
import { CONTRACT_STATUS, PRICING_METHODS } from "@/data/operations";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { changeStatus, deleteRate, saveRates } from "../actions";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("contracts", "view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [row] = await db
    .select({ c: s.contracts, customer: s.parties.nameAr })
    .from(s.contracts)
    .innerJoin(s.parties, eq(s.parties.id, s.contracts.customerId))
    .where(eq(s.contracts.id, id));
  if (!row) notFound();
  const { c, customer } = row;
  const [rates, routes, types, vehicles] = await Promise.all([
    db.select().from(s.contractRates).where(eq(s.contractRates.contractId, id)),
    routeOptions(),
    vehicleTypeOptions(),
    vehicleOptions(),
  ]);
  const name = (opts: { value: string; label: string }[], v: number | null) => (v == null ? "—" : (opts.find((o) => o.value === String(v))?.label ?? "—"));
  const showPrices = hasSpecial(user.perms, "view_prices");
  const canEdit = can(user.perms, "contracts", "update");
  const canApprove = can(user.perms, "contracts", "approve");

  return (
    <>
      <PageHeader title={`العقد ${c.number}`} description={`${customer} · من ${c.fromDate} إلى ${c.toDate} · ${c.currencyCode} · السداد خلال ${c.paymentTermsDays} يوماً`}>
        <div className="flex items-center gap-3">
          <Badge tone={CONTRACT_STATUS[c.status].tone}>{CONTRACT_STATUS[c.status].label}</Badge>
          {canApprove && c.status !== "active" && (
            <ActionForm action={changeStatus.bind(null, id, "active")} resetOnSuccess={false}>
              <SubmitButton>تفعيل العقد</SubmitButton>
            </ActionForm>
          )}
          {canApprove && c.status === "active" && (
            <ActionForm action={changeStatus.bind(null, id, "suspended")} resetOnSuccess={false}>
              <SubmitButton variant="secondary">إيقاف</SubmitButton>
            </ActionForm>
          )}
          <Link href="/contracts" className="text-sm text-brand-700 hover:underline">
            ← العقود
          </Link>
        </div>
      </PageHeader>
      {canEdit && (
        <Card title="إضافة بنود تسعير" className="mb-6">
          <SheetEditor
            templateName={`بنود-العقد-${c.number}`}
            action={saveRates.bind(null, id)}
            initialRows={4}
            columns={[
              { key: "method", label: "طريقة التسعير", type: "select", required: true, width: "12rem", options: Object.entries(PRICING_METHODS).map(([value, label]) => ({ value, label })) },
              { key: "routeId", label: "المسار", type: "select", options: routes, width: "14rem" },
              { key: "vehicleTypeId", label: "نوع المركبة", type: "select", options: types },
              { key: "vehicleId", label: "المركبة", type: "select", options: vehicles },
              { key: "price", label: `السعر (${c.currencyCode})`, type: "number", required: true },
              { key: "unit", label: "الوحدة (للكمية)", placeholder: "طن، كرتون…", width: "7rem" },
            ]}
          />
          <p className="mt-2 text-xs text-gray-500">
            المسار إلزامي للسعر الثابت ونقل السيارات والمركبة المحددة. نوع المركبة إلزامي لطريقة ريال/كم، والسعر فيها لكل كيلومتر.
          </p>
        </Card>
      )}
      <Table head={["الطريقة", "المسار", "نوع المركبة", "المركبة", "السعر", "الوحدة", ""]}>
        {rates.length === 0 && <EmptyRow cols={7}>لا توجد بنود تسعير بعد</EmptyRow>}
        {rates.map((r) => (
          <tr key={r.id}>
            <Td>{PRICING_METHODS[r.method]}</Td>
            <Td>{name(routes, r.routeId)}</Td>
            <Td>{name(types, r.vehicleTypeId)}</Td>
            <Td>{name(vehicles, r.vehicleId)}</Td>
            <Td className="ltr-nums font-medium">{showPrices ? Number(r.price).toLocaleString("en") : "••••"}</Td>
            <Td>{r.unit ?? "—"}</Td>
            <Td>
              {canEdit && (
                <form action={deleteRate.bind(null, id, r.id)}>
                  <button className="text-xs text-red-600 hover:underline">حذف</button>
                </form>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
