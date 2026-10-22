import Link from "next/link";
import type * as s from "@/db/schema";
import { DOC_STATUS } from "@/lib/zatca/service";
import { ActionForm, SubmitButton, type FormState } from "@/components/action-form";
import { Badge } from "@/components/ui";

/** حالة المستند لدى الهيئة (المرحلة الثانية) مع زر الإرسال أو إعادة الإرسال. */
export function ZatcaPanel({
  doc,
  connected,
  send,
  blocker,
  partyHref,
}: {
  doc: typeof s.zatcaDocuments.$inferSelect | null;
  connected: boolean;
  send?: (state: FormState, data: FormData) => Promise<FormState>;
  /** ما ينقص قبل الإرسال */
  blocker?: string | null;
  partyHref?: string;
}) {
  const cleared = doc && (doc.status === "cleared" || doc.status === "cleared_warnings");
  const notes = doc ? [...(doc.errors as string[]), ...doc.warnings] : [];
  return (
    <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${cleared ? "border-green-200 bg-green-50/60" : doc ? "border-red-200 bg-red-50/60" : "border-gray-200 bg-gray-50"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-gray-800">الفوترة الإلكترونية:</span>
        {doc ? <Badge tone={DOC_STATUS[doc.status].tone}>{DOC_STATUS[doc.status].label}</Badge> : <Badge>لم تُرسل للهيئة</Badge>}
        {doc && (
          <span className="ltr-nums text-xs text-gray-500">
            #{doc.icv} · {doc.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}
          </span>
        )}
        {!cleared && connected && send && (
          <ActionForm action={send} resetOnSuccess={false} className="ms-auto">
            <SubmitButton variant="secondary" pendingLabel="جارٍ الإرسال للهيئة…">
              {doc ? "إعادة الإرسال للهيئة" : "إرسال للهيئة"}
            </SubmitButton>
          </ActionForm>
        )}
        {!connected && (
          <Link href="/settings/zatca" className="ms-auto text-xs text-brand-700 hover:underline">
            النظام غير مربوط ببوابة فاتورة بعد ←
          </Link>
        )}
      </div>
      {!cleared && blocker && (
        <p className="mt-2 text-xs text-amber-800">
          {blocker}
          {partyHref && (
            <>
              {" "}
              <Link href={partyHref} className="font-medium underline">
                تعديل بيانات العميل
              </Link>
            </>
          )}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 ps-5 text-xs text-gray-700">
          {notes.map((n, i) => (
            <li key={i} className="break-words">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
