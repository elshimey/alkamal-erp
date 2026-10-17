import { describe, expect, it } from "vitest";
import { ALL_ENTITIES, CORE_ROLES, ENTITIES, can, hasSpecial, scopeFor, type PermissionSet } from "@/lib/permissions";

const roleSet = (key: string): PermissionSet => {
  const role = CORE_ROLES.find((r) => r.key === key)!;
  return { isAdmin: key === "admin", rows: role.permissions };
};

describe("الصلاحيات", () => {
  it("مدير النظام يملك كل شيء", () => {
    const p = roleSet("admin");
    for (const e of ALL_ENTITIES) expect(can(p, e, "delete")).toBe(true);
    expect(hasSpecial(p, "override_controls")).toBe(true);
  });

  it("المدير يعرض ويعتمد بلا إعدادات ولا مستخدمين ولا حذف", () => {
    const p = roleSet("manager");
    expect(can(p, "waybills", "view")).toBe(true);
    expect(can(p, "maintenance", "approve")).toBe(true);
    expect(can(p, "users", "view")).toBe(false);
    expect(can(p, "settings", "update")).toBe(false);
    expect(can(p, "waybills", "delete")).toBe(false);
    expect(hasSpecial(p, "override_controls")).toBe(true);
  });

  it("المحاسب يرحّل ويُرجع في المالية ويعرض التشغيل فقط", () => {
    const p = roleSet("accountant");
    expect(can(p, "journal_entries", "approve")).toBe(true);
    expect(can(p, "journal_entries", "revert")).toBe(true);
    expect(can(p, "fiscal_periods", "update")).toBe(true);
    expect(can(p, "vehicles", "view")).toBe(true);
    expect(can(p, "vehicles", "update")).toBe(false);
    expect(can(p, "waybills", "approve")).toBe(false);
    expect(can(p, "journal_entries", "delete")).toBe(false);
  });

  it("السائق سجلاته فقط ولا يرى الأسعار", () => {
    const p = roleSet("driver");
    expect(scopeFor(p, "waybills", "create")).toBe("own");
    expect(can(p, "waybills", "approve")).toBe(false);
    expect(can(p, "journal_entries", "view")).toBe(false);
    expect(hasSpecial(p, "view_prices")).toBe(false);
  });

  it("النطاق الأوسع يغلب عند تعدد الأدوار", () => {
    const p: PermissionSet = {
      isAdmin: false,
      rows: [
        { entity: "expenses", action: "view", scope: "own" },
        { entity: "expenses", action: "view", scope: "all" },
      ],
    };
    expect(scopeFor(p, "expenses", "view")).toBe("all");
  });

  it("كل كيان مربوط بوحدة معروفة", () => {
    for (const e of ALL_ENTITIES) expect(ENTITIES[e].module).toBeTruthy();
  });
});
