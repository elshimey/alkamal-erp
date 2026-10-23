import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listStatements } from "@/lib/fuel-cards";
import { partyOptions } from "@/lib/lookups";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { newStatement } from "./actions";
import { fmt } from "@/lib/format";

export default async function FuelCardsPage() {
  const user = await requirePermission("fuel_cards", "view");
  const [rows, stations] = await Promise.all([listStatements(db), partyOptions("fuel_station")]);
  const canCreate = can(user.perms, "fuel_cards", "create");

  return (
    <>
      <PageHeader title="مطابقة بطاقات الوقود" description="الصق كشف مزود البطاقات (الدريس، ساسكو…) فيطابقه النظام مع تعبئات «بطاقة وقود» المسجلة في الشحنات، ويظهر ما خُصم ولم يُسجل وما سُجل ولم يظهر في الكشف." />

      <div className="mb-8">
        <Table head={["الكشف", "المزود", "الفترة", "السطور", "الإجمالي", "غير مطابق", "الحالة"]}>
          {rows.length === 0 && <EmptyRow cols={7}>لا توجد كشوف بعد</EmptyRow>}
          {rows.map(({ st, provider, lines, total, open }) => (
            <tr key={st.id}>
              <Td className="ltr-nums font-medium">
                <Link href={`/fuel-cards/${st.id}`} className="text-brand-700 hover:underline">
                  {st.number}
                </Link>
              </Td>
              <Td>{provider ?? "—"}</Td>
              <Td className="ltr-nums whitespace-nowrap">
                {st.periodFrom} ← {st.periodTo}
              </Td>
              <Td className="ltr-nums">{lines}</Td>
              <Td className="ltr-nums">{fmt(total)}</Td>
              <Td className="ltr-nums">{open ? <span className="font-semibold text-amber-700">{open}</span> : "—"}</Td>
              <Td>{st.status === "reconciled" ? <Badge tone="green">مُطابق</Badge> : <Badge tone="amber">مفتوح</Badge>}</Td>
            </tr>
          ))}
        </Table>
      </div>

      {canCreate && (
        <Card title="كشف جديد">
          <ActionForm action={newStatement} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="المزود" hint="جهة بدور «محطة وقود»">
              <Select name="providerId" defaultValue="">
                <option value="">—</option>
                {stations.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="من تاريخ">
              <Input name="periodFrom" type="date" required />
            </Field>
            <Field label="إلى تاريخ">
              <Input name="periodTo" type="date" required />
            </Field>
            <Field label="الرصيد الختامي في الكشف" hint="اختياري؛ يُقارن برصيد 1106">
              <Input name="closingBalance" inputMode="decimal" dir="ltr" />
            </Field>
            <label className="col-span-full text-sm">
              <span className="mb-1 block font-medium text-gray-700">سطور الكشف</span>
              <span className="mb-2 block text-xs text-gray-500">
                انسخ من ملف Excel الأعمدة بهذا الترتيب والصقها هنا: التاريخ | رقم اللوحة | المحطة | المرجع | اللترات | المبلغ شامل الضريبة. صف العناوين يُتجاهل.
              </span>
              <textarea
                name="lines"
                required
                rows={8}
                dir="ltr"
                placeholder={"05/10/2026\tأ ب ج 1234\tالدريس – الدمام\t884512\t250\t575.00"}
                className="ltr-nums w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
              />
            </label>
            <Field label="ملاحظات">
              <Input name="notes" />
            </Field>
            <div className="col-span-full">
              <SubmitButton>حفظ ومطابقة تلقائية</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
