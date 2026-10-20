import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { IMPORT_SPECS } from "@/data/import-specs";
import { matchColumns, normText } from "@/lib/import-match";
import { buildTemplate, readImportFile } from "@/lib/xlsx";

const invoices = IMPORT_SPECS["sales-invoices"];

describe("مطابقة أعمدة الاستيراد", () => {
  it("يطابق عناوين قالب وافق الثنائية اللغة", () => {
    const wafeq = [
      "Unique identifier المعرف الفريد",
      "Customer name اسم العميل",
      "Customer Code رمز العميل",
      "Invoice number  رقم الفاتورة",
      "Currency  العملة",
      "Date  التاريخ",
      "Due date تاريخ الإستحقاق",
      "Purchase order رقم الأمر",
      "Price is inc. or exc. tax الأسعار شاملة أو خالية من الضريبة",
      "Notes ملاحظات",
      "Item description وصف المنتج",
      "Item qty كمية المنتج",
      "Item Price سعر المنتج",
      "Item المنتج",
      "Item Account حساب المنتج",
      "Item tax rate name إسم معدل الضريبة للمنتج",
      "Item Cost Center مركز تكلفة المنتج",
      "Item discount (%) الخصم على المنتج",
      "Discount account حساب الخصم",
    ];
    const m = Object.fromEntries(matchColumns(wafeq, invoices.fields).map((k, i) => [wafeq[i], k]));
    expect(m).toMatchObject({
      "Customer name اسم العميل": "customer",
      "Invoice number  رقم الفاتورة": "reference",
      "Currency  العملة": "currency",
      "Date  التاريخ": "invoiceDate",
      "Due date تاريخ الإستحقاق": "dueDate",
      "Price is inc. or exc. tax الأسعار شاملة أو خالية من الضريبة": "taxInclusive",
      "Notes ملاحظات": "notes",
      "Item description وصف المنتج": "description",
      "Item qty كمية المنتج": "quantity",
      "Item Price سعر المنتج": "unitPrice",
      "Item Account حساب المنتج": "account",
      "Item tax rate name إسم معدل الضريبة للمنتج": "taxCode",
      "Item Cost Center مركز تكلفة المنتج": "costCenter",
      "Item discount (%) الخصم على المنتج": "discount",
    });
    // أعمدة لا تقابل حقلاً تبقى بلا ربط، والحقل لا يُربط مرتين
    expect(m["Customer Code رمز العميل"]).toBeNull();
    expect(m["Discount account حساب الخصم"]).toBeNull();
    expect(m["Item المنتج"]).toBeNull();
  });

  it("توحيد النص يتجاهل الهمزات والتشكيل والرموز", () => {
    expect(normText("إسم  المُنتَج")).toBe(normText("اسم المنتج"));
    expect(normText("فاتورة")).toBe(normText("فاتوره"));
    expect(normText("15%")).toBe("15");
  });

  it("القالب المنزّل يُقرأ كما هو: صفوف «احذف الصف» تُتجاهل والبيانات المضافة تُقرأ", async () => {
    const buf = await buildTemplate(invoices, [{ title: "العملاء", values: ["عميل أ"], field: "customer" }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("البيانات")!;
    const row = ["", ...invoices.fields.map((f) => ({ customer: "عميل أ", reference: "X-1", currency: "SAR", invoiceDate: new Date(Date.UTC(2026, 9, 5)), description: "نقل", quantity: 2, unitPrice: 100, account: "4101" } as Record<string, ExcelJS.CellValue>)[f.key] ?? "")];
    ws.getRow(4 + invoices.samples.length).values = row;
    const out = Buffer.from(await wb.xlsx.writeBuffer());
    const parsed = await readImportFile(new File([new Uint8Array(out)], "t.xlsx"), invoices);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rowNumbers[0]).toBe(4 + invoices.samples.length);
    const mapping = matchColumns(parsed.headers, invoices.fields);
    const get = (k: string) => parsed.rows[0][mapping.indexOf(k)];
    expect(get("invoiceDate")).toBe("2026-10-05");
    expect(get("quantity")).toBe("2");
    expect(get("customer")).toBe("عميل أ");
  });

  it("يقرأ CSV ويكتشف صف العناوين ولو لم يكن الأول", async () => {
    const csv = "تقرير مبيعات\nاسم العميل,رقم الفاتورة,السعر\nعميل أ,A-1,50\n";
    const parsed = await readImportFile(new File([csv], "x.csv"), invoices);
    expect(parsed.headers).toEqual(["اسم العميل", "رقم الفاتورة", "السعر"]);
    expect(parsed.rows).toEqual([["عميل أ", "A-1", "50"]]);
    expect(parsed.rowNumbers).toEqual([3]);
  });
});
