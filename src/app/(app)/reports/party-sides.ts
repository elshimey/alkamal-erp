import type { PartySide } from "@/lib/reports";
import { param, type ReportParams } from "./report-ui";

/** العملاء أو الموردون من الرابط (?side=supplier)، والافتراضي العملاء. */
export const sideOf = (sp: ReportParams): PartySide => (param(sp, "side") === "supplier" ? "supplier" : "customer");
export const SIDE = {
  customer: { many: "العملاء", one: "العميل", balance: "المستحق من العميل", debts: "الديون المدينة" },
  supplier: { many: "الموردين", one: "المورد", balance: "المستحق للمورد", debts: "الديون الدائنة" },
} as const;
