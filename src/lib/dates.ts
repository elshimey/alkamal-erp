/** تاريخ اليوم بتوقيت الرياض بصيغة YYYY-MM-DD. */
export function todayRiyadh(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(now);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
