import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayRiyadh } from "@/lib/dates";
import { documentRegister, documentRows, listDocumentTypes, OWNER_KINDS, ownerKey, type DocumentRow, type OwnerKind } from "@/lib/documents";
import { norm } from "@/lib/filter-options";
import { PAGE_SIZE, pageOf } from "@/lib/paging";
import { fmtDate } from "@/lib/format";
import { ExpiryBadge } from "@/components/expiry-badge";
import { Badge, Card, EmptyRow, PageHeader, Pager, Table, Td } from "@/components/ui";
import { AddModeBar, ListActions } from "@/components/list-actions";
import { SheetEditor } from "@/components/sheet-editor";
import { DocumentPanel } from "./document-panel";
import { saveDocumentsSheet } from "./actions";

const KINDS = Object.keys(OWNER_KINDS) as OwnerKind[];
type DocRowState = DocumentRow["state"];
const STATES: DocRowState[] = ["expired", "soon", "missing", "valid"];
const ORDER: Record<DocRowState, number> = { expired: 0, soon: 1, missing: 2, valid: 3 };

export default async function DocumentRegisterPage({ searchParams }: { searchParams: Promise<{ add?: string; new?: string; edit?: string; kind?: string; owner?: string; type?: string; state?: string; q?: string; page?: string; view?: string }> }) {
  const user = await requirePermission("fleet_documents", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const canCreate = can(user.perms, "fleet_documents", "create");
  const canEdit = can(user.perms, "fleet_documents", "update");
  const adding = sp.add === "1" && canCreate;
  const editId = Number(sp.edit) || null;
  const keep = new URLSearchParams(Object.entries({ kind: sp.kind, state: sp.state }).filter((e): e is [string, string] => !!e[1])).toString();
  const closeHref = `/fleet-documents${keep ? `?${keep}` : ""}`;
  const panel = (sp.new === "1" && canCreate) || (editId && canEdit) ? <DocumentPanel id={editId} closeHref={closeHref} owner={sp.owner} type={sp.type} /> : null;
  const view = sp.view === "owners" ? "owners" : "all";
  const [register, types, [{ pending }]] = await Promise.all([
    documentRegister(db, today),
    listDocumentTypes(db, { activeOnly: true }),
    db.select({ pending: sql<number>`count(*)::int` }).from(s.documentSubmissions).where(eq(s.documentSubmissions.status, "pending")),
  ]);

  if (adding) {
    return (
      <>
        <PageHeader title="سجل الوثائق" />
        <AddModeBar backHref="/fleet-documents" backLabel="سجل الوثائق" title="إضافة وثائق جماعية" />
        <Card>
          <SheetEditor
            templateName="الوثائق"
            action={saveDocumentsSheet}
            initialRows={5}
            columns={[
              {
                key: "kind",
                label: "جهة الوثيقة",
                type: "select",
                required: true,
                width: "9rem",
                options: KINDS.map((k) => ({ value: k, label: OWNER_KINDS[k].label })),
              },
              {
                key: "owner",
                label: "صاحب الوثيقة",
                type: "select",
                required: true,
                width: "13rem",
                options: register.map((o) => ({ value: ownerKey(o.kind, o.id), label: o.label })),
                dependsOn: {
                  key: "kind",
                  options: Object.fromEntries(KINDS.map((k) => [k, register.filter((o) => o.kind === k).map((o) => ({ value: ownerKey(o.kind, o.id), label: o.label }))])),
                  create: { vehicle: "vehicle", trailer: "vehicle", driver: "driver", customer: "customer", supplier: "supplier" },
                  prefix: { vehicle: "vehicle:", trailer: "trailer:", driver: "driver:", customer: "customer:", supplier: "supplier:" },
                },
              },
              {
                key: "documentTypeId",
                label: "نوع الوثيقة",
                type: "select",
                required: true,
                width: "14rem",
                options: types.map((t) => ({ value: String(t.id), label: t.nameAr })),
                dependsOn: { key: "kind", options: Object.fromEntries(KINDS.map((k) => [k, types.filter((t) => t.ownerKind === k).map((t) => ({ value: String(t.id), label: t.nameAr }))])) },
              },
              { key: "number", label: "الرقم", ltr: true, width: "9rem" },
              { key: "issueDate", label: "تاريخ الإصدار", type: "date" },
              { key: "expiryDate", label: "تاريخ الانتهاء", type: "date" },
              { key: "authority", label: "جهة الإصدار", width: "9rem" },
              { key: "cost", label: "الرسوم", type: "number", width: "6rem" },
              { key: "notes", label: "ملاحظات", width: "10rem" },
            ]}
          />
          <p className="mt-2 text-xs text-gray-500">اختر الجهة أولاً (رأس، مقطورة، سائق، عميل، مورد…)، فتظهر أصحابها وأنواع وثائقها فقط، ومن القائمة يمكن إضافة صاحب جديد. المرفقات تُضاف بعد الحفظ من نافذة الوثيقة.</p>
        </Card>
      </>
    );
  }

  const all = await documentRows(db, today);
  const kindFilter = KINDS.includes(sp.kind as OwnerKind) ? (sp.kind as OwnerKind) : null;
  const stateFilter = STATES.includes(sp.state as DocRowState) ? (sp.state as DocRowState) : null;
  const q = norm(sp.q ?? "");
  const ofKind = all.filter((r) => !kindFilter || r.ownerKind === kindFilter);
  const count = (st: DocRowState) => ofKind.filter((r) => r.state === st).length;
  const filtered = ofKind
    .filter((r) => !stateFilter || r.state === stateFilter)
    .filter((r) => !q || norm(`${r.owner} ${r.type.nameAr} ${r.doc?.number ?? ""}`).includes(q))
    // الأهم أولاً: المنتهية ثم القريبة ثم الناقصة ثم السارية، والأقرب انتهاءً أولاً
    .sort((x, y) => ORDER[x.state] - ORDER[y.state] || (x.doc?.expiryDate ?? "9999").localeCompare(y.doc?.expiryDate ?? "9999") || x.owner.localeCompare(y.owner, "ar"));
  const { page, offset } = pageOf(sp.page);
  const shown = filtered.slice(offset, offset + PAGE_SIZE);
  const link = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries({ kind: kindFilter, state: stateFilter, q: sp.q || null, ...patch }).filter((e): e is [string, string] => !!e[1]));
    const str = p.toString();
    return `/fleet-documents${str ? `?${str}` : ""}`;
  };
  const perKind = (k: OwnerKind) => all.filter((r) => r.ownerKind === k && r.state !== "valid").length;

  if (view === "owners") return <OwnersView register={register} kind={kindFilter ?? "vehicle"} panel={panel} />;

  return (
    <>
      <PageHeader title="سجل الوثائق" description="كل الوثائق في جدول واحد: الرؤوس والمقطورات والسائقون والموظفون والشركة والعملاء والموردون. اضغط أي مربع لعرض وثائقه فقط.">
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
          <ListActions
            bulkHref={canEdit && "/records/fleet_documents/bulk"}
            newHref={canCreate && `/fleet-documents?${keep ? `${keep}&` : ""}new=1`}
            newLabel="إضافة وثيقة"
            addHref={canCreate && "/fleet-documents?add=1"}
            addLabel="إضافة وثائق جماعية"
          />
        </div>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:max-w-3xl sm:grid-cols-4">
        <Stat label="منتهية" value={count("expired")} tone="red" href={link({ state: stateFilter === "expired" ? null : "expired", page: null })} active={stateFilter === "expired"} />
        <Stat label="تقترب من الانتهاء" value={count("soon")} tone="amber" href={link({ state: stateFilter === "soon" ? null : "soon", page: null })} active={stateFilter === "soon"} />
        <Stat label="ناقصة" value={count("missing")} tone="gray" href={link({ state: stateFilter === "missing" ? null : "missing", page: null })} active={stateFilter === "missing"} />
        <Stat label="سارية" value={count("valid")} tone="green" href={link({ state: stateFilter === "valid" ? null : "valid", page: null })} active={stateFilter === "valid"} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-gray-500">الجهة:</span>
        <Tab href={link({ kind: null, page: null })} active={!kindFilter} label="الكل" />
        {KINDS.map((k) => (
          <Tab key={k} href={link({ kind: k, page: null })} active={kindFilter === k} label={OWNER_KINDS[k].plural} count={perKind(k)} />
        ))}
        <Link href={`/fleet-documents?view=owners${kindFilter ? `&kind=${kindFilter}` : ""}`} className="ms-auto rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-brand-50">
          ملخص حسب الصاحب
        </Link>
      </div>
      <form className="mb-3 flex flex-wrap items-center gap-2" action="/fleet-documents">
        {kindFilter && <input type="hidden" name="kind" value={kindFilter} />}
        {stateFilter && <input type="hidden" name="state" value={stateFilter} />}
        <input name="q" defaultValue={sp.q ?? ""} placeholder="ابحث باللوحة أو الاسم أو نوع الوثيقة أو رقمها" className="w-72 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500" />
        {(stateFilter || kindFilter || sp.q) && (
          <Link href="/fleet-documents" className="text-xs text-brand-700 hover:underline">
            مسح الفلتر ({filtered.length} من {all.length})
          </Link>
        )}
      </form>

      <Table head={["الجهة", "صاحب الوثيقة", "نوع الوثيقة", "الرقم", "الانتهاء", "الحالة", "المرفق", ""]}>
        {shown.length === 0 && <EmptyRow cols={8}>{stateFilter || kindFilter || q ? "لا توجد وثائق بهذا الفلتر" : "لا توجد وثائق بعد"}</EmptyRow>}
        {shown.map((r) => (
          <tr key={r.key}>
            <Td className="text-xs text-gray-500">{OWNER_KINDS[r.ownerKind].label}</Td>
            <Td className="font-medium">
              <Link href={`/fleet-documents/owner/${r.ownerKind}-${r.ownerId}`} className="hover:text-brand-700 hover:underline">
                {r.owner}
              </Link>
            </Td>
            <Td>
              {r.doc && canEdit ? (
                <Link href={link({ edit: String(r.doc.id) })} scroll={false} prefetch={false} className="text-brand-700 hover:underline">
                  {r.type.nameAr}
                </Link>
              ) : (
                r.type.nameAr
              )}
            </Td>
            <Td className="ltr-nums">{r.doc?.number ?? "—"}</Td>
            <Td className="ltr-nums">{fmtDate(r.doc?.expiryDate)}</Td>
            <Td>{r.doc ? <ExpiryBadge expiryDate={r.doc.expiryDate} today={today} alertDays={r.type.alertDays} /> : <Badge tone="gray">ناقصة</Badge>}</Td>
            <Td>
              {r.attachmentId ? (
                <a href={`/files/${r.attachmentId}`} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">
                  📎 عرض
                </a>
              ) : (
                <span className="text-xs text-gray-400">—</span>
              )}
            </Td>
            <Td>
              {canCreate && r.state !== "valid" && (
                <Link href={`/fleet-documents/owner/${r.ownerKind}-${r.ownerId}?new=1&type=${r.type.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                  {r.doc ? "تجديد" : "إضافة"}
                </Link>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} size={PAGE_SIZE} total={filtered.length} hrefFor={(n) => link({ page: String(n) })} />
      {can(user.perms, "settings", "view") && (
        <p className="mt-4 text-xs text-gray-500">
          أنواع الوثائق، وأيها إلزامي أو يمنع التشغيل، وأيام التنبيه:{" "}
          <Link href="/settings/document-types" className="text-brand-700 hover:underline">
            إعدادات أنواع الوثائق
          </Link>
        </p>
      )}
      {panel}
    </>
  );
}

/** الملخص القديم: لكل صاحب كم وثيقة سارية وقريبة ومنتهية وناقصة. */
function OwnersView({ register, kind, panel }: { register: Awaited<ReturnType<typeof documentRegister>>; kind: OwnerKind; panel: React.ReactNode }) {
  const rows = register.filter((r) => r.kind === kind);
  return (
    <>
      <PageHeader title="سجل الوثائق: ملخص حسب الصاحب" description="عدد الوثائق السارية والقريبة والمنتهية والناقصة لكل صاحب.">
        <Link href="/fleet-documents" className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
          → كل الوثائق
        </Link>
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {KINDS.map((k) => (
          <Tab key={k} href={`/fleet-documents?view=owners&kind=${k}`} active={kind === k} label={OWNER_KINDS[k].plural} count={register.filter((r) => r.kind === k).reduce((a, r) => a + r.counts.expired + r.counts.missing, 0)} />
        ))}
      </div>
      <Table head={[OWNER_KINDS[kind].label, "سارية", "تقترب", "منتهية", "ناقصة", ""]}>
        {rows.length === 0 && <EmptyRow cols={6}>{kind === "trailer" ? "لا توجد مقطورات؛ حدّد «نوع الأصل: مقطورة» عند تعديل المركبة" : "لا يوجد أصحاب وثائق من هذا النوع"}</EmptyRow>}
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
      {panel}
    </>
  );
}

/** مربع عدد يفتح الجدول مفلتراً بحالته (الضغط مرة أخرى يلغي الفلتر). */
function Stat({ label, value, tone, href, active }: { label: string; value: number; tone: "red" | "amber" | "gray" | "green"; href: string; active: boolean }) {
  const color = { red: "text-red-700", amber: "text-amber-700", gray: "text-gray-700", green: "text-green-700" }[tone];
  return (
    <Link href={href} scroll={false} aria-pressed={active} className={`rounded-xl border bg-white px-4 py-3 shadow-sm transition hover:border-brand-400 hover:bg-brand-50/40 ${active ? "border-brand-500 ring-2 ring-brand-500/30" : "border-black/[0.06]"}`}>
      <div className="flex items-center justify-between text-xs text-gray-500">
        {label}
        <span className="text-[10px] text-brand-700">{active ? "✓ معروضة" : "عرض ←"}</span>
      </div>
      <div className={`ltr-nums text-2xl font-semibold ${value ? color : "text-gray-300"}`}>{value}</div>
    </Link>
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
