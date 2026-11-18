import { db } from "@/db";
import { runInTenant } from "@/db/tenant";
import { resolveShare } from "@/lib/share";
import { customerPhotos, getAttachment } from "@/lib/attachments";
import { invoiceWaybillIds } from "@/lib/invoices";

/** صورة رحلة داخل مستند مُشارك: تُعرض دون دخول فقط إن كانت من شحنات هذا المستند وظاهرة للعميل. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const p = await params;
  const share = await resolveShare(p.token);
  const photoId = Number(p.id);
  if (!share || !Number.isInteger(photoId)) return new Response("Not found", { status: 404 });
  const file = await runInTenant(share.schema, async () => {
    const waybillIds = share.kind === "waybills" ? [share.id] : share.kind === "invoices" ? await invoiceWaybillIds(db, share.id) : [];
    const allowed = (await customerPhotos(db, waybillIds)).some((ph) => ph.id === photoId);
    return allowed ? getAttachment(db, photoId) : null;
  });
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: { "Content-Type": file.mime, "Cache-Control": "private, max-age=3600", "Content-Length": String(file.size), "X-Robots-Tag": "noindex" },
  });
}
