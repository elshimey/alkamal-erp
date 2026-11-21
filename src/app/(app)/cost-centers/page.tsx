import { EditLink } from "@/components/edit-link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { COST_CENTER_TYPES } from "@/lib/cost-centers";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DialogButton } from "@/components/dialog-button";
import { Badge, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { addCostCenter } from "./actions";

const TYPE_LABEL = { vehicle: "مركبة", admin: "إداري", workshop: "ورشة", other: "أخرى" } as const;

export default async function CostCentersPage() {
  const user = await requirePermission("cost_centers", "view");
  const rows = await db.select().from(s.costCenters).orderBy(asc(s.costCenters.type), asc(s.costCenters.code));
  return (
    <>
      <PageHeader title="مراكز التكلفة" description="مركز تكلفة المركبة يُنشأ تلقائياً عند إضافتها، ومنه تخرج ربحية كل مركبة. وللمقطورات والإدارة والفروع تُضاف مراكز يدوية.">
        {can(user.perms, "cost_centers", "create") && (
          <DialogButton label="+ مركز تكلفة" title="مركز تكلفة جديد" className="!border-brand-600 !bg-brand-600 !px-4 !py-2 !text-sm font-medium !text-white hover:!bg-brand-700">
            <ActionForm action={addCostCenter} className="flex flex-col gap-3 text-sm">
              <Field label="الاسم">
                <Input name="nameAr" required placeholder="مثل: المقطورات" className="w-full" />
              </Field>
              <Field label="الرمز" hint="اختياري؛ فارغ = يُولّد تلقائياً (CC-1)">
                <Input name="code" dir="ltr" maxLength={40} placeholder="TRL" className="w-full" />
              </Field>
              <Field label="النوع">
                <Select name="type" defaultValue="other" className="w-full">
                  {Object.entries(COST_CENTER_TYPES).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">يظهر في الأصول الثابتة والقيود والمصروفات. مركز المركبة لا يُضاف هنا: يُنشأ مع المركبة.</p>
              <SubmitButton>إضافة المركز</SubmitButton>
            </ActionForm>
          </DialogButton>
        )}
      </PageHeader>
      <Table head={["الرمز", "الاسم", "النوع", "الحالة"]}>
        {rows.map((c) => (
          <tr key={c.id}>
            <Td className="text-gray-500">{c.code}</Td>
            <Td>
              {c.nameAr}
              <EditLink href={`/records/cost_centers/${c.id}`} />
            </Td>
            <Td>
              <Badge tone={c.type === "vehicle" ? "blue" : "gray"}>{TYPE_LABEL[c.type]}</Badge>
            </Td>
            <Td>{c.isActive ? "نشط" : "موقوف"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
