// يعمل في الخادم فقط (يُستدعى من إجراءات الخادم ومسار تنزيل القالب)
import ExcelJS from "exceljs";
import { DELETE_ROW_MARK, type ImportSpec } from "@/data/import-specs";
import { headerScore, normText } from "@/lib/import-match";
import { parseDelimited } from "@/lib/sheet";

// قالب الاستيراد وقراءة الملف المرفوع. القالب على طريقة وافق: صف العناوين، ثم صف «مطلوب»
// وصف «قواعد التحقق» وصفوف أمثلة، وكلها معلّمة «احذف الصف» فتُتجاهل عند الرفع.

const LIST_SHEET = "القوائم";
const DARK = "FF1B2126";
const ROAD = "FFE9A100";

export interface TemplateList {
  title: string;
  values: string[];
  // الحقل الذي تُقترح قيمه من هذه القائمة في ورقة البيانات
  field?: string;
}

export async function buildTemplate(spec: ImportSpec, lists: TemplateList[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "الكمال للنقليات";
  const ws = wb.addWorksheet("البيانات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1, xSplit: 1 }] });
  ws.columns = [{ width: 13 }, ...spec.fields.map((f) => ({ width: f.width ?? 16 }))];

  const header = ws.addRow(["", ...spec.fields.map((f) => `${f.label}${f.required ? " *" : ""}\n${f.en}`)]);
  header.height = 34;
  header.eachCell((c, col) => {
    c.font = { bold: true, color: { argb: col === 1 ? DARK : "FFFFFFFF" }, size: 11 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col === 1 ? ROAD : DARK } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  const mark = (row: ExcelJS.Row, fill: string, opts: { italic?: boolean; size?: number; wrap?: boolean } = {}) => {
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > spec.fields.length + 1) return;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col === 1 ? "FFFDE68A" : fill } };
      c.font = { italic: opts.italic, size: opts.size ?? 10, color: { argb: col === 1 ? "FF92400E" : "FF374151" }, bold: col === 1 };
      c.alignment = { vertical: "top", wrapText: opts.wrap ?? false };
    });
  };
  mark(ws.addRow([DELETE_ROW_MARK, ...spec.fields.map((f) => (f.required ? "مطلوب" : "اختياري"))]), "FFFFF7E0");
  const rules = ws.addRow([DELETE_ROW_MARK, ...spec.fields.map((f) => f.rule ?? "")]);
  mark(rules, "FFF3F4F6", { italic: true, size: 9, wrap: true });
  rules.height = 48;
  spec.samples.forEach((sample, i) => mark(ws.addRow([`${DELETE_ROW_MARK} (مثال ${i + 1})`, ...spec.fields.map((f) => sample[f.key] ?? "")]), "FFFFFBEB"));

  // ورقة القوائم: القيم المعرفة في النظام لينسخ منها، وتظهر كقائمة منسدلة في أعمدتها
  const ls = wb.addWorksheet(LIST_SHEET, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  lists.forEach((list, i) => {
    const col = ls.getColumn(i + 1);
    col.width = Math.min(40, Math.max(14, ...list.values.map((v) => v.length + 2), list.title.length + 2));
    const head = ls.getCell(1, i + 1);
    head.value = list.title;
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
    list.values.forEach((v, r) => (ls.getCell(r + 2, i + 1).value = v));
    const fieldIdx = list.field ? spec.fields.findIndex((f) => f.key === list.field) : -1;
    if (fieldIdx >= 0 && list.values.length) {
      const letter = col.letter;
      const formula = `'${LIST_SHEET}'!$${letter}$2:$${letter}$${list.values.length + 1}`;
      for (let r = 4 + spec.samples.length; r <= 500; r++) {
        ws.getCell(r, fieldIdx + 2).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorStyle: "warning",
          errorTitle: "قيمة غير موجودة",
          error: "القيمة ليست في القوائم المعرفة بالنظام",
        };
      }
    }
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
  // رقم كل صف في الملف الأصلي، لتقرير الأخطاء
  rowNumbers: number[];
}

const pad = (n: number) => String(n).padStart(2, "0");

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  if (typeof v === "string") return v.trim();
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text).trim();
    if ("error" in v) return "";
  }
  return String(v).trim();
}

const markNorm = normText(DELETE_ROW_MARK);
const isMarked = (cells: string[]) => cells.slice(0, 2).some((c) => {
  const n = normText(c);
  return n.startsWith(markNorm) || n.startsWith("delete row");
});

/** يختار صف العناوين (الأكثر تطابقاً في أول عشرة صفوف) ويعيد الصفوف التالية بلا صفوف «احذف الصف» والفارغة. */
function fromGrid(grid: { cells: string[]; n: number }[], spec: ImportSpec): ParsedSheet & { score: number } {
  let best = { idx: -1, score: 0 };
  grid.slice(0, 10).forEach((r, idx) => {
    const sc = headerScore(r.cells, spec.fields);
    if (sc > best.score) best = { idx, score: sc };
  });
  const headIdx = best.idx >= 0 ? best.idx : 0;
  const rawHeaders = grid[headIdx]?.cells ?? [];
  const body = grid.slice(headIdx + 1).filter((r) => r.cells.some(Boolean) && !isMarked(r.cells));
  const width = Math.max(rawHeaders.length, ...body.map((r) => r.cells.length), 0);
  // عمود بلا عنوان ولا بيانات يُحذف؛ وعمود بيانات بلا عنوان يأخذ اسماً
  const keep = Array.from({ length: width }, (_, c) => !!rawHeaders[c] || body.some((r) => r.cells[c]));
  const cols = keep.map((k, c) => (k ? c : -1)).filter((c) => c >= 0);
  return {
    headers: cols.map((c) => rawHeaders[c] || `عمود ${c + 1}`),
    rows: body.map((r) => cols.map((c) => r.cells[c] ?? "")),
    rowNumbers: body.map((r) => r.n),
    score: best.score,
  };
}

export async function readImportFile(file: File, spec: ImportSpec): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    const grid = parseDelimited(text, text.split("\n")[0].includes("\t") ? "\t" : ",").map((cells, i) => ({ cells: cells.map((c) => c.trim()), n: i + 1 }));
    const { headers, rows, rowNumbers } = fromGrid(grid, spec);
    return { headers, rows, rowNumbers };
  }
  if (!name.endsWith(".xlsx")) throw new Error("ارفع ملف Excel بصيغة ‎.xlsx أو ملف CSV");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Error("تعذرت قراءة الملف؛ تأكد أنه ملف Excel سليم (.xlsx)");
  }
  let best: (ParsedSheet & { score: number }) | null = null;
  wb.eachSheet((ws) => {
    if (ws.name === LIST_SHEET) return;
    const grid: { cells: string[]; n: number }[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, col) => (cells[col - 1] = cellText(c.value)));
      grid.push({ cells: Array.from(cells, (c) => c ?? ""), n });
    });
    const parsed = fromGrid(grid, spec);
    if (!best || parsed.score > best.score) best = parsed;
  });
  if (!best) throw new Error("الملف لا يحوي بيانات");
  const { headers, rows, rowNumbers } = best as ParsedSheet;
  return { headers, rows, rowNumbers };
}
