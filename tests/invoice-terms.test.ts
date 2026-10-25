import { describe, expect, it } from "vitest";
import { invoiceTerms } from "@/lib/invoice-terms";

describe("invoiceTerms", () => {
  it("replaces the fixed day count with the customer's actual term", () => {
    expect(invoiceTerms("السداد خلال 30 يوماً من تاريخ الفاتورة.", "2026-10-25", "2026-12-09")).toBe("السداد خلال 45 يوماً من تاريخ الفاتورة.");
  });
  it("fills the explicit placeholder", () => {
    expect(invoiceTerms("مدة السداد {مدة_السداد} يوماً", "2026-10-01", "2026-10-31")).toBe("مدة السداد 30 يوماً");
  });
  it("uses أيام for 3-10 days and leaves text without a number alone", () => {
    expect(invoiceTerms("السداد خلال 30 يوماً", "2026-10-01", "2026-10-08")).toBe("السداد خلال 7 أيام");
    expect(invoiceTerms("الدفع بالتحويل البنكي", "2026-10-01", "2026-10-31")).toBe("الدفع بالتحويل البنكي");
  });
});
