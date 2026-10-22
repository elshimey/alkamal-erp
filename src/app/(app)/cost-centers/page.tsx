import { EditLink } from "@/components/edit-link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { Badge, PageHeader, Table, Td } from "@/components/ui";

const TYPE_LABEL = { vehicle: "مركبة", admin: "إداري", workshop: "ورشة", other: "أخرى" } as const;

export default async function CostCentersPage() {
  await requirePermission("cost_centers", "view");
  const rows = await db.select().from(s.costCenters).orderBy(asc(s.costCenters.type), asc(s.costCenters.code));
  return (
    <>
      <PageHeader title="مراكز التكلفة" description="مركز تكلفة المركبة يُنشأ تلقائياً عند إضافتها، ومنه تخرج ربحية كل مركبة." />
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
