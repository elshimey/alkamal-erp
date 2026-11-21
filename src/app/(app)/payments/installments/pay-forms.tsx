import { AccountField } from "@/components/account-field";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DialogButton } from "@/components/dialog-button";
import { Badge, Input } from "@/components/ui";
import type { QuickOption } from "@/lib/quick-add-types";
import type { InstallmentState } from "@/lib/installments";
import { fmt } from "@/lib/format";
import { payInstallmentAction, payoffAction } from "./actions";

export type PayFrom = { suggested: QuickOption[]; all: QuickOption[]; first?: string };

/** خانة «السداد من» (القرار 6): الصناديق والبنوك والعهد أولاً، و«عرض كل الشجرة» لأي حساب 1xxx أو 2xxx. */
function PayFromField({ from }: { from: PayFrom }) {
  return (
    <div className="text-sm">
      <span className="mb-1.5 block font-medium text-gray-700">يُسدد من</span>
      <AccountField name="cashAccountId" options={from.suggested} moreOptions={from.all} defaultValue={from.first} scope="1101,1102,1105" required />
    </div>
  );
}

const STATES: Record<InstallmentState, { label: string; tone: "gray" | "blue" | "amber" | "green" | "red" }> = {
  paid: { label: "مسدد", tone: "green" },
  overdue: { label: "متأخر", tone: "red" },
  due: { label: "مستحق", tone: "amber" },
  upcoming: { label: "قادم", tone: "blue" },
  settled: { label: "أُقفل بالسداد المبكر", tone: "gray" },
};

export function InstallmentBadge({ state, partial }: { state: InstallmentState; partial?: boolean }) {
  const s = STATES[state];
  return <Badge tone={s.tone}>{partial && state !== "paid" ? `${s.label}، مسدد جزئياً` : s.label}</Badge>;
}

/** «سداد» القسط: المبلغ الافتراضي باقيه ويمكن تقليله، والباقي يبقى على القسط نفسه. */
export function PayInstallmentButton({ id, planId, title, remaining, today, from }: { id: number; planId: number; title: string; remaining: number; today: string; from: PayFrom }) {
  return (
    <DialogButton label="سداد" title={title}>
      <ActionForm action={payInstallmentAction.bind(null, id, planId)} resetOnSuccess={false} className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium text-gray-700">المبلغ</span>
          <Input name="amount" inputMode="decimal" defaultValue={remaining.toFixed(2)} required />
          <span className="text-xs text-gray-500">الباقي من القسط {fmt(remaining)}؛ مبلغ أقل يبقى باقيه على القسط نفسه.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-gray-700">تاريخ السداد</span>
          <Input type="date" name="date" defaultValue={today} required />
        </label>
        <PayFromField from={from} />
        <p className="text-xs text-gray-500">يُنشأ سند صرف مرحّل «سداد قسط»: مدين حساب الدائن، دائن الحساب المختار.</p>
        <SubmitButton>سداد</SubmitButton>
      </ActionForm>
    </DialogButton>
  );
}

/** «سداد مبكر»: المبلغ الذي يطلبه الدائن، وتُقفل الأقساط الباقية. */
export function PayoffButton({ planId, owed, today, from }: { planId: number; owed: number; today: string; from: PayFrom }) {
  return (
    <DialogButton label="سداد مبكر" title="سداد مبكر للجدول كله">
      <ActionForm action={payoffAction.bind(null, planId)} resetOnSuccess={false} className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium text-gray-700">المبلغ الذي يطلبه الدائن</span>
          <Input name="amount" inputMode="decimal" required />
          <span className="text-xs text-gray-500">
            الباقي في رصيد الدائن لهذا الجدول {fmt(owed)}. الزيادة عنه (رسوم السداد المبكر) أو النقص (خصم تكلفة لم تُستحق) يُقيد على 7101 «تكاليف التمويل».
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-gray-700">تاريخ السداد</span>
          <Input type="date" name="date" defaultValue={today} required />
        </label>
        <PayFromField from={from} />
        <SubmitButton>سداد مبكر وإقفال الجدول</SubmitButton>
      </ActionForm>
    </DialogButton>
  );
}
