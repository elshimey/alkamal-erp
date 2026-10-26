// بيانات وثيقة النقل كما تُحرَّر في نافذة الشحنة (نصوص)، وتحويلها من الشحنة المحفوظة وإليها.
import type { GoodsLine, TransportInput } from "@/lib/waybills";

export interface GoodsDraft {
  description: string;
  quantity: string;
  packageUnit: string;
  weight: string;
  weightUnit: string;
  dimensions: string;
  condition: string;
}

export interface TransportDraft {
  shipperPhone: string;
  shipperCity: string;
  shipperAddress: string;
  shipperNotes: string;
  consigneePhone: string;
  consigneeCity: string;
  deliveryAddress: string;
  consigneeNotes: string;
  pickupDate: string;
  expectedDeliveryDate: string;
  freightPayer: string;
  paymentMethod: string;
  freightInstructions: string;
  negotiable: boolean;
  logistiNumber: string;
  logistiStatus: string;
  goods: GoodsDraft[];
}

export const EMPTY_GOODS: GoodsDraft = { description: "", quantity: "", packageUnit: "", weight: "", weightUnit: "kg", dimensions: "", condition: "good" };

export const emptyTransport = (): TransportDraft => ({
  shipperPhone: "",
  shipperCity: "",
  shipperAddress: "",
  shipperNotes: "",
  consigneePhone: "",
  consigneeCity: "",
  deliveryAddress: "",
  consigneeNotes: "",
  pickupDate: "",
  expectedDeliveryDate: "",
  freightPayer: "shipper",
  paymentMethod: "credit",
  freightInstructions: "",
  negotiable: false,
  logistiNumber: "",
  logistiStatus: "none",
  goods: [],
});

/** بيانات جهة الاتصال المحفوظة (جوال، مدينة، عنوان) تُملأ تلقائياً عند اختيار المرسل أو المستلم. */
export type ContactCard = { phone?: string | null; city?: string | null; address?: string | null };

/** يملأ جوال ومدينة وعنوان المرسل أو المستلم من بطاقته إن كانت فارغة. */
export function fillContact(t: TransportDraft, side: "shipper" | "consignee", card: ContactCard | undefined): TransportDraft {
  if (!card) return t;
  const phone = side === "shipper" ? "shipperPhone" : "consigneePhone";
  const city = side === "shipper" ? "shipperCity" : "consigneeCity";
  const address = side === "shipper" ? "shipperAddress" : "deliveryAddress";
  return {
    ...t,
    [phone]: t[phone] || card.phone || "",
    [city]: t[city] || card.city || "",
    [address]: t[address] || card.address || "",
  };
}

type Row = {
  shipperPhone: string | null;
  shipperCity: string | null;
  shipperAddress: string | null;
  shipperNotes: string | null;
  consigneePhone: string | null;
  consigneeCity: string | null;
  deliveryAddress: string | null;
  consigneeNotes: string | null;
  pickupDate: string | null;
  expectedDeliveryDate: string | null;
  freightPayer: string;
  paymentMethod: string;
  freightInstructions: string | null;
  negotiable: boolean;
  logistiNumber: string | null;
  logistiStatus: string;
};
type GoodsRow = { description: string; quantity: string | null; packageUnit: string | null; weight: string | null; weightUnit: string; dimensions: string | null; condition: string };

const str = (v: string | null | undefined) => v ?? "";
const dec = (v: string | null | undefined) => (v == null ? "" : String(Number(v)));

/** من الشحنة المحفوظة وبضاعتها إلى قيم النافذة. */
export function toTransportDraft(w: Row, goods: GoodsRow[]): TransportDraft {
  return {
    shipperPhone: str(w.shipperPhone),
    shipperCity: str(w.shipperCity),
    shipperAddress: str(w.shipperAddress),
    shipperNotes: str(w.shipperNotes),
    consigneePhone: str(w.consigneePhone),
    consigneeCity: str(w.consigneeCity),
    deliveryAddress: str(w.deliveryAddress),
    consigneeNotes: str(w.consigneeNotes),
    pickupDate: str(w.pickupDate),
    expectedDeliveryDate: str(w.expectedDeliveryDate),
    freightPayer: w.freightPayer,
    paymentMethod: w.paymentMethod,
    freightInstructions: str(w.freightInstructions),
    negotiable: w.negotiable,
    logistiNumber: str(w.logistiNumber),
    logistiStatus: w.logistiStatus,
    goods: goods.map((g) => ({
      description: g.description,
      quantity: dec(g.quantity),
      packageUnit: str(g.packageUnit),
      weight: dec(g.weight),
      weightUnit: g.weightUnit,
      dimensions: str(g.dimensions),
      condition: g.condition,
    })),
  };
}

/** من حقل النافذة المخفي (JSON) إلى مدخلات الحفظ؛ الأرقام بالفواصل أو الأرقام العربية مقبولة. */
export function parseTransport(json: string | null | undefined): TransportInput | null {
  if (!json) return null;
  let t: Partial<TransportDraft>;
  try {
    t = JSON.parse(json);
  } catch {
    throw new Error("بيانات وثيقة النقل غير صالحة");
  }
  const number = (v: string | undefined, label: string, i: number) => {
    const x = (v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[,\s]/g, "");
    if (!x) return null;
    const n = Number(x);
    if (!Number.isFinite(n) || n < 0) throw new Error(`سطر البضاعة ${i + 1}: ${label} غير صالح`);
    return n;
  };
  const goods: GoodsLine[] = (t.goods ?? []).map((g, i) => ({
    description: g.description ?? "",
    quantity: number(g.quantity, "العدد", i),
    packageUnit: g.packageUnit || null,
    weight: number(g.weight, "الوزن", i),
    weightUnit: g.weightUnit || "kg",
    dimensions: g.dimensions || null,
    condition: g.condition || "good",
  }));
  return {
    shipperPhone: t.shipperPhone,
    shipperCity: t.shipperCity,
    shipperAddress: t.shipperAddress,
    shipperNotes: t.shipperNotes,
    consigneePhone: t.consigneePhone,
    consigneeCity: t.consigneeCity,
    deliveryAddress: t.deliveryAddress,
    consigneeNotes: t.consigneeNotes,
    pickupDate: t.pickupDate,
    expectedDeliveryDate: t.expectedDeliveryDate,
    freightPayer: t.freightPayer,
    paymentMethod: t.paymentMethod,
    freightInstructions: t.freightInstructions,
    negotiable: !!t.negotiable,
    logistiNumber: t.logistiNumber,
    logistiStatus: t.logistiStatus,
    goods,
  };
}
