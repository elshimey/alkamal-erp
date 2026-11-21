import { RECORDS } from "@/lib/records";
import { FieldInput } from "@/components/record-field";
import { PanelSection } from "@/components/panel-ui";
import { RecordPanel } from "@/components/record-panel";
import { createPartyAction } from "./actions";

const BASIC = ["nameAr", "roles", "kind", "vatNumber", "mobile", "country"];
const DETAILS = ["nameEn", "crNumber", "email", "buildingNo", "street", "district", "city", "postalCode", "additionalNo", "defaultCurrency"];
const DEFAULTS: Record<string, unknown> = { kind: "company", country: "SA", defaultCurrency: "SAR", roles: ["customer"] };

/** نافذة إضافة جهة واحدة (عميل، مورد، ناقل…): الزر الرئيسي في «العملاء والموردون». */
export function PartyPanel({ initial }: { initial?: string }) {
  const def = RECORDS.parties;
  const field = (key: string) => def.fields.find((x) => x.key === key)!;
  const value = (key: string) => (key === "nameAr" && initial ? initial : DEFAULTS[key]);
  return (
    <RecordPanel title="إضافة جهة" subtitle="عميل أو مورد أو ناقل أو مخلص؛ كشف حسابها يظهر بعد الحفظ في بطاقتها" closeHref="/parties" action={createPartyAction} creating>
      <PanelSection title="البيانات الأساسية">
        {BASIC.map((k) => (
          <FieldInput key={k} f={field(k)} value={value(k)} row />
        ))}
      </PanelSection>
      <PanelSection title="العنوان والتفاصيل" optional hint="العنوان الوطني يلزم للفاتورة الضريبية للمنشآت">
        {DETAILS.map((k) => (
          <FieldInput key={k} f={field(k)} value={value(k)} row />
        ))}
      </PanelSection>
    </RecordPanel>
  );
}
