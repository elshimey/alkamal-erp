import "server-only";
import { randomBytes } from "node:crypto";
import { baseSql } from "@/db";
import { currentSchema } from "@/db/tenant";

// رابط عام لمستند واحد يُرسل للعميل (واتساب أو بريد) ليفتحه ويحمّله PDF دون دخول.
// الرابط عشوائي لا يُخمَّن، ويبقى صالحاً 90 يوماً.
const VALID_DAYS = 90;

export async function shareLink(kind: string, docId: number): Promise<string> {
  const schema = await currentSchema();
  const [existing] = await baseSql<{ token: string }[]>`
    select token from platform.share_links
    where schema_name = ${schema} and kind = ${kind} and doc_id = ${docId} and expires_at > now() + interval '30 days'
    order by created_at desc limit 1`;
  if (existing) return existing.token;
  const token = randomBytes(18).toString("base64url");
  await baseSql`insert into platform.share_links (token, schema_name, kind, doc_id, expires_at)
    values (${token}, ${schema}, ${kind}, ${docId}, now() + make_interval(days => ${VALID_DAYS}))`;
  return token;
}

export async function resolveShare(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await baseSql<{ schema_name: string; kind: string; doc_id: string }[]>`
    select schema_name, kind, doc_id from platform.share_links where token = ${token} and expires_at > now()`;
  return row ? { schema: row.schema_name, kind: row.kind, id: Number(row.doc_id) } : null;
}
