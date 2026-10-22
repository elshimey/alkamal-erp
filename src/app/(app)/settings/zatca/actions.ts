"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { disconnect, onboard, pendingDocuments, sandboxTest, setAutoSend, submitDocument } from "@/lib/zatca/service";
import type { FormState } from "@/components/action-form";

const refresh = () => {
  revalidatePath("/settings/zatca");
  revalidatePath("/invoices");
};

export async function testAction(): Promise<FormState> {
  const user = await requireAdmin();
  const r = await sandboxTest(db, user.id);
  refresh();
  return r.ok ? { ok: "نجحت التجربة كاملة على بيئة المطورين لدى الهيئة" } : { error: "لم تكتمل التجربة؛ التفاصيل في الخطوات أدناه" };
}

export async function onboardAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const env = fd.get("environment") === "production" ? "production" : "simulation";
  try {
    const r = await onboard(db, env, String(fd.get("otp") ?? ""), user.id);
    refresh();
    if (r.ok) return { ok: `تم الربط بنجاح (${env === "production" ? "الإنتاج" : "المحاكاة"}). الفواتير الصادرة تُرسل للاعتماد من الآن.` };
    const failed = r.steps.find((s) => !s.ok);
    return { error: `توقف الربط عند «${failed?.step}»${failed?.detail ? `: ${failed.detail}` : ""}` };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function autoSendAction(on: boolean): Promise<FormState> {
  await requireAdmin();
  await setAutoSend(db, on);
  refresh();
  return { ok: on ? "سيُرسل كل مستند للهيئة فور إصداره" : "أُوقف الإرسال التلقائي؛ أرسل من الفاتورة يدوياً" };
}

export async function disconnectAction(): Promise<FormState> {
  const user = await requireAdmin();
  await disconnect(db, user.id);
  refresh();
  return { ok: "أُلغي الربط. يمكنك الربط من جديد برمز تفعيل جديد" };
}

/** إرسال كل الفواتير والإشعارات الصادرة غير المعتمدة، بالترتيب. */
export async function sendPendingAction(): Promise<FormState> {
  const user = await requireAdmin();
  const { invoices, notes } = await pendingDocuments(db);
  let ok = 0;
  const errors: string[] = [];
  for (const [src, number] of [...invoices.map((i) => [{ invoiceId: i.id }, i.number] as const), ...notes.map((n) => [{ noteId: n.id }, n.number] as const)]) {
    try {
      const row = await submitDocument(db, src, user.id);
      if (row.status === "cleared" || row.status === "cleared_warnings") ok++;
      else errors.push(`${number}: ${(row.errors as string[]).join(" · ")}`);
    } catch (err) {
      errors.push(`${number}: ${errorMessage(err)}`);
      if (/غير مربوط|تعذر الاتصال/.test(errorMessage(err))) break;
    }
  }
  refresh();
  return { ok: ok ? `اعتمدت الهيئة ${ok} مستنداً` : undefined, error: errors.length ? errors.slice(0, 20).join("\n") : ok ? undefined : "لا توجد مستندات بانتظار الإرسال" };
}
