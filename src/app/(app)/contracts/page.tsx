import Link from "next/link";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can, hasSpecial } from "@/lib/permissions";
import { customerOptions } from "@/lib/lookups";
import { CONTRACT_STATUS } from "@/data/operations";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { saveContracts } from "./actions";

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const user = await requirePermission("contracts", "view");
  const canCreate = can(user.perms, "contracts", "create");
  const adding = (await searchParams).add === "1" && canCreate;
  const showPrices = hasSpecial(user.perms, "view_prices");
  const [customers, rows] = await Promise.all([
    customerOptions(),
    db
      .select({
        c: s.contracts,
        customer: s.parties.nameAr,
        rates: sql<number>`(select count(*)::int from contract_rates r where r.contract_id = ${s.contracts.id})`,
      })
      .from(s.contracts)
      .innerJoin(s.parties, eq(s.parties.id, s.contracts.customerId))
      .orderBy(asc(s.parties.nameAr), asc(s.contracts.fromDate)),
  ]);

  return (
    <>
      <PageHeader title="العقود" description="عقد العميل وبنود تسعيره. الشحنة تأخذ سعرها من العقد الساري تلقائياً.">
        {!adding && <ListActions bulkHref={can(user.perms, "contracts", "update") && "/records/contracts/bulk"} addHref={canCreate && "/contracts?add=1"} />}
      </PageHeader>
      {adding && <AddModeBar backHref="/contracts" backLabel="العقود" title="إضافة جماعية" />}
      {adding && (
        <Card title="إدخال عقود جديدة" className="mb-6">
          {customers.length === 0 ? (
            <p className="text-sm text-gray-500">
              أضف العملاء أولاً من{" "}
              <Link href="/parties" className="text-brand-700 underline">
                جهات الاتصال
              </Link>
              .
            </p>
          ) : (
            <SheetEditor
              templateName="العقود"
              action={saveContracts}
              initialRows={3}
              columns={[
                { key: "customerId", label: "العميل", type: "select", required: true, options: customers, width: "12rem" },
                { key: "number", label: "رقم العقد", required: true, ltr: true },
                { key: "fromDate", label: "من تاريخ", type: "date", required: true },
                { key: "toDate", label: "إلى تاريخ", type: "date", required: true },
                { key: "currency", label: "العملة", type: "select", options: [{ value: "SAR", label: "ريال" }, { value: "KWD", label: "دينار كويتي" }], width: "6rem" },
                { key: "creditLimit", label: "الحد الائتماني", type: "number" },
                { key: "paymentTermsDays", label: "أيام السداد", type: "number", width: "5rem", placeholder: "30" },
              ]}
            />
          )}
        </Card>
      )}
      {!adding && (
      <Table head={["رقم العقد", "العميل", "من", "إلى", "العملة", "الحد الائتماني", "بنود التسعير", "الحالة"]}>
        {rows.length === 0 && <EmptyRow cols={8}>لا توجد عقود بعد</EmptyRow>}
        {rows.map(({ c, customer, rates }) => (
          <tr key={c.id}>
            <Td className="font-medium">
              <Link href={`/contracts/${c.id}`} className="text-brand-700 hover:underline">
                {c.number}
              </Link>
            </Td>
            <Td>{customer}</Td>
            <Td className="ltr-nums">{c.fromDate}</Td>
            <Td className="ltr-nums">{c.toDate}</Td>
            <Td>{c.currencyCode}</Td>
            <Td className="ltr-nums">{showPrices && c.creditLimit ? Number(c.creditLimit).toLocaleString("en") : "—"}</Td>
            <Td className="ltr-nums">{rates}</Td>
            <Td>
              <Badge tone={CONTRACT_STATUS[c.status].tone}>{CONTRACT_STATUS[c.status].label}</Badge>
            </Td>
          </tr>
        ))}
      </Table>
      )}
    </>
  );
}
