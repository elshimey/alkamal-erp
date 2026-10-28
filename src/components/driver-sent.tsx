/** حالة الإرسال للسائق، ظاهرة دائماً بجانب الحالة حتى لا تُرسل الرحلة مرتين. */
export function DriverSentTag({ sentAt, acceptedAt, fleet = true, partial }: { sentAt: Date | string | null; acceptedAt?: Date | string | null; fleet?: boolean; partial?: string }) {
  if (!fleet) return null;
  const cls = "mt-0.5 block text-xs whitespace-nowrap";
  if (partial) return <span className={`${cls} text-amber-700`}>{partial}</span>;
  if (!sentAt) return <span className={`${cls} text-gray-400`}>لم تُرسل للسائق</span>;
  return <span className={`${cls} ${acceptedAt ? "text-green-700" : "text-sky-700"}`}>{acceptedAt ? "✓ أُرسلت للسائق واستلمها" : "✓ أُرسلت للسائق"}</span>;
}
