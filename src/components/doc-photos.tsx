import type { CustomerPhoto } from "@/lib/attachments";

export type PhotoUrl = (id: number) => string;
export const officePhotoUrl: PhotoUrl = (id) => `/files/${id}`;

const KIND_LABEL: Record<string, string> = { pod: "التسليم", other: "الرحلة" };
const when = (d: Date | string) => new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" });

/**
 * صور الرحلة التي يراها العميل في مستند الشحنة والفاتورة ورابطهما: صور التحميل والطريق والتسليم من السائق،
 * عدا ما أخفاه المكتب. في الفاتورة تأتي صفحةً مرفقة بعدها مجمّعة بالشحنة، ثلاث صور في السطر.
 */
export function DocPhotos({ photos, photoUrl = officePhotoUrl, grouped = false, newPage = false }: { photos: CustomerPhoto[]; photoUrl?: PhotoUrl; grouped?: boolean; newPage?: boolean }) {
  if (!photos.length) return null;
  const groups = grouped
    ? [...photos.reduce((m, p) => m.set(p.waybillId, [...(m.get(p.waybillId) ?? []), p]), new Map<number, CustomerPhoto[]>()).values()]
    : [photos];
  return (
    <section className={`mt-6 ${newPage ? "print:break-before-page" : "break-inside-avoid"}`}>
      <h3 className="mb-2 text-sm font-semibold text-[var(--inv-dark)]">{grouped ? "صور الشحنات" : "صور الرحلة"}</h3>
      <div className="grid gap-4">
        {groups.map((g) => (
          <div key={g[0].waybillId} className="break-inside-avoid">
            {grouped && <div className="ltr-nums mb-1.5 text-xs font-semibold text-gray-600">شحنة {g[0].waybillNumber}</div>}
            <div className="grid grid-cols-3 gap-2">
              {g.map((p) => (
                <a key={p.id} href={photoUrl(p.id)} target="_blank" rel="noreferrer" className="block break-inside-avoid text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl(p.id)} alt={KIND_LABEL[p.kind] ?? "صورة"} className="aspect-[4/3] w-full rounded-lg object-cover ring-1 ring-black/10" />
                  <span className="ltr-nums mt-0.5 block text-[10px] text-gray-500">
                    {KIND_LABEL[p.kind] ?? "صورة"} · {when(p.createdAt)}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
