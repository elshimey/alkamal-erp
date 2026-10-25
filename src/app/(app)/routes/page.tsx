import { EditLink } from "@/components/edit-link";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { countryOptions, locationOptions } from "@/lib/lookups";
import { YES_NO } from "@/data/operations";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { saveLocations, saveRoutes } from "./actions";

export default async function RoutesPage() {
  const user = await requirePermission("routes", "view");
  const canCreate = can(user.perms, "routes", "create");
  const [countries, locations, allLocations, routes] = await Promise.all([countryOptions(), locationOptions(), locationOptions({ includeHidden: true }), db.select().from(s.routes)]);
  const label = new Map(allLocations.map((l) => [l.value, l.label]));
  const sorted = routes
    .map((r) => ({ ...r, fromLabel: label.get(String(r.fromLocationId)) ?? "", toLabel: label.get(String(r.toLocationId)) ?? "" }))
    .sort((a, b) => a.fromLabel.localeCompare(b.fromLabel, "ar") || a.toLabel.localeCompare(b.toLabel, "ar"));

  return (
    <>
      <PageHeader title="المواقع والمسارات" description="المسار يحدد المسافة والعمولة الافتراضية للسائق، ويصبح دولياً تلقائياً إذا اختلفت الدولتان." />
      {canCreate && (
        <div className="mb-6 grid gap-6 xl:grid-cols-[2fr_3fr]">
          <Card title="المدن والمواقع">
            <SheetEditor
              templateName="المواقع"
              action={saveLocations}
              initialRows={4}
              columns={[
                { key: "countryId", label: "الدولة", type: "select", required: true, options: countries, width: "7rem" },
                { key: "city", label: "المدينة", required: true },
                { key: "site", label: "الموقع (اختياري)", placeholder: "ميناء، مصنع، منفذ…" },
                { key: "border", label: "منفذ حدودي", type: "select", options: YES_NO, width: "6rem" },
              ]}
            />
          </Card>
          <Card title="المسارات">
            <SheetEditor
              templateName="المسارات"
              action={saveRoutes}
              initialRows={4}
              columns={[
                { key: "from", label: "من", type: "select", required: true, options: locations, width: "10rem" },
                { key: "to", label: "إلى", type: "select", required: true, options: locations, width: "10rem" },
                { key: "distanceKm", label: "المسافة (كم)", type: "number", width: "6rem" },
                { key: "driverCommission", label: "عمولة السائق", type: "number", width: "6rem" },
                { key: "diesel", label: "الديزل التقديري (لتر)", type: "number", width: "7rem" },
              ]}
            />
          </Card>
        </div>
      )}
      <Table head={["من", "إلى", "المسافة", "النوع", "عمولة السائق", "الديزل التقديري"]}>
        {sorted.length === 0 && <EmptyRow cols={6}>لا توجد مسارات بعد</EmptyRow>}
        {sorted.map((r) => (
          <tr key={r.id}>
            <Td className="font-medium">{r.fromLabel}</Td>
            <Td className="font-medium">{r.toLabel}</Td>
            <Td className="ltr-nums">{r.distanceKm != null ? `${r.distanceKm.toLocaleString("en")} كم` : "—"}</Td>
            <Td>
              {r.isInternational ? <Badge tone="amber">دولي</Badge> : <Badge>داخلي</Badge>}
              {!r.isActive && (
                <span className="ms-1" title="أُضيف من مستند دون حفظه؛ لا يظهر في القوائم. فعّله من زر التعديل">
                  <Badge tone="gray">مخفي</Badge>
                </span>
              )}
            </Td>
            <Td className="ltr-nums">{Number(r.driverCommission).toLocaleString("en")}</Td>
            <Td className="ltr-nums">
              {r.estimatedDieselLiters ?? "—"}
              <EditLink href={`/records/routes/${r.id}`} />
            </Td>
          </tr>
        ))}
      </Table>
      {allLocations.length > 0 && (
        <Card title="المدن والمواقع المسجلة" className="mt-6">
          <div className="flex flex-wrap gap-2">
            {allLocations.map((l) => (
              <span key={l.value} className={`rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm ${locations.some((x) => x.value === l.value) ? "" : "opacity-50"}`}>
                {l.label}
                <EditLink href={`/records/locations/${l.value}`} />
              </span>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
