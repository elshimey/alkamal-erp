// معرّفات الإرسال التي تمنع تكرار العملية عند إعادة إرسال النموذج (انظر src/lib/once.ts)

export const newOpId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

const fnv = (text: string, seed: number) => {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};

/** معرّف صف في شيت: جلسة الحفظ + موضع الصف + بصمة محتواه. إعادة حفظ الشيت نفسه دون تعديل تعطي المعرّف نفسه. */
export function rowOpId(session: string, index: number, row: Record<string, string>) {
  const text = JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k]]));
  return `${session.replace(/-/g, "").slice(0, 12)}-${index}-${fnv(text, 0x811c9dc5)}${fnv(text, 0x9747b28c)}`;
}
