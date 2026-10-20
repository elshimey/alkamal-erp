import { db } from "@/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { attendanceDay, attendanceMonth } from "@/lib/hr";
import { todayRiyadh } from "@/lib/dates";
import { monthLabel } from "@/data/payroll";
import { ATTENDANCE_STATUS } from "@/data/hr";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyRow, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { saveAttendanceAction } from "../actions";
import { HrTabs, Kpis } from "../ui";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const user = await requirePermission("leaves", "view");
  const sp = await searchParams;
  const today = todayRiyadh();
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : today;
  const [rows, month] = await Promise.all([attendanceDay(db, day), attendanceMonth(db, day.slice(0, 7))]);
  const canEdit = can(user.perms, "leaves", "update");
  const marked = rows.filter((r) => r.mark);
  const count = (st: string) => marked.filter((r) => r.mark!.status === st).length;

  return (
    <>
      <PageHeader
        title="الموارد البشرية"
        description="حضور مبسط للموظفين الإداريين فقط؛ السائق حضوره رحلاته. يوم الغياب يُخصم في مسير الشهر تلقائياً (الراتب ÷ 30)، ويُغلق تعديل الحضور بعد اعتماد المسير."
      />
      <HrTabs active="attendance" />
      <Kpis
        items={[
          { label: "حاضر", value: count("present") },
          { label: "متأخر", value: count("late") },
          { label: "غائب", value: count("absent"), strong: true },
          { label: "لم يُسجل بعد", value: rows.length - marked.length, hint: `من ${rows.length} موظف إداري` },
        ]}
      />

      <Card title={`حضور يوم ${day}`} className="mb-6">
        <form className="mb-4 flex items-center gap-2 text-sm">
          <Input type="date" name="day" defaultValue={day} className="w-44" />
          <button className="rounded-lg border border-gray-300 bg-white px-3 py-2 hover:bg-gray-50">عرض اليوم</button>
        </form>
        <ActionForm action={saveAttendanceAction.bind(null, day)} resetOnSuccess={false}>
          <Table head={["الموظف", "الحالة", "دقائق التأخير", "ملاحظة"]}>
            {rows.length === 0 && <EmptyRow cols={4}>لا يوجد موظفون إداريون؛ أضفهم من شاشة الموظفين</EmptyRow>}
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">
                  <input type="hidden" name="employee" value={r.id} />
                  {r.name}
                  <div className="text-xs font-normal text-gray-500">{r.jobTitle ?? "إداري"}</div>
                  {r.leave && <div className="text-xs font-normal text-blue-700">في {r.leave}</div>}
                </Td>
                <Td>
                  <Select name={`status_${r.id}`} defaultValue={r.mark?.status ?? (r.leave ? "leave" : "")} disabled={!canEdit} className="w-32">
                    <option value="">—</option>
                    {Object.entries(ATTENDANCE_STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <Input type="number" min={0} name={`late_${r.id}`} defaultValue={r.mark?.lateMinutes || ""} disabled={!canEdit} className="w-24" />
                </Td>
                <Td>
                  <Input name={`notes_${r.id}`} defaultValue={r.mark?.notes ?? ""} disabled={!canEdit} className="w-56" />
                </Td>
              </tr>
            ))}
          </Table>
          {canEdit && rows.length > 0 && (
            <div className="mt-4">
              <SubmitButton>حفظ حضور اليوم</SubmitButton>
            </div>
          )}
        </ActionForm>
      </Card>

      <Card title={`ملخص ${monthLabel(day.slice(0, 7))}`}>
        <Table head={["الموظف", "حضور", "تأخير", "دقائق التأخير", "غياب (يُخصم)", "إجازة"]}>
          {month.length === 0 && <EmptyRow cols={6}>لا يوجد موظفون إداريون</EmptyRow>}
          {month.map((m) => (
            <tr key={m.id}>
              <Td className="font-medium">{m.name}</Td>
              <Td className="ltr-nums">{m.present}</Td>
              <Td className="ltr-nums">{m.late}</Td>
              <Td className="ltr-nums">{m.lateMinutes || "—"}</Td>
              <Td>{m.absent ? <Badge tone="red">{m.absent}</Badge> : "—"}</Td>
              <Td className="ltr-nums">{m.leave || "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
