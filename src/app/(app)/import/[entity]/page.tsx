import Link from "next/link";
import { notFound } from "next/navigation";
import { IMPORT_SPECS } from "@/data/import-specs";
import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "./wizard";

export default async function ImportPage({ params }: { params: Promise<{ entity: string }> }) {
  const spec = IMPORT_SPECS[(await params).entity];
  if (!spec) notFound();
  await requirePermission(spec.permission, "create");
  return (
    <>
      <PageHeader title={spec.title} description={spec.intro}>
        <Link href={spec.backHref} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100">
          رجوع
        </Link>
      </PageHeader>
      <ImportWizard spec={spec} />
    </>
  );
}
