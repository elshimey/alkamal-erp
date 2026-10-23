import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { baseSql, db } from "@/db";
import { currentSchema, HOME_SCHEMA, TENANT_COOKIE } from "@/db/tenant";
import { tenantState } from "@/lib/platform";
import * as s from "@/db/schema";
import { can, type Action, type Entity, type PermissionSet, type Scope } from "@/lib/permissions";

const COOKIE = "erp_session";
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  expires,
});

/** حالة اشتراك الشركة الحالية (مرة واحدة لكل طلب). */
export const getTenant = cache(async () => {
  const schema = await currentSchema();
  const state = await tenantState(baseSql, schema);
  return { schema, isHome: schema === HOME_SCHEMA, ...state };
});

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(s.sessions).values({ id: hashToken(token), userId, expiresAt });
  await db.update(s.users).set({ lastLoginAt: new Date() }).where(eq(s.users.id, userId));
  const store = await cookies();
  store.set(COOKIE, token, cookieOptions(expiresAt));
  // الشركة التي ينتمي لها المستخدم؛ الجلسة نفسها محفوظة داخل مخطط الشركة فلا يفيد تزوير هذه القيمة
  store.set(TENANT_COOKIE, await currentSchema(), cookieOptions(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)));
}

/** معرّف جلسة هذا الجهاز (مخزن مُجزّأً كما في الجدول). */
export async function currentSessionId() {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? hashToken(token) : null;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await db.delete(s.sessions).where(eq(s.sessions.id, hashToken(token)));
  // يبقى ملف الشركة بعد الخروج لتظهر هويتها في صفحة الدخول؛ لا يمنح أي صلاحية بلا جلسة
  store.delete(COOKIE);
}

export interface CurrentUser {
  id: number;
  name: string;
  login: string;
  roles: { id: number; key: string | null; nameAr: string }[];
  perms: PermissionSet;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  if ((await getTenant()).blocked) return null; // انتهت التجربة أو أوقف الاشتراك
  const [row] = await db
    .select({ id: s.users.id, name: s.users.name, login: s.users.login })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.id, hashToken(token)), gt(s.sessions.expiresAt, new Date()), eq(s.users.isActive, true), or(isNull(s.users.expiresAt), gt(s.users.expiresAt, new Date()))));
  if (!row) return null;

  const roles = await db
    .select({ id: s.roles.id, key: s.roles.key, nameAr: s.roles.nameAr })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(eq(s.userRoles.userId, row.id));
  const rows = await db
    .select({ entity: s.rolePermissions.entity, action: s.rolePermissions.action, scope: s.rolePermissions.scope })
    .from(s.rolePermissions)
    .innerJoin(s.userRoles, eq(s.userRoles.roleId, s.rolePermissions.roleId))
    .where(eq(s.userRoles.userId, row.id));

  return {
    ...row,
    roles,
    perms: { isAdmin: roles.some((r) => r.key === "admin"), rows: rows as { entity: string; action: string; scope: Scope }[] },
  };
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(entity: Entity, action: Action) {
  const user = await requireUser();
  if (!can(user.perms, entity, action)) redirect("/?denied=1");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.perms.isAdmin) redirect("/?denied=1");
  return user;
}

/** مالك المنصة (صاحب الحساب الرئيسي في شركة البداية): وحده يحذف شركات العملاء نهائياً. */
export const PLATFORM_OWNER_LOGIN = (process.env.PLATFORM_OWNER_LOGIN || "admin").toLowerCase();

export async function isPlatformOwner(user: CurrentUser) {
  return (await getTenant()).isHome && user.login.toLowerCase() === PLATFORM_OWNER_LOGIN;
}
