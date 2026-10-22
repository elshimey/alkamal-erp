// فصل بيانات الشركات: لكل شركة مخطط (schema) خاص في قاعدة البيانات بنفس الجداول.
// شركة البداية (الكمال) في المخطط public، والشركات الجديدة في t_<الرمز>.
// كل استعلام يُنفَّذ داخل معاملة تضبط search_path على مخطط الشركة الحالية،
// فيعمل كل الكود والقيود والمشغلات كما هي دون تعديل.
import { AsyncLocalStorage } from "node:async_hooks";
import type postgres from "postgres";

export const HOME_SCHEMA = "public";
export const TENANT_COOKIE = "erp_tenant";
const SCHEMA_RE = /^(public|t_[a-z0-9_]{2,40})$/;

export const isSchemaName = (v: unknown): v is string => typeof v === "string" && SCHEMA_RE.test(v);
export const schemaForSlug = (slug: string) => `t_${slug}`;

const store = new AsyncLocalStorage<string>();

/** ينفذ fn على بيانات شركة محددة (للدخول، ولوحة المالك، والترحيل، والاختبارات). */
export function runInTenant<T>(schema: string, fn: () => T): T {
  if (!isSchemaName(schema)) throw new Error("مخطط شركة غير صالح");
  return store.run(schema, fn);
}

/** مخطط الشركة الحالية: المحدد صراحة، وإلا من ملف تعريف الدخول، وإلا شركة البداية. */
export async function currentSchema(): Promise<string> {
  const explicit = store.getStore();
  if (explicit) return explicit;
  try {
    const { cookies } = await import("next/headers");
    const v = (await cookies()).get(TENANT_COOKIE)?.value;
    if (isSchemaName(v)) return v;
  } catch {
    // خارج طلب ويب (سكربت أو اختبار)
  }
  return HOME_SCHEMA;
}

type Sql = ReturnType<typeof postgres>;
type Resolver = () => Promise<string>;
type UserResolver = () => Promise<number | null>;
const WRITE_RE = /^\s*(insert|update|delete)\b/i;

/**
 * يلف عميل postgres بحيث يمر كل استعلام عبر مخطط الشركة الحالية.
 * لشركة البداية لا يتغير شيء؛ لغيرها: معاملة قصيرة تبدأ بـ SET LOCAL search_path
 * (تعمل مع مجمّع الاتصالات لأن الضبط محصور في المعاملة).
 */
export function tenantClient(base: Sql, resolve: Resolver = currentSchema, resolveUser?: UserResolver): Sql {
  const setPath = (tx: Sql, schema: string) => tx.unsafe(`set local search_path to "${schema}"`);
  // المستخدم الحالي لسجل التعديلات (مشغل audit_row يقرأ app.user_id)؛ يُضبط داخل المعاملة فقط
  const setUser = async (tx: Sql, userId: number | null) => {
    if (userId) await tx.unsafe(`select set_config('app.user_id', $1, true)`, [String(userId)]);
  };
  const wrapped = {
    options: base.options,
    unsafe(query: string, params?: unknown[], opts?: object) {
      const run = async (values: boolean) => {
        const schema = await resolve();
        const userId = resolveUser && WRITE_RE.test(query) ? await resolveUser() : null;
        if (schema === HOME_SCHEMA && !userId) {
          const q = base.unsafe(query, params as never[], opts);
          return values ? q.values() : q;
        }
        return base.begin(async (tx) => {
          if (schema !== HOME_SCHEMA) await setPath(tx as unknown as Sql, schema);
          await setUser(tx as unknown as Sql, userId);
          const q = (tx as unknown as Sql).unsafe(query, params as never[], opts);
          return values ? q.values() : q;
        });
      };
      return {
        then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => run(false).then(ok, fail),
        catch: (fail: (e: unknown) => unknown) => run(false).catch(fail),
        values: () => run(true),
      };
    },
    async begin(fn: (tx: Sql) => unknown) {
      const schema = await resolve();
      const userId = resolveUser ? await resolveUser() : null;
      return base.begin(async (tx) => {
        if (schema !== HOME_SCHEMA) await setPath(tx as unknown as Sql, schema);
        await setUser(tx as unknown as Sql, userId);
        return fn(tx as unknown as Sql);
      });
    },
    end: (o?: { timeout?: number }) => base.end(o),
  };
  return wrapped as unknown as Sql;
}
