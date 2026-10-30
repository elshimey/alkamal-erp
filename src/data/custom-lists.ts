import { PLATE_TYPES } from "@/data/waybills";

// القوائم الثابتة التي يضيف لها المستخدم عناصر من القائمة المنسدلة نفسها.
// كل عنصر جديد يختار «يتصرف مثل» قيمة أساسية، فلا يتغير منطق البرنامج (الوثائق والإسناد والقيود).
// القيمة في النماذج: «الأساسية» للعنصر الأصلي، و«الأساسية~رقم» للعنصر المضاف.

export const CUSTOM_LISTS = {
  asset_kind: {
    label: "نوع الأصل",
    base: { head: "رأس (شاحنة)", trailer: "مقطورة (سطحة)" } as Record<string, string>,
    hint: "الرأس يُسند للسائق وله وثائق الرأس، والمقطورة تُختار في الشحنة ولها وثائق المقطورة",
  },
  vehicle_status: {
    label: "حالة المركبة",
    base: { active: "تعمل", maintenance: "في الصيانة", stopped: "متوقفة", sold: "مباعة" } as Record<string, string>,
    hint: "«تعمل» فقط تُسند للسائقين، و«مباعة» لا تُطالب بوثائق",
  },
  ownership: {
    label: "الملكية",
    base: { owned: "مملوكة", leased: "مستأجرة" } as Record<string, string>,
    hint: "",
  },
  plate_type: {
    label: "نوع اللوحة",
    base: PLATE_TYPES as Record<string, string>,
    hint: "القيمة الأساسية هي ما يُرسل في وثيقة النقل",
  },
  // قائمة حرة: القيمة هي الاسم نفسه
  violation_type: { label: "نوع المخالفة", base: null, hint: "" },
} as const;
export type CustomList = keyof typeof CUSTOM_LISTS;
export const isCustomList = (k: string): k is CustomList => k in CUSTOM_LISTS;

/** «head~12» → { base: "head", classId: 12 }؛ «head» → { base: "head", classId: null } */
export function splitCustom(value: unknown): { base: string | null; classId: number | null } {
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return { base: null, classId: null };
  const [base, id] = raw.split("~");
  const classId = Number(id);
  return { base, classId: id && Number.isInteger(classId) && classId > 0 ? classId : null };
}

export const joinCustom = (base: unknown, classId: unknown) => (base == null || base === "" ? "" : classId ? `${base}~${classId}` : String(base));
