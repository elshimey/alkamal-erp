// كل إجراء خادم (ملف يبدأ بـ "use server") يمكن لأي متصفح استدعاؤه مباشرة برقمه،
// فيجب أن يتحقق من الدخول والصلاحية بنفسه، أو يستدعي دالة في نفس الملف تتحقق منهما.
// هذا الفحص يمنع دمج إجراء جديد نُسي فيه التحقق.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// إجراءات عامة مقصودة: صفحات الدخول قبل وجود جلسة
const PUBLIC_ACTIONS = new Set([
  "src/app/login/actions.ts:requestAccess",
  "src/app/login/actions.ts:requestResetLink",
  "src/app/login/actions.ts:completeReset",
  "src/app/driver/login/actions.ts:chooseLanguage",
]);

// استدعاءات تتحقق من الجلسة أو الصلاحية (من src/lib/auth.ts وsrc/lib/driver-auth.ts وما يلفها)
const AUTH_CALL = /\b(require[A-Z]\w*|getCurrentUser|signIn|guard\w*)\s*\(/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/** يقسم الملف إلى دوال المستوى الأعلى: الاسم، هل هي مُصدَّرة، ونصها حتى الدالة التالية. */
function topLevelFunctions(src: string) {
  const re = /^(export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm;
  const marks = [...src.matchAll(re)];
  return marks.map((m, i) => ({
    name: m[2] ?? m[3],
    exported: !!m[1],
    body: src.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : src.length),
  }));
}

function unguardedActions(file: string) {
  const fns = topLevelFunctions(fs.readFileSync(file, "utf8"));
  const guarded = new Set(fns.filter((f) => AUTH_CALL.test(f.body)).map((f) => f.name));
  // دالة تستدعي دالة محمية في نفس الملف محمية أيضاً
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of fns) {
      if (guarded.has(f.name)) continue;
      if ([...guarded].some((g) => new RegExp(`\\b${g}\\s*\\(`).test(f.body))) {
        guarded.add(f.name);
        changed = true;
      }
    }
  }
  return fns.filter((f) => f.exported && !guarded.has(f.name)).map((f) => f.name);
}

describe("حماية إجراءات الخادم", () => {
  const files = walk("src").filter((f) => /^\s*["']use server["']/.test(fs.readFileSync(f, "utf8")));

  it("وجد ملفات الإجراءات", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("كل إجراء خادم يتحقق من الدخول والصلاحية", () => {
    const missing = files.flatMap((f) => unguardedActions(f).map((name) => `${f.split(path.sep).join("/")}:${name}`)).filter((k) => !PUBLIC_ACTIONS.has(k));
    expect(missing, "إجراءات بلا تحقق من الصلاحية (أضف requirePermission أو requireUser)").toEqual([]);
  });

  it("الفحص نفسه يكشف الإجراء غير المحمي", () => {
    const tmp = path.join(fs.mkdtempSync(path.join(process.cwd(), "node_modules", ".guard-")), "actions.ts");
    fs.writeFileSync(
      tmp,
      `"use server";\nasync function check() { await requirePermission("x", "y"); }\nexport async function safe(id: number) { await check(); return id; }\nexport async function open(id: number) { return deleteEverything(id); }\n`,
    );
    expect(unguardedActions(tmp)).toEqual(["open"]);
    fs.rmSync(path.dirname(tmp), { recursive: true });
  });
});
