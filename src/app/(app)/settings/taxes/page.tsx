import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { TAX_BEHAVIORS, type TaxBehaviorKey } from "@/data/tax-codes";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { addTaxAction, toggleTaxAction } from "./actions";

const SIDE = { sales: "مبيعات", purchases: "مشتريات", both: "مبيعات ومشتريات" } as const;

export default async function TaxesPage() {
  const user = await requirePermission("settings", "view");
  const edit = can(user.perms, "settings", "update");
  const rows = await db.select().from(s.taxCodes).orderBy(asc(s.taxCodes.sort), asc(s.taxCodes.id));
  const behavior = (b: string | null) => (b && b in TAX_BEHAVIORS ? TAX_BEHAVIORS[b as TaxBehaviorKey] : null);

  return (
    <>
      <PageHeader title="أنواع الضريبة" description="الأسماء كما في وافق حرفياً، فيطابق الاستيراد من Excel ما يصدّره وافق. كل نوع يحدد النسبة وفئة الفوترة الإلكترونية وخانته في الإقرار.">
        <Link href="/settings" className="text-sm text-brand-700 hover:underline">
          → الإعدادات
        </Link>
      </PageHeader>
      <Card>
        <Table head={["الاسم", "يتصرف مثل", "الجهة", "النسبة", "الفوترة الإلكترونية", "خانة الإقرار", ""]}>
          {rows.map((t) => {
            const b = behavior(t.behavior);
            const custom = t.code.startsWith("T");
            return (
              <tr key={t.id}>
                <Td>
                  <span className="font-medium">{t.nameAr}</span>
                  {!t.isActive && (
                    <span className="ms-2">
                      <Badge tone="gray">موقوف</Badge>
                    </span>
                  )}
                </Td>
                <Td>{custom && b ? b.label : "أساسي"}</Td>
                <Td>{SIDE[(t.side as keyof typeof SIDE) ?? "sales"] ?? t.side}</Td>
                <Td className="ltr-nums">{Number(t.rate)}%</Td>
                <Td className="text-xs">{t.category ? `${t.category}${t.exemptionCode ? ` · ${t.exemptionCode}` : ""}` : "—"}</Td>
                <Td className="text-xs">{b?.box ?? "—"}</Td>
                <Td>
                  {edit && custom && (
                    <ActionForm action={toggleTaxAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={t.isActive ? "0" : "1"} />
                      <SubmitButton variant="secondary">{t.isActive ? "إيقاف" : "تفعيل"}</SubmitButton>
                    </ActionForm>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
      {edit && (
        <Card>
          <h2 className="mb-3 font-semibold">إضافة نوع ضريبة</h2>
          <ActionForm action={addTaxAction} resetOnSuccess className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="text-sm">
              الاسم
              <Input name="name" required placeholder="مثل: نقل دولي – عبور" />
            </label>
            <label className="text-sm">
              يتصرف مثل
              <Select name="behavior" required defaultValue="">
                <option value="" disabled>
                  اختر…
                </option>
                {Object.entries(TAX_BEHAVIORS).map(([k, b]) => (
                  <option key={k} value={k}>
                    {b.label} ({b.rate}%)
                  </option>
                ))}
              </Select>
            </label>
            <SubmitButton>إضافة</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-gray-500">النوع المضاف يأخذ نسبة النوع الأساسي وحسابه وفئته وخانته في الإقرار، فلا يتغير منطق القيود. الأنواع الأساسية لا تُوقف.</p>
        </Card>
      )}
    </>
  );
}
