import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PARTY_ROLES } from "@/data/operations";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { ImportLink } from "@/components/import-link";
import { saveParties } from "./actions";

export default async function PartiesPage() {
  const user = await requirePermission("parties", "view");
  const rows = await db
    .select({
      p: s.parties,
      roles: sql<string[]>`array_agg(${s.partyRoles.role}::text order by ${s.partyRoles.role})`,
    })
    .from(s.parties)
    .leftJoin(s.partyRoles, eq(s.partyRoles.partyId, s.parties.id))
    .groupBy(s.parties.id)
    .orderBy(asc(s.parties.nameAr));

  return (
    <>
      <PageHeader title="جهات الاتصال" description="العملاء والموردون والناقلون والورش والمحطات في جدول واحد، والدور يحدد الاستخدام.">
        {can(user.perms, "parties", "create") && <ImportLink entity="customers" label="استيراد العملاء" />}
      </PageHeader>
      {can(user.perms, "parties", "create") && (
        <Card title="إدخال جهات جديدة" className="mb-6">
          <SheetEditor
            templateName="جهات-الاتصال"
            action={saveParties}
            columns={[
              { key: "nameAr", label: "الاسم", required: true, width: "14rem" },
              { key: "role", label: "الدور", type: "select", required: true, options: Object.entries(PARTY_ROLES).map(([value, label]) => ({ value, label })) },
              { key: "kind", label: "النوع", type: "select", options: [{ value: "company", label: "منشأة" }, { value: "individual", label: "فرد" }] },
              { key: "vatNumber", label: "الرقم الضريبي", ltr: true },
              { key: "crNumber", label: "السجل التجاري", ltr: true },
              { key: "mobile", label: "الجوال", ltr: true },
              { key: "email", label: "البريد", ltr: true, width: "12rem" },
              { key: "country", label: "الدولة", ltr: true, width: "5rem", placeholder: "SA" },
            ]}
          />
        </Card>
      )}
      <Table head={["الاسم", "الأدوار", "الرقم الضريبي", "السجل التجاري", "الجوال", "الدولة"]}>
        {rows.length === 0 && <EmptyRow cols={6}>لا توجد جهات بعد</EmptyRow>}
        {rows.map(({ p, roles }) => (
          <tr key={p.id}>
            <Td className="font-medium">{p.nameAr}</Td>
            <Td>
              <div className="flex flex-wrap gap-1">
                {roles.filter(Boolean).map((r) => (
                  <Badge key={r} tone="blue">
                    {PARTY_ROLES[r as keyof typeof PARTY_ROLES]}
                  </Badge>
                ))}
              </div>
            </Td>
            <Td className="ltr-nums">{p.vatNumber ?? "—"}</Td>
            <Td className="ltr-nums">{p.crNumber ?? "—"}</Td>
            <Td className="ltr-nums">{p.mobile ?? "—"}</Td>
            <Td>{p.country}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
