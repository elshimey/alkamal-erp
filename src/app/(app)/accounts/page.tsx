import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { FormCombo } from "@/components/form-combo";
import { toAccountOptions } from "@/lib/lookups";
import { AccountsTree } from "./accounts-tree";
import { createAccount } from "./actions";
import { AddModeBar, ListActions } from "@/components/list-actions";


export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ add?: string; parent?: string }> }) {
  const user = await requirePermission("accounts", "view");
  const rows = await db.select().from(s.accounts).orderBy(asc(s.accounts.code));
  const canCreate = can(user.perms, "accounts", "create");

  const sp = await searchParams;
  const adding = sp.add === "1" && !!canCreate;
  const parents = adding ? await toAccountOptions(rows.filter((a) => a.level < 4 && a.isActive)) : [];
  return (
    <>
      <PageHeader
        title="شجرة الحسابات"
        description="معيارية وفق IFRS بأربعة مستويات. اضغط على المجموعة لفتحها أو طيها. الترحيل على الحسابات النهائية فقط، والمركبة مركز تكلفة على سطر القيد وليست حساباً.">
        {!adding && <ListActions newHref={(canCreate) && "/accounts?add=1"} newLabel="إضافة حساب فرعي" />}
      </PageHeader>
      {adding && <AddModeBar backHref="/accounts" backLabel="شجرة الحسابات" title="إضافة حساب فرعي" />}
      {adding && (
        <Card className="mb-6">
          <ActionForm action={createAccount} className="grid gap-4 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
            <Field label="تحت الحساب">
              <FormCombo name="parentId" required options={parents} defaultValue={sp.parent ?? ""} placeholder="ابحث باسم الحساب الأب أو رقمه…" />
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
      {!adding && <AccountsTree rows={rows} canCreate={canCreate} />}
    </>
  );
}
