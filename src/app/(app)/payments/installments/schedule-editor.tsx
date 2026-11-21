"use client";

import { useState } from "react";
import { Input } from "@/components/ui";
import { isoToDmy } from "@/components/date-input";
import { generateSchedule, parseAmount, parsePastedSchedule, type ScheduleRow } from "@/lib/installment-schedule";
import { fmt } from "@/lib/format";

const cell = "w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm ltr-nums outline-none focus:border-brand-500";
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * سطور جدول الأقساط في نافذة الإنشاء (القرار 3): تُولَّد من القسط الشهري وعدده وأول تاريخ،
 * أو تُلصق من جدول البنك في Excel (التاريخ، الأصل، تكلفة التمويل)، وكل سطر يُعدَّل قبل الحفظ.
 */
export function ScheduleEditor({ paste: startPaste = false, today }: { paste?: boolean; today: string }) {
  const [mode, setMode] = useState<"generate" | "paste">(startPaste ? "paste" : "generate");
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [gen, setGen] = useState({ amount: "", cost: "", count: "12", firstDate: today, day: "" });
  const [error, setError] = useState<string[]>([]);

  const generate = () => {
    try {
      setRows(generateSchedule({ amount: parseAmount(gen.amount) ?? 0, cost: parseAmount(gen.cost) ?? 0, count: Number(gen.count), firstDate: gen.firstDate, day: Number(gen.day) || undefined }));
      setError([]);
    } catch (e) {
      setError([e instanceof Error ? e.message : String(e)]);
    }
  };
  const onPaste = (text: string) => {
    const r = parsePastedSchedule(text);
    setRows(r.rows);
    setError(r.errors);
  };
  const edit = (i: number, patch: Partial<ScheduleRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((t, r) => ({ principal: r2(t.principal + r.principal), cost: r2(t.cost + r.cost) }), { principal: 0, cost: 0 });

  return (
    <div className="flex flex-col gap-3 text-sm">
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <div className="flex gap-2" role="tablist">
        {(["generate", "paste"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full border px-3 py-1 ${mode === m ? "border-brand-600 bg-brand-50 font-semibold text-brand-900" : "border-gray-200 bg-white text-gray-600"}`}
          >
            {m === "generate" ? "توليد من القسط الشهري" : "لصق جدول البنك من Excel"}
          </button>
        ))}
      </div>

      {mode === "generate" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-gray-700">مبلغ القسط الشهري</span>
            <Input inputMode="decimal" value={gen.amount} onChange={(e) => setGen({ ...gen, amount: e.target.value })} placeholder="5,000" data-field="amount" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-gray-700">منه تكلفة تمويل</span>
            <Input inputMode="decimal" value={gen.cost} onChange={(e) => setGen({ ...gen, cost: e.target.value })} placeholder="0" data-field="cost" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-gray-700">عدد الأقساط</span>
            <Input inputMode="numeric" value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value })} data-field="count" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-gray-700">تاريخ أول قسط</span>
            <Input type="date" value={gen.firstDate} onChange={(e) => setGen({ ...gen, firstDate: e.target.value })} data-field="firstDate" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-gray-700">يوم الاستحقاق</span>
            <Input inputMode="numeric" value={gen.day} onChange={(e) => setGen({ ...gen, day: e.target.value })} placeholder="يوم أول قسط" data-field="day" />
          </label>
          <div className="sm:col-span-2 lg:col-span-5">
            <button type="button" onClick={generate} className="rounded-lg border border-brand-600 bg-brand-50 px-4 py-2 font-semibold text-brand-900 hover:bg-brand-100">
              توليد الأقساط
            </button>
          </div>
        </div>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="font-medium text-gray-700">انسخ من Excel ثلاثة أعمدة: التاريخ، الأصل، تكلفة التمويل (اختيارية)، ثم الصق هنا</span>
          <textarea
            rows={5}
            dir="ltr"
            className="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs outline-none focus:border-brand-500"
            placeholder={"25/01/2027\t4,500\t500\n25/02/2027\t4,520\t480"}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData("text");
              e.currentTarget.value = text;
              onPaste(text);
            }}
            onChange={(e) => onPaste(e.target.value)}
            data-field="paste"
          />
        </label>
      )}

      {error.length > 0 && (
        <ul role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
          {error.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-2 py-2 text-start">#</th>
                <th className="px-2 py-2 text-start">تاريخ الاستحقاق</th>
                <th className="px-2 py-2 text-start">الأصل</th>
                <th className="px-2 py-2 text-start">تكلفة التمويل</th>
                <th className="px-2 py-2 text-start">القسط</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-2 py-1 text-gray-500 ltr-nums">{i + 1}</td>
                  <td className="px-2 py-1">
                    <Input type="date" value={r.dueDate} onChange={(e) => edit(i, { dueDate: e.target.value })} aria-label={`تاريخ القسط ${i + 1}`} />
                  </td>
                  <td className="px-2 py-1">
                    <input className={cell} inputMode="decimal" defaultValue={r.principal} key={`p${i}-${r.principal}`} onBlur={(e) => edit(i, { principal: parseAmount(e.target.value) ?? 0 })} aria-label={`أصل القسط ${i + 1}`} />
                  </td>
                  <td className="px-2 py-1">
                    <input className={cell} inputMode="decimal" defaultValue={r.cost} key={`c${i}-${r.cost}`} onBlur={(e) => edit(i, { cost: parseAmount(e.target.value) ?? 0 })} aria-label={`تكلفة القسط ${i + 1}`} />
                  </td>
                  <td className="px-2 py-1 font-medium ltr-nums">{fmt(r2(r.principal + r.cost))}</td>
                  <td className="px-2 py-1">
                    <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`حذف القسط ${i + 1}`} className="rounded px-2 text-gray-400 hover:bg-red-50 hover:text-red-600">
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold">
              <tr>
                <td className="px-2 py-2" colSpan={2}>
                  {rows.length} قسط، من {isoToDmy(rows[0].dueDate)} إلى {isoToDmy(rows[rows.length - 1].dueDate)}
                </td>
                <td className="px-2 py-2 ltr-nums">{fmt(total.principal)}</td>
                <td className="px-2 py-2 ltr-nums">{fmt(total.cost)}</td>
                <td className="px-2 py-2 ltr-nums">{fmt(r2(total.principal + total.cost))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        الأصل يُخصم من حساب الدائن، وتكلفة التمويل تُقيد على 7101 «تكاليف التمويل» يوم استحقاق كل قسط ولو لم يُسدد. مجموع الأصل يساوي عادةً رصيد الدين في الحساب.
      </p>
    </div>
  );
}
