"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { autoMatch, createStatement, deleteStatement, matchLine, postLineAsExpense, setStatementStatus, unpostLine, type StatementLineInput } from "@/lib/fuel-cards";
import { toDate } from "@/lib/importers";
import { parseDelimited } from "@/lib/sheet";
import type { FormState } from "@/components/action-form";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const toNum = (v: string) => {
  const n = Number(v.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return Number.isFinite(n) ? n : NaN;
};

/** سطور الكشف ملصوقة من Excel: التاريخ | اللوحة | المحطة | المرجع | اللترات | المبلغ شامل الضريبة. */
function parseLines(text: string): StatementLineInput[] {
  const grid = parseDelimited(text.trim(), text.includes("\t") ? "\t" : ",").filter((r) => r.some((c) => c.trim()));
  const out: StatementLineInput[] = [];
  grid.forEach((r, i) => {
    const [date = "", plate = "", station = "", reference = "", liters = "", amount = ""] = r.map((c) => c.trim());
    // صف العناوين يُتجاهل
    if (i === 0 && Number.isNaN(toNum(amount))) return;
    const a = toNum(amount);
    if (!(a > 0)) throw new Error(`السطر ${i + 1}: المبلغ «${amount}» غير صحيح`);
    out.push({ date: toDate(date, `السطر ${i + 1}`), plate, station, reference, liters: liters ? toNum(liters) || null : null, amount: a });
  });
  return out;
}

export async function newStatement(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("fuel_cards", "create");
  let id: number;
  try {
    const closing = str(fd, "closingBalance");
    const st = await createStatement(db, {
      providerId: Number(str(fd, "providerId")) || null,
      periodFrom: str(fd, "periodFrom"),
      periodTo: str(fd, "periodTo"),
      closingBalance: closing ? toNum(closing) : null,
      notes: str(fd, "notes"),
      lines: parseLines(str(fd, "lines")),
      userId: user.id,
    });
    id = st.id;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/fuel-cards");
  redirect(`/fuel-cards/${id}`);
}

async function run(statementId: number, fn: () => Promise<unknown>, ok: string): Promise<FormState> {
  try {
    await fn();
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath(`/fuel-cards/${statementId}`);
  revalidatePath("/fuel-cards");
  return { ok };
}

export async function matchAction(statementId: number, lineId: number, _: FormState, fd: FormData) {
  await requirePermission("fuel_cards", "update");
  const fuelId = Number(str(fd, "fuelId")) || null;
  return run(statementId, () => matchLine(db, lineId, fuelId), fuelId ? "طوبق السطر" : "أُلغيت المطابقة");
}

export async function postExpenseAction(statementId: number, lineId: number, _: FormState) {
  const user = await requirePermission("fuel_cards", "approve");
  return run(statementId, () => postLineAsExpense(db, lineId, user.id), "قُيد مصروف ديزل على المركبة");
}

export async function unpostAction(statementId: number, lineId: number, _: FormState) {
  await requirePermission("fuel_cards", "revert");
  return run(statementId, () => unpostLine(db, lineId), "حُذف القيد");
}

export async function autoMatchAction(statementId: number, _: FormState) {
  await requirePermission("fuel_cards", "update");
  let n = 0;
  const res = await run(statementId, async () => (n = await autoMatch(db, statementId)), "");
  return res?.error ? res : { ok: n ? `طوبق ${n} سطر` : "لم يُعثر على مطابقات جديدة" };
}

export async function statusAction(statementId: number, status: "open" | "reconciled", _: FormState) {
  await requirePermission("fuel_cards", "approve");
  return run(statementId, () => setStatementStatus(db, statementId, status), status === "reconciled" ? "أُقفل الكشف مطابقاً" : "أُعيد فتح الكشف");
}

export async function deleteStatementAction(statementId: number, _: FormState): Promise<FormState> {
  await requirePermission("fuel_cards", "delete");
  try {
    await deleteStatement(db, statementId);
  } catch (err) {
    return { error: errorMessage(err) };
  }
  revalidatePath("/fuel-cards");
  redirect("/fuel-cards");
}
