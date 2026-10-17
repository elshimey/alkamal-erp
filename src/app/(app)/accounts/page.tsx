import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { createAccount } from "./actions";

const TYPE_LABEL: Record<string, string> = {
  asset: "أصول",
  liability: "التزامات",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  cost_of_revenue: "تكلفة الإيراد",
  expense: "مصروفات",
};

export default async function AccountsPage() {
  const user = await requirePermission("accounts", "view");
  const rows = await db.select().from(s.accounts).orderBy(asc(s.accounts.code));
  const canCreate = can(user.perms, "accounts", "create");

  return (
    <>
      <PageHeader
        title="شجرة الحسابات"
        description="معيارية وفق IFRS. الترحيل على الحسابات النهائية فقط، والمركبة مركز تكلفة على سطر القيد وليست حساباً."
      />
      {canCreate && (
        <Card title="إضافة حساب فرعي" className="mb-6">
          <ActionForm action={createAccount} className="grid gap-4 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
            <Field label="تحت الحساب">
              <Select name="parentId" required defaultValue="">
                <option value="" disabled>
                  اختر…
                </option>
                {rows
                  .filter((a) => a.level < 4)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.nameAr}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="اسم الحساب">
              <Input name="nameAr" required placeholder="مثال: بنك الراجحي" />
            </Field>
            <Field label="العملة">
              <Select name="currency" defaultValue="">
                <option value="">أي عملة</option>
                <option value="SAR">ريال</option>
                <option value="KWD">دينار كويتي</option>
              </Select>
            </Field>
            <SubmitButton>إضافة</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Table head={["الرمز", "الحساب", "النوع", "الطبيعة", "الترحيل", "ملاحظة"]}>
        {rows.map((a) => (
          <tr key={a.id} className={a.level <= 2 ? "bg-gray-50/70 font-semibold" : ""}>
            <Td className="ltr-nums text-gray-500">{a.code}</Td>
            <Td>
              <span style={{ paddingInlineStart: `${(a.level - 1) * 1.25}rem` }}>{a.nameAr}</span>
            </Td>
            <Td className="text-gray-600">{TYPE_LABEL[a.type]}</Td>
            <Td className="text-gray-600">{a.normalBalance === "debit" ? "مدين" : "دائن"}</Td>
            <Td>
              {a.isPostable ? <Badge tone="green">يقبل الترحيل</Badge> : <Badge>تجميعي</Badge>}
              {a.requiresCostCenter && (
                <span className="ms-1">
                  <Badge tone="blue">مركبة إلزامية</Badge>
                </span>
              )}
              {a.currencyCode && (
                <span className="ms-1">
                  <Badge tone="amber">{a.currencyCode}</Badge>
                </span>
              )}
            </Td>
            <Td className="text-xs text-gray-500">{a.note}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
