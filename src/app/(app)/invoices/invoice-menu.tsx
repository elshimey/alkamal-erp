import type { MenuItem } from "@/components/actions-menu";
import { hasOfficialNumber, mergedParts, type salesInvoiceDoc } from "@/lib/invoices";
import type { ReactNode } from "react";
import { fmt } from "@/lib/format";
import { removeFromMenu, revertFromMenu, sendInvoiceToDriver, unmerge, unsendInvoiceFromDriver } from "./actions";

type InvoiceRow = NonNullable<Awaited<ReturnType<typeof salesInvoiceDoc>>>;

/** عمليات الفاتورة الواحدة في قائمة «العمليات» (المعاينة وصفحة الفاتورة). */
export function invoiceActions(
  i: InvoiceRow["i"],
  lines: InvoiceRow["lines"],
  back: string,
  p: { canUpdate: boolean; canRevert: boolean; canDelete: boolean; canSend?: boolean; editHref: string; trips?: InvoiceRow["trips"]; cashField?: ReactNode },
): MenuItem[] {
  const items: MenuItem[] = [];
  const draft = i.status === "draft";
  const parts = mergedParts(lines);
  const waybills = new Set(lines.filter((l) => l.kind === "waybill").map((l) => l.waybillId)).size;
  if (draft && p.canUpdate) items.push({ label: "تعديل", icon: "pencil", hint: "البيانات والبنود الإضافية", href: p.editHref });
  if (draft && p.canUpdate && parts > 1)
    items.push({
      label: "فك الدمج",
      icon: "undo",
      hint: `تصبح ${parts} فواتير مسودة مستقلة`,
      action: unmerge.bind(null, i.id),
      confirm: {
        title: `فك دمج الفاتورة ${i.number}`,
        text: `في الفاتورة ${waybills ? `${waybills} شحنة` : ""}${waybills && parts > waybills ? " وفواتير مدمجة" : !waybills ? "فواتير مدمجة" : ""}. تبقى هذه الفاتورة بأول جزء، وكل جزء آخر يصبح فاتورة مسودة مستقلة برقم مسودة جديد. لا يُحذف شيء.`,
        submit: "فك الدمج",
      },
    });
  if (!draft && p.canRevert)
    items.push({
      label: "إرجاع إلى مسودة",
      icon: "undo",
      hint: "يُلغى قيد الإيراد وتبقى برقمها",
      disabled: (Number(i.paidAmount) > 0 && "عليها دفعة سداد؛ احذف الدفعة أو أرجعها أولاً") || (i.zatcaStatus === "accepted" && "معتمدة لدى هيئة الزكاة؛ تُصحح بإشعار دائن"),
      action: revertFromMenu.bind(null, i.id),
      confirm: { title: `إرجاع الفاتورة ${i.number} إلى مسودة`, text: "يُلغى قيد الإيراد والضريبة وتعود الفاتورة مسودة لتعديلها، وتحتفظ برقمها الرسمي نفسه.", submit: "إرجاع" },
    });
  const trips = p.trips ?? [];
  const sendable = trips.filter((w) => !w.sentAt && w.status !== "rejected");
  const sent = trips.filter((w) => w.sentAt);
  if (p.canSend && sendable.length) {
    const custody = sendable.reduce((t, w) => t + Number(w.custody), 0);
    items.push({
      label: "إرسال للسائق",
      icon: "truck",
      hint: custody > 0 ? `مع عهدة رحلة ${fmt(custody)}` : "تظهر رحلتها في تطبيق السائق",
      divider: items.length > 0,
      action: sendInvoiceToDriver.bind(null, i.id),
      confirm: {
        title: `إرسال رحلة الفاتورة ${i.number} للسائق`,
        text: `تظهر الرحلة (${sendable.map((w) => w.number).join("، ")}) في تطبيق السائق${custody > 0 ? `، وتُقيد عليه عهدة الرحلة ${fmt(custody)} بسند صرف عهدة` : ""}.`,
        submit: "إرسال",
        fields: custody > 0 ? p.cashField : undefined,
      },
    });
  }
  if (p.canSend && sent.length)
    items.push({
      label: "إلغاء الإرسال للسائق",
      icon: "undo",
      hint: "تُسحب من تطبيقه وتُعكس عهدتها",
      action: unsendInvoiceFromDriver.bind(null, i.id),
      confirm: {
        title: `إلغاء إرسال رحلة الفاتورة ${i.number}`,
        text: "تُسحب الرحلة من تطبيق السائق ويُعكس سند عهدتها، فتصبح الفاتورة ورحلتها قابلتين للتعديل والحذف. لا يتم إن كان السائق سجّل عليها تحميلاً أو تسليماً أو مصروفاً.",
        submit: "إلغاء الإرسال",
      },
    });
  items.push({ label: "طباعة", icon: "printer", href: `/invoices/${i.id}?print=1`, newTab: true, divider: items.length > 0 });
  if (draft && p.canDelete)
    items.push({
      label: "حذف المسودة",
      icon: "trash",
      danger: true,
      divider: true,
      disabled: (hasOfficialNumber(i) && "أُصدرت سابقاً برقم رسمي؛ لا تُحذف حفاظاً على تسلسل الفواتير") || (trips.some((w) => w.linked && w.sentAt) && "رحلتها مرسلة للسائق؛ ألغِ الإرسال أولاً"),
      action: removeFromMenu.bind(null, i.id, back),
      confirm: {
        title: `حذف الفاتورة المسودة ${i.number}`,
        text: waybills ? `تُحذف المسودة وتعود شحناتها (${waybills}) «معتمدة · بانتظار الفوترة». تُحفظ نسخة في سجل المحذوفات.` : "تُحذف المسودة وبنودها، وتُحفظ نسخة في سجل المحذوفات.",
        submit: "حذف المسودة",
        fields: (
          <label className="block text-sm">
            <span className="mb-1 block text-gray-600">سبب الحذف</span>
            <input name="reason" required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="مثال: أُنشئت بالخطأ" />
          </label>
        ),
      },
    });
  return items;
}

