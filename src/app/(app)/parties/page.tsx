import Link from "next/link";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PARTY_ROLES } from "@/data/operations";
import { CONTACT_SORTS, CONTACT_TABS, contactCountries, listContacts, type ContactTab } from "@/lib/contacts";
import { Icon } from "@/components/icons";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { ContactPanel } from "./contact-panel";

const BASE = "/parties";
type Params = { q?: string; tab?: string; country?: string; sort?: string; open?: string; ptab?: string; from?: string; to?: string };

/** رابط الصفحة نفسها مع تغيير بعض القيم (الباقي يبقى كما هو). */
function href(sp: Params, patch: Partial<Params>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v);
  const q = u.toString();
  return q ? `${BASE}?${q}` : BASE;
}

const COUNTRY_NAMES: Record<string, string> = { SA: "المملكة العربية السعودية", KW: "الكويت", AE: "الإمارات", BH: "البحرين", QA: "قطر", OM: "عُمان", JO: "الأردن", EG: "مصر" };
const country = (c: string) => COUNTRY_NAMES[c] ?? c;

export default async function PartiesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission("parties", "view");
  const sp = await searchParams;
  const tab: ContactTab = sp.tab && sp.tab in CONTACT_TABS ? (sp.tab as ContactTab) : "all";
  const sort = sp.sort && sp.sort in CONTACT_SORTS ? (sp.sort as keyof typeof CONTACT_SORTS) : "name";
  const [list, countries] = await Promise.all([listContacts(db, { q: sp.q?.trim() || undefined, tab, country: sp.country || undefined, sort }), contactCountries(db)]);
  const openId = Number(sp.open) || null;
  const open = openId ? list.find((x) => x.p.id === openId) : undefined;
  const canCreate = can(user.perms, "parties", "create");
  const canEdit = can(user.perms, "parties", "update");
  const btn = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50";

  return (
    <>
      <PageHeader title="العملاء والموردون" description="كل جهات الاتصال في جدول واحد. اضغط أي جهة لرؤية ملخص أرصدتها وأشخاصها وكشف حسابها.">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Link href="/records/parties/bulk" className={btn}>
              تعديل جماعي
            </Link>
          )}
          {canCreate && (
            <details data-dropdown className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-brand-900 shadow-sm hover:bg-brand-500">
                إضافة <span className="text-xs">▾</span>
              </summary>
              <div className="absolute end-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
                <Link href="/parties/bulk-add" className="block px-4 py-2 hover:bg-gray-50">
                  إضافة جماعية
                </Link>
                <Link href="/import/customers" className="block px-4 py-2 hover:bg-gray-50">
                  الاستيراد من Excel
                </Link>
              </div>
            </details>
          )}
        </div>
      </PageHeader>

      {/* تبويبات حسب الدور */}
      <nav className="mb-3 flex gap-1 overflow-x-auto border-b border-gray-200 text-sm">
        {Object.entries(CONTACT_TABS).map(([k, label]) => (
          <Link
            key={k}
            href={href(sp, { tab: k === "all" ? undefined : k, open: undefined })}
            className={`border-b-2 px-3 py-2 whitespace-nowrap ${tab === k ? "border-brand-600 font-semibold text-brand-900" : "border-transparent text-gray-500 hover:text-gray-800"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* البحث والفلاتر */}
      <form action={BASE} className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
        <label className="relative">
          <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input name="q" defaultValue={sp.q} placeholder="البحث بالاسم أو الرقم الضريبي أو الجوال" className="w-72 rounded-lg border border-gray-300 bg-white py-2 ps-8 pe-3 outline-none focus:border-brand-500" />
        </label>
        <select name="country" defaultValue={sp.country ?? ""} className="rounded-lg border border-gray-300 bg-white px-3 py-2">
          <option value="">البلد: الكل</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {country(c)}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} className="rounded-lg border border-gray-300 bg-white px-3 py-2">
          {Object.entries(CONTACT_SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              ترتيب: {v}
            </option>
          ))}
        </select>
        <button className={btn}>تطبيق</button>
        {(sp.q || sp.country) && (
          <Link href={href({ tab: sp.tab }, {})} className="text-xs text-gray-500 underline">
            مسح الفلاتر
          </Link>
        )}
        <span className="ms-auto text-xs text-gray-500">عدد السجلات: {list.length}</span>
      </form>

      {open ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(16rem,21rem)_1fr]">
          {/* القائمة المختصرة بجانب تفاصيل الجهة */}
          <ul className="hidden max-h-[calc(100vh-9rem)] divide-y divide-gray-100 overflow-y-auto rounded-2xl border border-black/[0.06] bg-white shadow-sm lg:sticky lg:top-4 lg:block">
            {list.map(({ p }) => (
              <li key={p.id}>
                <Link href={href(sp, { open: String(p.id) })} scroll={false} className={`block border-s-4 px-4 py-3 transition ${p.id === openId ? "border-brand-500 bg-brand-50/70" : "border-transparent hover:bg-gray-50"}`}>
                  <div className="line-clamp-1 text-sm font-semibold text-gray-800">{p.nameAr}</div>
                  <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                    <div className="ltr-nums"># {p.vatNumber ?? <span className="text-gray-400">لم يتم تعيين رقم التسجيل الضريبي</span>}</div>
                    <div>⚑ {country(p.country)}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <ContactPanel
            party={open.p}
            roles={open.roles}
            tab={sp.ptab}
            from={sp.from}
            to={sp.to}
            closeHref={href(sp, { open: undefined, ptab: undefined, from: undefined, to: undefined })}
            tabHref={(t) => href(sp, { ptab: t })}
            canEdit={canEdit}
            perms={user.perms}
          />
        </div>
      ) : (
        <Table head={["الاسم", "نوع جهة الاتصال", "الأشخاص", "الرقم الضريبي", "البريد الإلكتروني", "الجوال", "البلد", "المدينة", "الشارع", "رقم المبنى", ""]}>
          {list.length === 0 && <EmptyRow cols={11}>{sp.q || sp.country ? "لا توجد جهات بهذه الشروط" : "لا توجد جهات بعد؛ أضفها من زر «إضافة»"}</EmptyRow>}
          {list.map(({ p, roles, people }) => {
            const openHref = href(sp, { open: String(p.id) });
            return (
              <tr key={p.id} className="group cursor-pointer hover:bg-brand-50/40">
                <Td className="font-medium">
                  <Link href={openHref} scroll={false} className="hover:text-brand-800">
                    {p.nameAr}
                  </Link>
                  {!p.isActive && <span className="ms-2 text-xs text-gray-400">(موقوف)</span>}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {roles.map((r) => (
                      <Badge key={r} tone="blue">
                        {PARTY_ROLES[r as keyof typeof PARTY_ROLES]}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td className="ltr-nums text-gray-500">{people || "—"}</Td>
                <Td className="ltr-nums">{p.vatNumber ?? "—"}</Td>
                <Td className="ltr-nums text-xs">{p.email ?? "—"}</Td>
                <Td className="ltr-nums">{p.mobile ?? "—"}</Td>
                <Td className="whitespace-nowrap">{country(p.country)}</Td>
                <Td>{p.city ?? "—"}</Td>
                <Td className="max-w-[12rem] truncate">{p.street ?? "—"}</Td>
                <Td className="ltr-nums">{p.buildingNo ?? "—"}</Td>
                <Td>
                  <Link href={openHref} scroll={false} aria-label="فتح" className="inline-flex rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-700">
                    <Icon name="expand" className="size-4" />
                  </Link>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
