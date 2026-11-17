import webpush from "web-push";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import * as s from "@/db/schema";
import { DRIVER_DICT, type DriverLang } from "@/data/driver-i18n";

// الإشعار الفوري المجاني (Web Push): يُرسل مرة واحدة عند تغيّر الحالة، لجوال السائق ولمتصفح المكتب.
// المفاتيح (VAPID) تُنشأ تلقائياً أول مرة وتُحفظ في إعدادات المنصة، فلا يحتاج أحد لإدخالها،
// ويمكن تجاوزها بمتغيري البيئة VAPID_PUBLIC_KEY و VAPID_PRIVATE_KEY.
// الإرسال يحدث بعد انتهاء الطلب (after) وبعد التأكد أن الإشعار حُفظ فعلاً، فلا يتأخر المستخدم ولا يصل إشعار لعملية أُلغيت.

export type PushApp = "office" | "driver";
type Keys = { publicKey: string; privateKey: string };

let keysPromise: Promise<Keys | null> | null = null;

async function loadKeys(): Promise<Keys | null> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const { baseSql } = await import("@/db");
  const read = async () => (await baseSql`select value from platform.settings where key = 'vapid'`)[0]?.value as string | undefined;
  let v = await read();
  if (!v) {
    const k = webpush.generateVAPIDKeys();
    await baseSql`insert into platform.settings (key, value) values ('vapid', ${JSON.stringify(k)}) on conflict (key) do nothing`;
    v = await read();
  }
  return v ? (JSON.parse(v) as Keys) : null;
}

/** مفاتيح الإشعار (تُقرأ مرة لكل نسخة من الخادم). null إن تعذّر إنشاؤها، فيعمل الفحص الدوري وحده. */
export function vapidKeys(): Promise<Keys | null> {
  keysPromise ??= loadKeys().catch(() => {
    keysPromise = null;
    return null;
  });
  return keysPromise;
}

export async function vapidPublicKey() {
  return (await vapidKeys())?.publicKey ?? null;
}

const SUBJECT = process.env.VAPID_SUBJECT ?? "https://alkamal-erp.vercel.app";

export type PushSubscriptionInput = { endpoint: string; keys?: { p256dh?: string; auth?: string } };

/** يحفظ اشتراك هذا الجهاز للمستخدم (الجهاز نفسه إن انتقل لمستخدم آخر يُنقل اشتراكه). */
export async function savePushSubscription(db: Db | Tx, userId: number, app: PushApp, sub: PushSubscriptionInput, userAgent?: string | null) {
  const endpoint = String(sub?.endpoint ?? "");
  const p256dh = String(sub?.keys?.p256dh ?? "");
  const auth = String(sub?.keys?.auth ?? "");
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth || endpoint.length > 2000) throw new Error("اشتراك الإشعارات غير صالح");
  await db
    .insert(s.pushSubscriptions)
    .values({ userId, app, endpoint, p256dh, auth, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({ target: s.pushSubscriptions.endpoint, set: { userId, app, p256dh, auth, userAgent: userAgent?.slice(0, 300) ?? null } });
}

export async function removePushSubscription(db: Db | Tx, userId: number, endpoint: string) {
  await db.delete(s.pushSubscriptions).where(and(eq(s.pushSubscriptions.userId, userId), eq(s.pushSubscriptions.endpoint, endpoint)));
}

type Payload = { title: string; body: string; url: string; tag: string };

async function sendTo(db: Db, userIds: number[], app: PushApp, payload: Payload) {
  if (!userIds.length) return;
  const keys = await vapidKeys();
  if (!keys) return;
  const subs = await db.select().from(s.pushSubscriptions).where(and(inArray(s.pushSubscriptions.userId, userIds), eq(s.pushSubscriptions.app, app)));
  const gone: number[] = [];
  await Promise.all(
    subs.map((x) =>
      webpush
        .sendNotification({ endpoint: x.endpoint, keys: { p256dh: x.p256dh, auth: x.auth } }, JSON.stringify(payload), {
          vapidDetails: { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 24 * 3600,
          urgency: "high",
          timeout: 8000,
        })
        .catch((e: { statusCode?: number }) => {
          // الاشتراك انتهى أو ألغاه صاحبه
          if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(x.id);
        }),
    ),
  );
  if (gone.length) await db.delete(s.pushSubscriptions).where(inArray(s.pushSubscriptions.id, gone));
}

/** المستخدمون النشطون الذين يملكون الصلاحية (مدير النظام يملك كل شيء). */
export async function usersWithPermission(db: Db | Tx, entity: string, action: string): Promise<number[]> {
  const rows = await db.execute<{ id: number }>(sql`
    select distinct u.id::int as id
    from users u
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id and rp.entity = ${entity} and rp.action = ${action}
    where u.is_active and (u.expires_at is null or u.expires_at > now()) and (r.key = 'admin' or rp.role_id is not null)`);
  return [...rows].map((r) => Number(r.id));
}

async function deliverDriver(db: Db, id: number) {
  const [n] = await db
    .select({ n: s.driverNotifications, userId: s.drivers.userId, lang: s.drivers.appLanguage })
    .from(s.driverNotifications)
    .innerJoin(s.drivers, eq(s.drivers.id, s.driverNotifications.driverId))
    .where(eq(s.driverNotifications.id, id));
  if (!n?.userId) return;
  const dict = DRIVER_DICT[(n.lang as DriverLang) ?? "ar"] ?? DRIVER_DICT.ar;
  const title = (dict.notify as Record<string, string>)[n.n.kind] ?? n.n.title;
  await sendTo(db, [n.userId], "driver", { title, body: n.n.body ?? "", url: n.n.href ?? "/driver/notifications", tag: `d${id}` });
}

async function deliverOffice(db: Db, id: number) {
  const [n] = await db.select().from(s.officeNotifications).where(eq(s.officeNotifications.id, id));
  if (!n) return;
  const users = await usersWithPermission(db, n.entity, n.action);
  await sendTo(db, users, "office", { title: "الكمال: تنبيه جديد", body: n.text, url: n.href, tag: `o${id}` });
}

/** يرسل إشعاراً محفوظاً لأجهزة أصحابه (يُستدعى بعد انتهاء الطلب). */
export function deliverPush(db: Db, target: { kind: "driver" | "office"; id: number }) {
  return target.kind === "driver" ? deliverDriver(db, target.id) : deliverOffice(db, target.id);
}

/**
 * يجدول إرسال الإشعار بعد انتهاء الطلب الحالي. خارج طلب ويب (اختبار أو سكربت) لا يُرسل شيء،
 * ويبقى الإشعار محفوظاً يظهر في الجرس.
 */
export async function queuePush(target: { kind: "driver" | "office"; id: number }) {
  try {
    const { after } = await import("next/server");
    const { currentSchema } = await import("@/db/tenant");
    const schema = await currentSchema();
    after(async () => {
      try {
        const [{ db }, { runInTenant }] = await Promise.all([import("@/db"), import("@/db/tenant")]);
        await runInTenant(schema, () => deliverPush(db, target));
      } catch (e) {
        console.error("push failed", e);
      }
    });
  } catch {
    // خارج طلب ويب
  }
}
