// ثوابت محضر استلام وتسليم المركبة (تُستخدم في المتصفح والخادم)
import type { HandoverKind } from "@/db/schema";

export type FuelLevel = "quarter" | "half" | "three_quarters" | "full";

export const HANDOVER_KIND: Record<HandoverKind, { title: string; en: string; short: string }> = {
  receive: { title: "محضر استلام مركبة", en: "Vehicle Receipt", short: "استلام من الشركة" },
  return: { title: "محضر تسليم مركبة للشركة", en: "Vehicle Return to Company", short: "تسليم للشركة" },
  transfer: { title: "محضر تسليم مركبة لسائق آخر", en: "Vehicle Handover to Another Driver", short: "تسليم لسائق آخر" },
};
export const FUEL_LEVEL: Record<FuelLevel, string> = { quarter: "ربع", half: "نصف", three_quarters: "ثلاثة أرباع", full: "ممتلئ" };
export const CONDITION: Record<"good" | "notes", string> = { good: "سليمة", notes: "بها ملاحظات" };

/** أكثر العدد والأدوات استخداماً، تظهر أزراراً سريعة مع ما استُخدم سابقاً. */
export const DEFAULT_HANDOVER_ITEMS = ["إطار احتياطي", "رافعة (جك)", "طفاية حريق", "مثلث عاكس", "شنطة عدة", "حزام ربط", "جهاز تتبع", "كاميرا داش"];

