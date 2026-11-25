// أنماط بطاقات الجوال المشتركة. في ملف عادي (لا "use client") لأن صفحات الخادم تستوردها:
// الثابت المصدَّر من ملف عميل يصل لصفحة الخادم مرجعاً لا نصاً، فتفقد البطاقة شكلها.
export type Tone = "gray" | "blue" | "amber" | "green" | "red";

// الخط الملون على حافة البطاقة بلون الحالة (نفس DocCard)
export const STRIPE: Record<Tone, string> = {
  gray: "before:bg-st-neutral-dot",
  blue: "before:bg-st-info-dot",
  amber: "before:bg-st-warn-dot",
  green: "before:bg-st-ok-dot",
  red: "before:bg-st-bad-dot",
};

export const cardShell =
  "relative block w-full overflow-hidden rounded-[18px] bg-white px-3.5 pt-3.5 pb-3 text-start shadow-[0_1px_2px_rgba(27,33,38,0.06),0_4px_14px_-6px_rgba(27,33,38,0.14)] transition before:absolute before:inset-y-3.5 before:right-0 before:w-[3px] before:rounded-e-[3px]";
