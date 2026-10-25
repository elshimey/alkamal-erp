import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { documentRegister, listDocumentTypes, OWNER_KINDS, ownerKey, type OwnerKind } from "@/lib/documents";
import { ExpiryBadge } from "@/components/expiry-badge";
import { EditLink } from "@/components/edit-link";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { DocumentForm } from "./document-form";
import { addDocumentAction } from "./actions";

const KINDS = Object.keys(OWNER_KINDS) as OwnerKind[];

export default async function DocumentRegisterPage({ searchParams }: { searchParams: Promise<{ add?: string; kind?: string; owner?: string; type?: string; state?: string }> }) {
  const user = await requirePermission("fleet_documents", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const canCreate = can(user.perms, "fleet_documents", "create");
  const adding = sp.add === "1" && canCreate;
  const view = sp.kind === "all" ? "all" : KINDS.includes(sp.kind as OwnerKind) ? (sp.kind as OwnerKind) : "vehicle";
  const [register, types, [{ pending }]] = await Promise.all([
    documentRegister(db, today),
    listDocumentTypes(db, { activeOnly: true }),
    db.select({ pending: sql<number>`count(*)::int` }).from(s.documentSubmissions).where(eq(s.documentSubmissions.status, "pending")),
  ]);

  if (adding) {
    return (
      <>
        <PageHeader title="سجل الوثائق" />
        <AddModeBar backHref="/fleet-documents" backLabel="سجل الوثائق" title="إضافة وثيقة" />
        <Card>
          <DocumentForm
            action={addDocumentAction}
            owners={register.map((o) => ({ value: ownerKey(o.kind, o.id), label: `${o.label} · ${OWNER_KINDS[o.kind].label}` }))}
            types={types.map((t) => ({ id: t.id, nameAr: t.nameAr, ownerKind: t.ownerKind, authority: t.authority }))}
            defaultOwner={sp.owner ?? ""}
            defaultType={sp.type ?? ""}
          />
        </Card>
      </>
    );
  }

  const total = (k: "expired" | "soon" | "missing") => register.reduce((a, r) => a + r.counts[k], 0);
  const perKind = (k: OwnerKind) => register.filter((r) => r.kind === k);
  const issues = (k: OwnerKind) => perKind(k).reduce((a, r) => a + r.counts.expired + r.counts.missing, 0);
  const stateFilter = sp.state === "issues" ? "issues" : "";
  const rows = view === "all" ? [] : perKind(view).filter((r) => !stateFilter || r.counts.expired + r.counts.soon + r.counts.missing > 0);

  return (
    <>
      <PageHeader title="سجل الوثائق" description="وثائق الرؤوس والمقطورات والسائقين والموظفين والشركة والعملاء، مع المرفقات. الناقص هو نوع إلزامي لم تُسجَّل له وثيقة بعد.">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/fleet-documents/submissions"
            className={`rounded-lg border px-4 py-2 text-sm font-medium shadow-sm ${pending ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
          >
            رفعها السائقون{pending ? ` (${pending})` : ""}
          </Link>
          <Link href="/fleet-documents/summary" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
            الملخص اليومي
          </Link>
          <Link href="/fleet-documents/reports" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
            التقارير
          </Link>
          <ListActions newHref={canCreate && "/fleet-documents?add=1"} newLabel="إضافة وثيقة" />
        </div>
      </PageHeader>

      <div className="mb-5 grid grid-cols-3 gap-3 sm:max-w-xl">
        <Stat label="منتهية" value={total("expired")} tone="red" />
        <Stat label="تقترب من الانتهاء" value={total("soon")} tone="amber" />
        <Stat label="ناقصة" value={total("missing")} tone="gray" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {KINDS.map((k) => (
          <Tab key={k} href={`/fleet-documents?kind=${k}`} active={view === k} label={OWNER_KINDS[k].plural} count={issues(k)} />
        ))}
        <Tab href="/fleet-documents?kind=all" active={view === "all"} label="كل الوثائق" />
        {view !== "all" && (
          <Link
            href={`/fleet-documents?kind=${view}${stateFilter ? "" : "&state=issues"}`}
            className="ms-auto rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-brand-50"
          >
            {stateFilter ? "عرض الكل" : "ما يحتاج متابعة فقط"}
          </Link>
        )}
      </div>

      {view === "all" ? (
        <AllDocuments today={today} />
      ) : (
        <Table head={[OWNER_KINDS[view].label, "سارية", "تقترب", "منتهية", "ناقصة", ""]}>
          {rows.length === 0 && (
            <EmptyRow cols={6}>
              {stateFilter ? "لا شيء يحتاج متابعة" : view === "trailer" ? "لا توجد مقطورات؛ حدّد «نوع الأصل: مقطورة» عند تعديل المركبة" : "لا يوجد أصحاب وثائق من هذا النوع"}
            </EmptyRow>
          )}
          {rows.map((r) => (
            <tr key={ownerKey(r.kind, r.id)}>
              <Td className="font-medium">
                <Link href={`/fleet-documents/owner/${r.kind}-${r.id}`} className="hover:text-brand-700 hover:underline">
                  {r.label}
                </Link>
              </Td>
              <Td className="ltr-nums text-green-700">{r.counts.valid || "—"}</Td>
              <Td>{r.counts.soon ? <Badge tone="amber">{r.counts.soon}</Badge> : "—"}</Td>
              <Td>{r.counts.expired ? <Badge tone="red">{r.counts.expired}</Badge> : "—"}</Td>
              <Td>{r.counts.missing ? <Badge tone="gray">{r.counts.missing}</Badge> : "—"}</Td>
              <Td>
                <Link href={`/fleet-documents/owner/${r.kind}-${r.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                  الوثائق ←
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {can(user.perms, "settings", "view") && (
        <p className="mt-4 text-xs text-gray-500">
          أنواع الوثائق، وأيها إلزامي أو يمنع التشغيل، وأيام التنبيه:{" "}
          <Link href="/settings/document-types" className="text-brand-700 hover:underline">
            إعدادات أنواع الوثائق
          </Link>
        </p>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "gray" }) {
  const color = { red: "text-red-700", amber: "text-amber-700", gray: "text-gray-700" }[tone];
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white px-4 py-3 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`ltr-nums text-2xl font-semibold ${value ? color : "text-gray-300"}`}>{value}</div>
    </div>
  );
}

function Tab({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 transition ${active ? "bg-asphalt-900 font-semibold text-brand-500" : "bg-white text-gray-600 shadow-sm hover:bg-brand-50"}`}
    >
      {label}
      {!!count && <span className="ltr-nums rounded-full bg-red-100 px-1.5 text-xs text-red-700">{count}</span>}
    </Link>
  );
}

async function AllDocuments({ today }: { today: string }) {
  const docs = await db
    .select({
      doc: s.fleetDocuments,
      type: s.documentTypes,
      plate: s.vehicles.plate,
      driverName: s.employees.nameAr,
      employeeName: sql<string | null>`(select e.name_ar from employees e where e.id = ${s.fleetDocuments.employeeId})`,
      partyName: s.parties.nameAr,
      attachmentId: sql<number | null>`(select a.id from attachments a where a.entity = 'fleet_documents' and a.entity_id = ${s.fleetDocuments.id} order by a.id desc limit 1)`,
      renewed: sql<boolean>`exists (select 1 from fleet_documents f2 where f2.document_type_id = ${s.fleetDocuments.documentTypeId}
        and f2.vehicle_id is not distinct from ${s.fleetDocuments.vehicleId} and f2.driver_id is not distinct from ${s.fleetDocuments.driverId}
        and f2.employee_id is not distinct from ${s.fleetDocuments.employeeId} and f2.party_id is not distinct from ${s.fleetDocuments.partyId}
        and f2.id <> ${s.fleetDocuments.id} and (f2.expiry_date is null or f2.expiry_date > ${s.fleetDocuments.expiryDate}))`,
    })
    .from(s.fleetDocuments)
    .innerJoin(s.documentTypes, eq(s.documentTypes.id, s.fleetDocuments.documentTypeId))
    .leftJoin(s.vehicles, eq(s.vehicles.id, s.fleetDocuments.vehicleId))
    .leftJoin(s.drivers, eq(s.drivers.id, s.fleetDocuments.driverId))
    .leftJoin(s.employees, eq(s.employees.id, s.drivers.employeeId))
    .leftJoin(s.parties, eq(s.parties.id, s.fleetDocuments.partyId))
    .orderBy(sql`${s.fleetDocuments.expiryDate} asc nulls last`, asc(s.fleetDocuments.id))
    .limit(500);
  return (
    <Table head={["صاحب الوثيقة", "النوع", "الرقم", "الجهة", "الانتهاء", "الحالة", "المرفق"]}>
      {docs.length === 0 && <EmptyRow cols={7}>لا توجد وثائق بعد</EmptyRow>}
      {docs.map(({ doc, type, plate, driverName, employeeName, partyName, attachmentId, renewed }) => {
        const kind = type.ownerKind;
        const id = doc.vehicleId ?? doc.driverId ?? doc.employeeId ?? doc.partyId ?? 0;
        return (
          <tr key={doc.id}>
            <Td className="font-medium">
              <Link href={`/fleet-documents/owner/${kind}-${id}`} className="hover:text-brand-700 hover:underline">
                {plate ?? driverName ?? employeeName ?? partyName ?? "الشركة"}
              </Link>
            </Td>
            <Td>
              {type.nameAr}
              <EditLink href={`/records/fleet_documents/${doc.id}`} />
            </Td>
            <Td className="ltr-nums">{doc.number ?? "—"}</Td>
            <Td>{doc.authority ?? "—"}</Td>
            <Td className="ltr-nums">{doc.expiryDate ?? "—"}</Td>
            <Td>
              {renewed ? <Badge>جُدِّدت</Badge> : <ExpiryBadge expiryDate={doc.expiryDate} today={today} alertDays={type.alertDays} />}
            </Td>
            <Td>
              {attachmentId ? (
                <a href={`/files/${attachmentId}`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">
                  📎 عرض
                </a>
              ) : (
                <span className="text-xs text-gray-400">—</span>
              )}
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}
