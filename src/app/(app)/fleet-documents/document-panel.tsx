import { notFound } from "next/navigation";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listDocumentTypes, listOwners, OWNER_KINDS, ownerKey, ownerLabel, type OwnerKind } from "@/lib/documents";
import { PanelLink, RecordPanel } from "@/components/record-panel";
import { DocumentFields } from "./document-form";
import { saveDocumentAction } from "./actions";

// الجهة (عميل أو مورد) تُعرف من نوع الوثيقة، فالجهة نفسها قد تكون الاثنين
const ownerOf = (d: typeof s.fleetDocuments.$inferSelect, assetKind: string | null, typeKind: OwnerKind): { kind: OwnerKind; id: number } =>
  d.vehicleId ? { kind: assetKind === "trailer" ? "trailer" : "vehicle", id: d.vehicleId } : d.driverId ? { kind: "driver", id: d.driverId } : d.employeeId ? { kind: "employee", id: d.employeeId } : d.partyId ? { kind: typeKind === "supplier" ? "supplier" : "customer", id: d.partyId } : { kind: "company", id: 0 };

/**
 * نافذة وثيقة واحدة: إضافة (owner/type اختياريان لملء الصاحب والنوع مسبقاً) أو تعديل وثيقة محفوظة.
 * تغيير تاريخ الانتهاء هنا تصحيح للوثيقة نفسها؛ التجديد إضافة وثيقة جديدة من النوع نفسه.
 */
export async function DocumentPanel({ id, closeHref, owner, type }: { id: number | null; closeHref: string; owner?: string; type?: string }) {
  const types = (await listDocumentTypes(db, { activeOnly: !id })).map((t) => ({ id: t.id, nameAr: t.nameAr, ownerKind: t.ownerKind, authority: t.authority }));
  if (id) {
    const [row] = await db
      .select({ doc: s.fleetDocuments, assetKind: s.vehicles.assetKind, typeName: s.documentTypes.nameAr, typeKind: s.documentTypes.ownerKind })
      .from(s.fleetDocuments)
      .innerJoin(s.documentTypes, eq(s.documentTypes.id, s.fleetDocuments.documentTypeId))
      .leftJoin(s.vehicles, eq(s.vehicles.id, s.fleetDocuments.vehicleId))
      .where(eq(s.fleetDocuments.id, id));
    if (!row) notFound();
    const o = ownerOf(row.doc, row.assetKind, row.typeKind);
    const label = (await ownerLabel(db, o.kind, o.id))?.label ?? OWNER_KINDS[o.kind].label;
    const [att] = await db
      .select({ id: s.attachments.id })
      .from(s.attachments)
      .where(and(eq(s.attachments.entity, "fleet_documents"), eq(s.attachments.entityId, id)))
      .orderBy(desc(s.attachments.id))
      .limit(1);
    const d = row.doc;
    return (
      <RecordPanel
        title={`${row.typeName} · ${label}`}
        subtitle="تعديل الوثيقة. للتجديد أضف وثيقة جديدة من النوع نفسه لتبقى هذه في التاريخ"
        closeHref={closeHref}
        action={saveDocumentAction.bind(null, id)}
        creating={false}
        footer={<PanelLink href={`/records/fleet_documents/${id}`}>سجل التعديلات وحذف الوثيقة</PanelLink>}
      >
        <DocumentFields
          owners={[]}
          types={types}
          defaultOwner={ownerKey(o.kind, o.id)}
          fixedOwner={`${label} · ${OWNER_KINDS[o.kind].label}`}
          doc={{ documentTypeId: d.documentTypeId, number: d.number, issueDate: d.issueDate, expiryDate: d.expiryDate, authority: d.authority, cost: d.cost, notes: d.notes, attachmentId: att?.id ?? null }}
        />
      </RecordPanel>
    );
  }
  const owners = await listOwners(db);
  const fixed = owner ? owners.find((o) => ownerKey(o.kind, o.id) === owner) : undefined;
  return (
    <RecordPanel title="إضافة وثيقة" subtitle="إن كانت للصاحب وثيقة من النوع نفسه تُعد هذه تجديداً لها، وتبقى السابقة في التاريخ" closeHref={closeHref} action={saveDocumentAction.bind(null, null)} creating>
      <DocumentFields
        owners={owners.map((o) => ({ value: ownerKey(o.kind, o.id), label: `${o.label} · ${OWNER_KINDS[o.kind].label}` }))}
        types={types}
        defaultOwner={owner ?? ""}
        defaultType={type ?? ""}
        fixedOwner={fixed ? `${fixed.label} · ${OWNER_KINDS[fixed.kind].label}` : undefined}
      />
    </RecordPanel>
  );
}
