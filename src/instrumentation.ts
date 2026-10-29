import type { Instrumentation } from "next";

// الأخطاء التي لم تُلتقط في الصفحات والإجراءات تُسجَّل وينبَّه بها المالك (src/lib/error-log.ts)
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("@/lib/error-log");
  await recordError(err, { path: request.path });
};
