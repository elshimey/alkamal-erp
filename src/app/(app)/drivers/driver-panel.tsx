import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { todayRiyadh } from "@/lib/dates";
import { ownerDocumentFields } from "@/lib/documents";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { loadRecord, RECORDS } from "@/lib/records";
import { FieldInput } from "@/components/record-field";
import { OwnerDocsFields } from "@/components/owner-docs-fields";
import { PanelField, PanelSection } from "@/components/panel-ui";
import { PanelLink, RecordPanel } from "@/components/record-panel";
import { Input } from "@/components/ui";
import { saveDriverAction } from "./actions";

const BASIC = ["nameAr", "mobile", "nationality", "appLanguage"];
const JOB = ["hireDate", "basicSalary", "commissionClass", "custodyLimit", "nationalId"];
const KNOWN: Record<string, string> = { d_residency: "residencyNumber", d_license: "licenseNumber", d_professional_card: "transportCardNumber" };
const str = (v: unknown) => (v == null ? "" : String(v));

/** نافذة إضافة سائق أو تعديله: بياناته، عمله وراتبه، وثائقه بمرفقاتها، وحساب تطبيق السائق. */
export async function DriverPanel({ id, embed, initial, canLogin }: { id: number | null; embed?: boolean; initial?: string; canLogin: boolean }) {
  const def = RECORDS.drivers;
  const row = id ? await loadRecord("drivers", id) : null;
  if (id && !row) notFound();
  const [docs, user] = await Promise.all([
    ownerDocumentFields(db, "driver", id, todayRiyadh()),
    row?.userId ? db.select({ login: s.users.login }).from(s.users).where(eq(s.users.id, row.userId as number)).then((r) => r[0]) : null,
  ]);
  const field = (key: string) => def.fields.find((x) => x.key === key)!;
  const value = (key: string) => (row ? row[key] : key === "nameAr" ? initial : key === "appLanguage" ? "ar" : key === "commissionClass" ? "domestic" : undefined);

  return (
    <RecordPanel
      title={row ? str(row.nameAr) : "إضافة سائق"}
      subtitle={row ? "تعديل البيانات والوثائق" : "يُنشأ معه موظفه وحساب عهدته وحساب رواتبه تلقائياً"}
      closeHref="/drivers"
      action={saveDriverAction.bind(null, id)}
      creating={!id}
      embed={embed}
      footer={id && !embed ? <PanelLink href={`/drivers/${id}`}>صفحة السائق: كلمة مرور التطبيق والحذف وسجل التعديلات</PanelLink> : undefined}
    >
      <PanelSection title="البيانات الأساسية">
        {BASIC.map((k) => (
          <FieldInput key={k} f={field(k)} value={value(k)} row />
        ))}
      </PanelSection>
      <PanelSection title="العمل والراتب" optional open={!!id}>
        {JOB.map((k) => (
          <FieldInput key={k} f={field(k)} value={value(k)} row />
        ))}
        <PanelField label="تاريخ الميلاد">
          <Input name="birthDate" type="date" defaultValue={str(row?.birthDate)} className="w-full" />
        </PanelField>
        {id && <FieldInput f={field("status")} value={value("status")} row />}
      </PanelSection>
      <PanelSection title="الوثائق" optional open hint="الإقامة والرخصة والبطاقة المهنية وغيرها">
        <OwnerDocsFields groups={[{ types: docs.map((d) => ({ ...d, knownNumber: KNOWN[d.code] ? str(row?.[KNOWN[d.code]]) || null : null })) }]} />
      </PanelSection>
      {canLogin && (
        <PanelSection title="حساب تطبيق السائق" optional open={!!user} hint="يدخل به السائق من جواله">
          {user ? (
            <p className="text-sm text-gray-600">
              حساب الدخول: <b dir="ltr">{user.login}</b>. تغيير كلمة المرور أو حذف الحساب من صفحة السائق.
            </p>
          ) : (
            <>
              <PanelField label="اسم الدخول" hint="الجوال مثلاً">
                <Input name="login" dir="ltr" autoComplete="off" />
              </PanelField>
              <PanelField label="كلمة المرور" hint={`${MIN_PASSWORD_LENGTH} أحرف على الأقل`}>
                <Input name="password" type="text" dir="ltr" autoComplete="off" minLength={MIN_PASSWORD_LENGTH} />
              </PanelField>
              <p className="text-xs text-gray-500">اتركهما فارغين إن لم يحتج السائق التطبيق الآن.</p>
            </>
          )}
        </PanelSection>
      )}
    </RecordPanel>
  );
}
