import { notFound } from "next/navigation";
import { db } from "@/db";
import { todayRiyadh } from "@/lib/dates";
import { ownerDocumentFields } from "@/lib/documents";
import { loadRecord, RECORDS } from "@/lib/records";
import { FieldInput } from "@/components/record-field";
import { OwnerDocsFields } from "@/components/owner-docs-fields";
import { PanelSection } from "@/components/panel-ui";
import { PanelLink, RecordPanel } from "@/components/record-panel";
import { saveVehicleAction } from "./actions";

const BASIC = ["plate", "assetKind", "chassis", "assetAccountId"];
const DETAILS = ["vehicleTypeId", "make", "model", "year", "color", "ownership", "ownershipDate", "odometer", "serialNumber", "registrationType", "customsDocument"];
const DEFAULTS: Record<string, unknown> = { assetKind: "head", ownership: "owned" };

/** نافذة إضافة مركبة أو تعديلها: بياناتها ثم وثائقها (الرأس أو المقطورة حسب نوع الأصل). */
export async function VehiclePanel({ id, embed, initial }: { id: number | null; embed?: boolean; initial?: string }) {
  const def = RECORDS.vehicles;
  const row = id ? await loadRecord("vehicles", id) : null;
  if (id && !row) notFound();
  const today = todayRiyadh();
  const [head, trailer] = await Promise.all([
    ownerDocumentFields(db, "vehicle", row?.assetKind === "head" ? id : null, today),
    ownerDocumentFields(db, "trailer", row?.assetKind === "trailer" ? id : null, today),
  ]);
  const field = (key: string) => {
    const f = def.fields.find((x) => x.key === key)!;
    return key === "assetAccountId" ? { ...f, required: true, hint: "حساب الأصل في شجرة الحسابات (1201)" } : f;
  };
  const value = (key: string) => (row ? row[key] : key === "plate" ? initial : DEFAULTS[key]);

  return (
    <RecordPanel
      title={row ? `المركبة ${row.plate}` : "إضافة مركبة"}
      subtitle={row ? "تعديل البيانات والوثائق" : "رأس (شاحنة) أو مقطورة (سطحة)، مع وثائقها"}
      closeHref="/vehicles"
      action={saveVehicleAction.bind(null, id)}
      creating={!id}
      embed={embed}
      footer={id && !embed ? <PanelLink href={`/records/vehicles/${id}`}>سجل التعديلات وحذف المركبة</PanelLink> : undefined}
    >
      <PanelSection title="البيانات الأساسية" hint="مركز التكلفة يُنشأ تلقائياً باسم اللوحة">
        {BASIC.map((k) => (
          <FieldInput key={k} f={field(k)} value={value(k)} row />
        ))}
      </PanelSection>
      <PanelSection title="تفاصيل المركبة" optional open={!!id}>
        {[...DETAILS, ...(id ? ["status"] : [])].map((k) => (
          <FieldInput key={k} f={field(k)} value={value(k)} row />
        ))}
      </PanelSection>
      <PanelSection title="الوثائق" optional open hint="الاستمارة والفحص والتأمين وغيرها">
        <OwnerDocsFields
          switchName="assetKind"
          groups={[
            { when: "head", types: head },
            { when: "trailer", types: trailer },
          ]}
        />
      </PanelSection>
    </RecordPanel>
  );
}
