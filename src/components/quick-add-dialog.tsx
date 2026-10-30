"use client";

// نافذة الإضافة السريعة: تفتح فوق المستند، تضيف العنصر، ثم تختاره في الخانة التي فُتحت منها.

import {
  Fragment,
  useEffect,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  quickAddAction,
  quickAddFormAction,
} from "@/app/(app)/quick-add/actions";
import type { QuickForm, QuickKind, QuickOption } from "@/lib/quick-add-types";
import { ComboBox } from "./combo-box";
import { PANEL_MESSAGE, type PanelMessage } from "./record-panel";
import { Truck } from "./icons";

/** رسالة قصيرة أسفل الشاشة تختفي وحدها. */
function toast(message: string) {
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.textContent = message;
  el.className =
    "fixed bottom-20 left-1/2 z-[95] -translate-x-1/2 rounded-xl bg-asphalt-900 px-4 py-2.5 text-sm text-white shadow-xl sm:bottom-6";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

const input =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

type DialogProps = {
  kind: QuickKind;
  scope?: string;
  initial?: string;
  onClose: () => void;
  onDone: (o: QuickOption) => void;
};

// المركبة والسائق يُضافان من المستند بنافذتهما الكاملة نفسها (البيانات والوثائق والمرفقات)
const FULL_PANEL: Partial<Record<QuickKind, string>> = { vehicle: "/vehicles", driver: "/drivers" };

export function QuickAddDialog(props: DialogProps) {
  return FULL_PANEL[props.kind] ? <PanelFrame {...props} base={FULL_PANEL[props.kind]!} /> : <QuickAddForm {...props} />;
}

/** نافذة السجل الكاملة مضمّنة فوق المستند؛ تُبلغ بالسجل المحفوظ فيُختار في الخانة. */
function PanelFrame({ base, initial, onClose, onDone }: DialogProps & { base: string }) {
  useEffect(() => {
    const listen = (e: MessageEvent<PanelMessage>) => {
      if (e.origin !== window.location.origin || e.data?.source !== PANEL_MESSAGE) return;
      if (e.data.type === "saved") {
        onDone({ value: String(e.data.id), label: e.data.label });
        toast(`أُضيف «${e.data.label}» واختير`);
      }
      onClose();
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [onClose, onDone]);
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-asphalt-900/40" onKeyDown={(e) => e.stopPropagation()} onPaste={(e) => e.stopPropagation()}>
      <iframe title="إضافة" src={`${base}?new=1&embed=1${initial ? `&q=${encodeURIComponent(initial)}` : ""}`} className="size-full border-0 bg-[#f7f6f3]" />
    </div>,
    document.body,
  );
}

function QuickAddForm({ kind, scope, initial, onClose, onDone }: DialogProps) {
  const [form, setForm] = useState<QuickForm | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, start] = useTransition();

  useEffect(() => {
    let live = true;
    quickAddFormAction(kind, scope).then((f) => {
      if (!live) return;
      if ("error" in f) return setError(f.error);
      setForm(f);
      setValues(
        Object.fromEntries(
          f.fields.map((x) => [
            x.key,
            x.key === f.primary && initial && x.type !== "select"
              ? initial
              : (x.default ?? ""),
          ]),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [kind, scope, initial]);

  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) =>
      e.key === "Escape" &&
      !document.querySelector("[role=listbox]") &&
      onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!form) return;
    const missing = form.fields.find(
      (f) =>
        f.required &&
        (!f.showIf || values[f.showIf] === "1") &&
        !values[f.key]?.trim(),
    );
    if (missing) return setError(`${missing.label} إلزامي`);
    setError(undefined);
    start(async () => {
      const res = await quickAddAction(kind, values, scope);
      if ("error" in res) return setError(res.error);
      onDone(res.option);
      if (res.message) toast(res.message);
      onClose();
    });
  };

  return createPortal(
    // الأحداث داخل النافذة لا تصل للشيت أو النموذج الذي فُتحت منه (النافذة ابنة له في شجرة React)
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-asphalt-900/40 p-4 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseEnter={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
      onCopy={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onFocus={(e) => e.stopPropagation()}
      onBlur={(e) => e.stopPropagation()}
    >
      <form
        dir="rtl"
        onSubmit={submit}
        className="my-6 w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={form?.title ?? "إضافة"}
      >
        <header className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
          <h2 className="font-display text-lg font-semibold text-gray-800">
            {form?.title ?? "إضافة"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="ms-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {!form && !error && (
            <div className="flex justify-center py-8">
              <Truck className="w-12" spinning />
            </div>
          )}
          {form && (
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              {form.fields
                .filter((f) => !f.showIf || values[f.showIf] === "1")
                .map((f, i) => (
                  <Fragment key={f.key}>
                    {f.section && (
                      <div className="mt-2 border-t border-gray-100 pt-3 text-xs font-semibold text-gray-500 sm:col-span-2">
                        {f.section}
                      </div>
                    )}
                    <div className={f.type === "check" ? "sm:col-span-2" : ""}>
                      {f.type === "check" ? (
                        <label className="flex items-start gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 accent-brand-600"
                            checked={values[f.key] === "1"}
                            onChange={(e) =>
                              set(f.key, e.target.checked ? "1" : "")
                            }
                          />
                          <span>
                            {f.label}
                            {f.hint && (
                              <span className="block text-xs text-gray-500">
                                {f.hint}
                              </span>
                            )}
                          </span>
                        </label>
                      ) : (
                        <label className="block text-sm">
                          <span className="mb-1 block text-gray-600">
                            {f.label}
                            {f.required && (
                              <span className="text-red-500"> *</span>
                            )}
                          </span>
                          {f.type === "select" ? (
                            <ComboBox
                              value={values[f.key] ?? ""}
                              options={f.options ?? []}
                              create={f.create}
                              onChange={(v) => set(f.key, v)}
                              placeholder="ابحث أو اختر…"
                              className={input}
                            />
                          ) : (
                            <input
                              autoFocus={i === 0 || f.key === form.primary}
                              type={f.type === "date" ? "date" : "text"}
                              inputMode={
                                f.type === "number" ? "decimal" : undefined
                              }
                              dir={
                                f.ltr || f.type === "number" ? "ltr" : undefined
                              }
                              autoCapitalize={f.ltr ? "none" : undefined}
                              value={values[f.key] ?? ""}
                              onChange={(e) => set(f.key, e.target.value)}
                              className={input}
                            />
                          )}
                          {f.hint && (
                            <span className="mt-0.5 block text-xs text-gray-400">
                              {f.hint}
                            </span>
                          )}
                        </label>
                      )}
                    </div>
                  </Fragment>
                ))}
            </div>
          )}
          {form?.note && (
            <p className="mt-4 text-xs text-gray-500">{form.note}</p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            إلغاء
          </button>
          {form && (
            <button
              disabled={saving}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-500 disabled:opacity-60"
            >
              {saving ? "جارٍ الحفظ…" : "إضافة واختيار"}
            </button>
          )}
        </footer>
      </form>
    </div>,
    document.body,
  );
}
