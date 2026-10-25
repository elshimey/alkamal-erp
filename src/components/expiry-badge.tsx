import { Badge } from "@/components/ui";
import { alertStage } from "@/lib/documents";

/** حالة الوثيقة حسب مراحل تنبيه نوعها: سارية، ثم خلال 60 / 30 / 7 يوماً، ثم يوم الانتهاء، ثم منتهية. */
export function ExpiryBadge({ expiryDate, today, alertDays }: { expiryDate: string | null; today: string; alertDays?: string | null }) {
  if (!expiryDate) return <Badge tone="green">لا تنتهي</Badge>;
  const stage = alertStage(expiryDate, today, alertDays ?? "60,30,7");
  if (!stage) return <Badge tone="green">سارية</Badge>;
  if (stage.stage === "overdue" || stage.stage === "today") return <Badge tone="red">{stage.label}</Badge>;
  // آخر مرحلة (أصغر عدد أيام) عاجلة
  const last = Math.min(...(alertDays ?? "60,30,7").split(",").map(Number).filter((n) => n > 0));
  return <Badge tone={stage.stage <= last ? "red" : "amber"}>تنتهي بعد {stage.left} يوم</Badge>;
}
