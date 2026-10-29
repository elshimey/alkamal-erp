// يحوّل أخطاء قاعدة البيانات إلى رسائل مفهومة للمستخدم
export function errorMessage(err: unknown): string {
  const pg = findPgError(err);
  if (pg?.code === "23505") return pg.message && /[؀-ۿ]/.test(pg.message) ? pg.message : "هذه القيمة مسجلة مسبقاً";
  if (pg?.code === "23503") return "السجل مرتبط ببيانات أخرى";
  if (pg?.code === "40P01") return "تزامنت العملية مع عملية أخرى على البيانات نفسها؛ أعد المحاولة";
  if (pg?.code === "23514" && pg.message && /[؀-ۿ]/.test(pg.message)) return pg.message;
  if (err instanceof Error && /[؀-ۿ]/.test(err.message)) return err.message;
  console.error(err);
  report(err);
  return "حدث خطأ غير متوقع";
}

/** يسجّل الخطأ غير المتوقع وينبّه مالك المنصة (src/lib/error-log.ts)؛ بعد انتهاء الطلب حتى لا يبطئه. */
function report(err: unknown) {
  void (async () => {
    const { recordError } = await import("@/lib/error-log");
    try {
      const { after } = await import("next/server");
      after(() => recordError(err));
    } catch {
      await recordError(err); // خارج طلب ويب
    }
  })().catch(() => {});
}

export function findPgError(err: unknown): { code?: string; message?: string } | undefined {
  let e = err as { code?: string; message?: string; cause?: unknown } | undefined;
  for (let i = 0; e && i < 5; i++) {
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    e = e.cause as typeof e;
  }
  return undefined;
}
