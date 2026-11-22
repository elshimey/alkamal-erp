import Link from "next/link";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { EditLink } from "@/components/edit-link";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { countryOptions, locationOptions } from "@/lib/lookups";
import { YES_NO } from "@/data/operations";
import { SheetEditor } from "@/components/sheet-editor";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { DocCards, sheetPrimary } from "@/components/doc-card";
import { Facts, RecordCardFace, TapCard } from "@/components/list-card";
import { saveLocations, saveRoutes } from "./actions";

export default async function RoutesPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const user = await requirePermission("routes", "view");
  const canCreate = can(user.perms, "routes", "create");
  const canEdit = can(user.perms, "routes", "update");
  const adding = (await searchParams).add === "1" && canCreate;
  const [countries, locations, allLocations, routes] = await Promise.all([countryOptions(), locationOptions(), locationOptions({ includeHidden: true }), db.select().from(s.routes)]);
  const label = new Map(allLocations.map((l) => [l.value, l.label]));
  const sorted = routes
    .map((r) => ({ ...r, fromLabel: label.get(String(r.fromLocationId)) ?? "", toLabel: label.get(String(r.toLocationId)) ?? "" }))
    .sort((a, b) => a.fromLabel.localeCompare(b.fromLabel, "ar") || a.toLabel.localeCompare(b.toLabel, "ar"));

  return (
    <>
      <PageHeader title="المواقع والمسارات" description="المسار يحدد المسافة والعمولة الافتراضية للسائق، ويصبح دولياً تلقائياً إذا اختلفت الدولتان.">
        {!adding && <ListActions bulkHref={canEdit && "/records/routes/bulk"} addHref={canCreate && "/routes?add=1"} addLabel="إضافة مدن ومسارات" />}
      </PageHeader>
      {adding && <AddModeBar backHref="/routes" backLabel="المواقع والمسارات" title="إضافة مدن ومسارات" />}
      {adding && (
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
      {!adding && (
      <>
      <DocCards empty="لا توجد مسارات بعد">
        {sorted.map((r) => {
          const kind = r.isInternational ? "دولي" : "داخلي";
          const status = r.isActive ? { label: kind, tone: (r.isInternational ? "amber" : "gray") as "amber" | "gray" } : { label: "مخفي", tone: "gray" as const };
          const sub = [kind, r.distanceKm != null ? `${r.distanceKm.toLocaleString("en")} كم` : null].filter(Boolean).join(" · ");
          const facts: [string, React.ReactNode][] = [
            ["عمولة السائق", <span key="c" className="ltr-nums">{Number(r.driverCommission).toLocaleString("en")}</span>],
            ["الديزل التقديري", r.estimatedDieselLiters != null ? `${r.estimatedDieselLiters} لتر` : "—"],
          ];
          const name = `${r.fromLabel} ← ${r.toLabel}`;
          return (
            <TapCard
              key={r.id}
              tone={status.tone}
              label={`المسار ${name}`}
              face={<RecordCardFace avatar="↔" name={name} sub={sub} status={status} facts={facts} />}
              header={<RecordCardFace avatar="↔" name={name} sub={sub} status={status} />}
              details={<Facts items={facts} />}
              footer={
                canEdit ? (
                  <a href={`/records/routes/${r.id}`} className={sheetPrimary}>
                    تعديل المسار
                  </a>
                ) : undefined
              }
            />
          );
        })}
      </DocCards>
      <div className="max-md:hidden">
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
      </div>
      {allLocations.length > 0 && (
        <Card title="المدن والمواقع المسجلة" className="mt-6">
          {canEdit && (
            <Link href="/records/locations/bulk" className="mb-3 inline-block text-xs text-brand-700 hover:underline">
              تعديل جماعي للمدن والمواقع
            </Link>
          )}
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
      )}
    </>
  );
}
