"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { cell, saveSheetRows, type SheetRow } from "@/lib/sheet-server";
import { todayRiyadh } from "@/lib/dates";
import {
  approveAdvanceRequest,
  approveCustody,
  approveEvaluation,
  approveHrAction,
  approveLeave,
  cancelCustody,
  cancelHrAction,
  cancelLeave,
  closeCustody,
  createCustody,
  createHrAction,
  createLeave,
  deliverCustody,
  promoteEmployee,
  rejectAdvanceRequest,
  rejectLeave,
  revertCustody,
  revertEvaluation,
  saveAttendance,
  saveCriterion,
  saveEvaluation,
  saveHrSettings,
  saveLeaveType,
  type AttendanceMark,
} from "@/lib/hr";
import type { FormState } from "@/components/action-form";

const refresh = () => {
  for (const p of ["/hr", "/hr/custody", "/hr/discipline", "/hr/leaves", "/hr/attendance", "/hr/evaluations", "/hr/advances", "/payroll", "/settings/hr", "/driver/balance"]) revalidatePath(p);
};

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const ids = (fd: FormData) => fd.getAll("ids").map(Number).filter(Boolean);

async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    const ok = await fn();
    refresh();
    return { ok };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

async function each(list: number[], noun: string, done: string, fn: (id: number) => Promise<unknown>): Promise<FormState> {
  if (!list.length) return { error: `حدد ${noun} من الجدول أولاً` };
  const errors: string[] = [];
  let ok = 0;
  for (const id of list) {
    try {
      await fn(id);
      ok++;
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  refresh();
  if (!ok) return { error: errors.slice(0, 3).join(" · ") };
  return { ok: `${done} ${ok} من ${list.length}${errors.length ? `. لم يتم الباقي: ${errors.slice(0, 2).join(" · ")}` : ""}` };
}

// ───────────── العُهد ─────────────

export async function saveCustodyRows(rows: SheetRow[]) {
  const user = await requirePermission("custody", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const kind = cell.required(r.kind, "النوع");
    if (kind !== "cash" && kind !== "in_kind") throw new Error("النوع: نقدية أو عينية");
    await createCustody(db, {
      kind,
      employeeId: Number(cell.required(r.employeeId, "الموظف")),
      docDate: cell.date(r.docDate, "التاريخ") ?? todayRiyadh(),
      description: cell.required(r.description, "الوصف"),
      quantity: cell.number(r.quantity, "الكمية"),
      amount: cell.number(r.amount, "المبلغ"),
      serialNo: cell.text(r.serialNo),
      isOpening: r.isOpening === "yes",
      notes: cell.text(r.notes),
      userId: user.id,
    });
  });
  refresh();
  return result;
}

export async function custodyStep(id: number, step: "approve" | "revert" | "cancel"): Promise<FormState> {
  if (step === "approve") {
    const user = await requirePermission("custody", "approve");
    return run(async () => (await approveCustody(db, id, user.id), "اعتُمدت العهدة"));
  }
  if (step === "revert") {
    await requirePermission("custody", "revert");
    return run(async () => `أُرجعت العهدة إلى «${{ draft: "مسودة", approved: "معتمدة", delivered: "مسلّمة" }[await revertCustody(db, id)]}»`);
  }
  await requirePermission("custody", "delete");
  return run(async () => (await cancelCustody(db, id), "أُلغيت العهدة"));
}

export async function deliverCustodyAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("custody", "approve");
  return run(async () => {
    await deliverCustody(db, id, { cashAccountId: Number(str(fd, "cashAccountId")) || null, date: str(fd, "date") || null, userId: user.id });
    return "سُلّمت العهدة";
  });
}

export async function closeCustodyAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("custody", "approve");
  const n = (k: string) => (str(fd, k) ? Number(str(fd, k)) : null);
  return run(async () => {
    const outcome = str(fd, "outcome") === "returned" ? "returned" : "settled";
    await closeCustody(db, id, {
      outcome,
      date: str(fd, "date") || todayRiyadh(),
      returnedAmount: n("returnedAmount"),
      cashAccountId: n("cashAccountId"),
      spentAmount: n("spentAmount"),
      expenseAccountId: n("expenseAccountId"),
      notes: str(fd, "notes") || null,
      userId: user.id,
    });
    return outcome === "returned" ? "استُلمت العهدة وأُغلقت" : "سُوّيت العهدة وأُغلقت";
  });
}

export async function bulkCustody(_: FormState, fd: FormData): Promise<FormState> {
  const op = str(fd, "op");
  if (op === "approve") {
    const user = await requirePermission("custody", "approve");
    return each(ids(fd), "العهد", "اعتُمدت", (id) => approveCustody(db, id, user.id));
  }
  if (op === "deliver") {
    const user = await requirePermission("custody", "approve");
    const cashAccountId = Number(str(fd, "cashAccountId")) || null;
    return each(ids(fd), "العهد", "سُلّمت", (id) => deliverCustody(db, id, { cashAccountId, date: str(fd, "date") || null, userId: user.id }));
  }
  return { error: "اختر الإجراء" };
}

// ───────────── الإنذارات والجزاءات والحوافز ─────────────

export async function saveHrActionRows(rows: SheetRow[]) {
  const user = await requirePermission("hr_actions", "create");
  const result = await saveSheetRows(rows, async (r) => {
    const kind = cell.required(r.kind, "النوع");
    if (kind !== "warning" && kind !== "penalty" && kind !== "incentive") throw new Error("النوع: إنذار أو جزاء أو حافز");
    const points = cell.number(r.points, "النقاط");
    await createHrAction(db, {
      kind,
      employeeId: Number(cell.required(r.employeeId, "الموظف")),
      actionDate: cell.date(r.actionDate, "التاريخ") ?? todayRiyadh(),
      amount: cell.number(r.amount, "المبلغ"),
      points: points == null ? null : Math.round(points),
      reason: cell.required(r.reason, "السبب"),
      userId: user.id,
    });
  });
  refresh();
  return result;
}

export async function hrActionStep(id: number, step: "approve" | "cancel"): Promise<FormState> {
  if (step === "approve") {
    const user = await requirePermission("hr_actions", "approve");
    return run(async () => (await approveHrAction(db, id, user.id), "اعتُمد"));
  }
  await requirePermission("hr_actions", "revert");
  return run(async () => (await cancelHrAction(db, id), "أُلغي؛ حدّث مسير الشهر إن كان مسودة"));
}

export async function bulkHrActions(_: FormState, fd: FormData): Promise<FormState> {
  const op = str(fd, "op");
  if (op === "approve") {
    const user = await requirePermission("hr_actions", "approve");
    return each(ids(fd), "المستندات", "اعتُمد", (id) => approveHrAction(db, id, user.id));
  }
  if (op === "cancel") {
    await requirePermission("hr_actions", "revert");
    return each(ids(fd), "المستندات", "أُلغي", (id) => cancelHrAction(db, id));
  }
  return { error: "اختر الإجراء" };
}

// ───────────── الإجازات والحضور ─────────────

export async function saveLeaveRows(rows: SheetRow[]) {
  const user = await requirePermission("leaves", "create");
  const result = await saveSheetRows(rows, async (r) => {
    await createLeave(db, {
      employeeId: Number(cell.required(r.employeeId, "الموظف")),
      typeId: Number(cell.required(r.typeId, "نوع الإجازة")),
      fromDate: cell.date(r.fromDate, "من") ?? cell.required("", "من"),
      toDate: cell.date(r.toDate, "إلى") ?? cell.required("", "إلى"),
      reason: cell.text(r.reason),
      userId: user.id,
    });
  });
  refresh();
  return result;
}

export async function leaveStep(id: number, step: "approve" | "cancel", _: FormState, fd: FormData): Promise<FormState> {
  if (step === "approve") {
    const user = await requirePermission("leaves", "approve");
    return run(async () => (await approveLeave(db, id, { userId: user.id, override: fd.get("override") === "on" }), "اعتُمدت الإجازة"));
  }
  await requirePermission("leaves", "revert");
  return run(async () => (await cancelLeave(db, id), "أُلغيت الإجازة"));
}

export async function rejectLeaveAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("leaves", "approve");
  return run(async () => (await rejectLeave(db, id, { reason: str(fd, "reason"), userId: user.id }), "رُفض الطلب"));
}

export async function bulkLeaves(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("leaves", "approve");
  return each(ids(fd), "الطلبات", "اعتُمد", (id) => approveLeave(db, id, { userId: user.id }));
}

export async function saveAttendanceAction(day: string, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("leaves", "update");
  return run(async () => {
    const marks: AttendanceMark[] = [];
    for (const id of fd.getAll("employee").map(Number)) {
      const status = str(fd, `status_${id}`);
      if (!status) continue;
      if (!["present", "absent", "late", "leave"].includes(status)) throw new Error("حالة غير معروفة");
      marks.push({ employeeId: id, status: status as AttendanceMark["status"], lateMinutes: Number(str(fd, `late_${id}`)) || 0, notes: str(fd, `notes_${id}`) || null });
    }
    if (!marks.length) throw new Error("لم تُحدد حالة لأي موظف");
    await saveAttendance(db, day, marks, user.id);
    return `حُفظ حضور ${marks.length} موظف`;
  });
}

// ───────────── التقييم والترقية ─────────────

export async function saveEvaluationsAction(month: string, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("evaluations", "create");
  const criteria = fd.getAll("criterion").map(String);
  const errors: string[] = [];
  let saved = 0;
  for (const id of fd.getAll("employee").map(Number)) {
    const scores: Record<string, number> = {};
    let any = false;
    for (const c of criteria) {
      const v = str(fd, `s_${id}_${c}`);
      if (v !== "") any = true;
      scores[c] = v === "" ? 0 : Number(v);
    }
    if (!any) continue;
    try {
      await saveEvaluation(db, { employeeId: id, month, scores, notes: str(fd, `n_${id}`) || null, userId: user.id });
      saved++;
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  refresh();
  if (!saved && errors.length) return { error: errors.slice(0, 3).join(" · ") };
  if (!saved) return { error: "أدخل درجات موظف واحد على الأقل" };
  return { ok: `حُفظ تقييم ${saved} موظف${errors.length ? `. تعذّر: ${errors.slice(0, 2).join(" · ")}` : ""}` };
}

export async function bulkEvaluations(_: FormState, fd: FormData): Promise<FormState> {
  if (str(fd, "op") === "revert") {
    await requirePermission("evaluations", "revert");
    return each(ids(fd), "التقييمات", "أُرجع", (id) => revertEvaluation(db, id));
  }
  const user = await requirePermission("evaluations", "approve");
  return each(ids(fd), "التقييمات", "اعتُمد", (id) => approveEvaluation(db, id, user.id));
}

export async function promoteAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("evaluations", "approve");
  return run(async () => {
    await promoteEmployee(db, {
      employeeId: Number(str(fd, "employeeId")),
      effectiveDate: str(fd, "effectiveDate") || todayRiyadh(),
      toTitle: str(fd, "toTitle") || null,
      toBasic: Number(str(fd, "toBasic")),
      reason: str(fd, "reason") || null,
      userId: user.id,
    });
    return "سُجلت الترقية وحُدّث المسمى والراتب";
  });
}

// ───────────── مقدم العمولة ─────────────

export async function approveAdvanceAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payroll", "approve");
  return run(async () => {
    const adv = await approveAdvanceRequest(db, id, { cashAccountId: Number(str(fd, "cashAccountId")) || null, installment: Number(str(fd, "installment")) || null, userId: user.id });
    return `اعتُمد وأُنشئت السلفة ${adv.number}`;
  });
}

export async function rejectAdvanceAction(id: number, _: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payroll", "approve");
  return run(async () => (await rejectAdvanceRequest(db, id, { reason: str(fd, "reason"), userId: user.id }), "رُفض الطلب"));
}

export async function bulkAdvances(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requirePermission("payroll", "approve");
  const cashAccountId = Number(str(fd, "cashAccountId")) || null;
  return each(ids(fd), "الطلبات", "اعتُمد", (id) => approveAdvanceRequest(db, id, { cashAccountId, userId: user.id }));
}

// ───────────── الإعدادات ─────────────

export async function saveHrSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("settings", "update");
  return run(async () => {
    const n = (k: string) => Number(str(fd, k));
    await saveHrSettings(db, {
      warningPoints: n("warningPoints"),
      violationsAsWarnings: fd.get("violationsAsWarnings") === "on",
      promotionScore: n("promotionScore"),
      promotionMonths: n("promotionMonths"),
      advanceOpenDay: n("advanceOpenDay"),
      advanceCloseDay: n("advanceCloseDay"),
      advanceCapDomestic: n("advanceCapDomestic"),
      advanceCapInternational: n("advanceCapInternational"),
    });
    return "حُفظت الإعدادات";
  });
}

export async function saveCriterionAction(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("settings", "update");
  return run(async () => {
    await saveCriterion(db, { id: Number(str(fd, "id")) || null, nameAr: str(fd, "nameAr"), weight: Number(str(fd, "weight")), active: fd.get("active") === "on" });
    return "حُفظ المعيار";
  });
}

export async function saveLeaveTypeAction(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("settings", "update");
  return run(async () => {
    const days = str(fd, "yearlyDays");
    await saveLeaveType(db, { id: Number(str(fd, "id")) || null, nameAr: str(fd, "nameAr"), paid: fd.get("paid") === "on", yearlyDays: days ? Number(days) : null, active: fd.get("active") === "on" });
    return "حُفظ نوع الإجازة";
  });
}
