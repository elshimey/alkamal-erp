import { daysBetween } from "@/lib/dates";
import { Badge } from "@/components/ui";
import { EXPIRY_ALERT_DAYS } from "@/data/fleet";

export function ExpiryBadge({ expiryDate, today }: { expiryDate: string; today: string }) {
  const left = daysBetween(today, expiryDate);
  if (left < 0) return <Badge tone="red">منتهية منذ {-left} يوم</Badge>;
  if (left <= EXPIRY_ALERT_DAYS) return <Badge tone="amber">تنتهي بعد {left} يوم</Badge>;
  return <Badge tone="green">سارية</Badge>;
}
