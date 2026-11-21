// اللوحة: أحرف وأرقام. تُحفظ نصاً واحداً «أ ب ج 1234»، وتُقارن دون مسافات وبصور الحروف الموحدة
// فلا تُسجَّل المركبة نفسها مرتين لاختلاف الكتابة («ابج1234» و«أ ب ج 1234»).

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const digits = (t: string) => t.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));

/** مفتاح المقارنة: بلا مسافات أو شرطات، والألف والهاء والياء بصورة واحدة. */
export const plateKey = (plate: string | null | undefined) =>
  digits(String(plate ?? ""))
    .toLowerCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ةه]/g, "ه")
    .replace(/ى/g, "ي");

/** يفصل اللوحة إلى أحرفها وأرقامها (للعرض في خانتين). */
export function splitPlate(plate: string | null | undefined) {
  const t = digits(String(plate ?? "")).trim();
  return { letters: t.replace(/[0-9]/g, "").replace(/\s+/g, " ").trim(), numbers: t.replace(/[^0-9]/g, "") };
}

/** يجمع الخانتين: الأحرف مفصولة بمسافات ثم الأرقام، مثل «أ ب ج 1234». */
export function joinPlate(letters: string, numbers: string) {
  const l = letters.replace(/\s+/g, "").split("").join(" ");
  return [l, digits(numbers).replace(/\s+/g, "")].filter(Boolean).join(" ").trim();
}

/**
 * الصيغة الموحدة للحفظ «ا ب ج 1234» مهما كُتبت: «9668 / ا ر ه» و«/ ا د ع 1355» و«اره9668».
 * الأحرف فقط (تُحذف الشرطات والخطوط المائلة والمسافات) مفصولة بمسافة ثم الأرقام، و«هـ» تبقى حرفاً واحداً.
 * اللوحة بلا أحرف عربية (أجنبية) تبقى كما كُتبت مع توحيد المسافات، وكذلك الاسم الوصفي الذي فيه أكثر من
 * أربعة أحرف (مثل «ميكروباص خالو محمد») لأنه ليس لوحة سعودية ولا يُفرَّق حرفاً حرفاً.
 */
/** اللوحة السعودية ثلاثة أحرف؛ أكثر من أربعة يعني اسماً وصفياً لا لوحة. */
export const MAX_PLATE_LETTERS = 4;

export function normalizePlate(plate: string | null | undefined) {
  const t = digits(String(plate ?? "")).trim().replace(/\s+/g, " ");
  if (!/[\u0621-\u064A]/.test(t)) return t;
  const letters = t.replace(/[^\p{L}]/gu, "").match(/[^\u0640]\u0640*/gu) ?? [];
  if (letters.length > MAX_PLATE_LETTERS) return t;
  const numbers = t.replace(/[^0-9]/g, "");
  return [...letters, numbers].filter(Boolean).join(" ");
}
