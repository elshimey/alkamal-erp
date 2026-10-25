import { desc, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { SheetEditor } from "@/components/sheet-editor";
import { Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { saveRates } from "./actions";

export default async function ExchangeRatesPage() {
  const user = await requirePermission("accounts", "view");
  const [currencies, rates] = await Promise.all([
    db.select().from(s.currencies).where(ne(s.currencies.code, "SAR")),
    db.select().from(s.exchangeRates).orderBy(desc(s.exchangeRates.rateDate), s.exchangeRates.currencyCode).limit(200),
  ]);
  const today = todayRiyadh();

  return (
    <>
      <PageHeader title="أسعار الصرف" description="قيمة وحدة واحدة من العملة بالريال. كل حركة تأخذ آخر سعر مسجّل في تاريخها أو قبله." />
      {can(user.perms, "accounts", "update") && (
        <Card title="إدخال أسعار" className="mb-6">
          <SheetEditor
            templateName="أسعار الصرف"
            action={saveRates}
            initialRows={3}
            columns={[
              { key: "currency", label: "العملة", type: "select", required: true, options: currencies.map((c) => ({ value: c.code, label: `${c.code} ${c.nameAr}` })), width: "10rem" },
              { key: "date", label: "التاريخ", type: "date", placeholder: today },
              { key: "rate", label: "السعر بالريال", type: "number", required: true, width: "8rem", placeholder: "12.25" },
            ]}
          />
        </Card>
      )}
      <Table head={["التاريخ", "العملة", "السعر بالريال"]}>
        {rates.length === 0 && <EmptyRow cols={3}>لا توجد أسعار مسجلة</EmptyRow>}
        {rates.map((r) => (
          <tr key={r.id}>
            <Td className="ltr-nums">{r.rateDate}</Td>
            <Td>{r.currencyCode}</Td>
            <Td className="ltr-nums font-semibold">{Number(r.rate)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
