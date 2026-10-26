import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getAttachment } from "@/lib/attachments";
import { isDriverOnly } from "@/lib/driver-app";
import { can, type Entity } from "@/lib/permissions";

const ENTITY_PERM: Record<string, Entity> = { waybills: "waybills", expenses: "expenses", fleet_documents: "fleet_documents", document_submissions: "fleet_documents", traffic_violations: "violations" };

/** عرض صورة مرفقة: للمكتب حسب الصلاحية، وللسائق صور رحلاته ومصروفاته فقط. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const file = await getAttachment(db, Number((await params).id));
  if (!file) return new Response("Not found", { status: 404 });
  let allowed = false;
  if (isDriverOnly(user.roles)) {
    const [d] = await db.select({ id: s.drivers.id }).from(s.drivers).where(eq(s.drivers.userId, user.id));
    if (d && file.entity === "waybills") allowed = !!(await db.select({ id: s.waybills.id }).from(s.waybills).where(and(eq(s.waybills.id, file.entityId), eq(s.waybills.driverId, d.id))))[0];
    else allowed = file.createdBy === user.id;
  } else {
    const perm = ENTITY_PERM[file.entity];
    allowed = perm ? can(user.perms, perm, "view") : user.perms.isAdmin;
  }
  if (!allowed) return new Response("Forbidden", { status: 403 });
  return new Response(new Uint8Array(file.data), {
    headers: { "Content-Type": file.mime, "Cache-Control": "private, max-age=86400", "Content-Length": String(file.size) },
  });
}
