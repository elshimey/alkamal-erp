import { daysBetween } from "@/lib/dates";
import { Badge } from "@/components/ui";

/** حالة الوثيقة: منتهية، أو تنتهي خلال أول مرحلة تنبيه لنوعها، أو سارية. */
export function ExpiryBadge({ expiryDate, today, window = 60 }: { expiryDate: string | null; today: string; window?: number }) {
  if (!expiryDate) return <Badge tone="green">لا تنتهي</Badge>;
  const left = daysBetween(today, expiryDate);
  if (left < 0) return <Badge tone="red">منتهية منذ {-left} يوم</Badge>;
  if (left === 0) return <Badge tone="red">تنتهي اليوم</Badge>;
  if (left <= window) return <Badge tone="amber">تنتهي بعد {left} يوم</Badge>;
  return <Badge tone="green">سارية</Badge>;
}
