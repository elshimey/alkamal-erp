import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { PARTY_ROLES } from "@/data/operations";
import { SheetEditor } from "@/components/sheet-editor";
import { PageHeader } from "@/components/ui";
import { saveParties } from "../actions";

export default async function BulkAddPartiesPage() {
  await requirePermission("parties", "create");
  return (
    <>
      <PageHeader title="إضافة جماعية لجهات الاتصال" description="اكتب الجهات مباشرة أو الصقها من Excel، ثم اضغط «حفظ الكل». الصفوف المرفوضة تبقى مع سبب الرفض.">
        <Link href="/parties" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          العودة للقائمة
        </Link>
      </PageHeader>
      <SheetEditor
        templateName="جهات-الاتصال"
        action={saveParties}
        initialRows={10}
        columns={[
          { key: "nameAr", label: "الاسم", required: true, width: "14rem" },
          { key: "role", label: "الدور", type: "select", required: true, options: Object.entries(PARTY_ROLES).map(([value, label]) => ({ value, label })) },
          { key: "kind", label: "النوع", type: "select", options: [{ value: "company", label: "منشأة" }, { value: "individual", label: "فرد" }] },
          { key: "vatNumber", label: "الرقم الضريبي", ltr: true },
          { key: "crNumber", label: "السجل التجاري", ltr: true },
          { key: "city", label: "المدينة" },
          { key: "district", label: "الحي" },
          { key: "street", label: "الشارع" },
          { key: "buildingNo", label: "رقم المبنى", ltr: true, width: "6rem" },
          { key: "postalCode", label: "الرمز البريدي", ltr: true, width: "6rem" },
          { key: "mobile", label: "الجوال", ltr: true },
          { key: "email", label: "البريد", ltr: true, width: "12rem" },
          { key: "country", label: "الدولة", ltr: true, width: "5rem", placeholder: "SA" },
        ]}
      />
    </>
  );
}
