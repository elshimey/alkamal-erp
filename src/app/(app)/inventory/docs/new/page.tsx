import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listProducts, stockByWarehouse } from "@/lib/inventory";
import { todayRiyadh } from "@/lib/dates";
import { STOCK_DOC_KINDS, type StockDocKind } from "@/data/inventory";
import { PageHeader } from "@/components/ui";
import { StockDocForm } from "./form";

export default async function NewStockDocPage({ searchParams }: { searchParams: Promise<{ kind?: string; wh?: string }> }) {
  const user = await requirePermission("inventory", "create");
  const sp = await searchParams;
  const kind: StockDocKind = sp.kind && sp.kind in STOCK_DOC_KINDS ? (sp.kind as StockDocKind) : "adjustment";
  const [products, warehouses, balances, accounts, centers] = await Promise.all([
    listProducts(db, { kind: "stock" }),
    db.select({ id: s.warehouses.id, nameAr: s.warehouses.nameAr }).from(s.warehouses).where(eq(s.warehouses.isActive, true)).orderBy(asc(s.warehouses.code)),
    stockByWarehouse(db),
    db.select({ id: s.accounts.id, code: s.accounts.code, nameAr: s.accounts.nameAr }).from(s.accounts).where(and(eq(s.accounts.isPostable, true), eq(s.accounts.isActive, true))).orderBy(asc(s.accounts.code)),
    db.select({ id: s.costCenters.id, nameAr: s.costCenters.nameAr }).from(s.costCenters).where(eq(s.costCenters.isActive, true)).orderBy(asc(s.costCenters.code)),
  ]);
  return (
    <>
      <PageHeader title={STOCK_DOC_KINDS[kind].label} description={STOCK_DOC_KINDS[kind].hint} />
      <StockDocForm
        kind={kind}
        today={todayRiyadh()}
        defaultWarehouse={Number(sp.wh) || warehouses[0]?.id}
        canPost={can(user.perms, "inventory", "approve")}
        products={products.filter((p) => p.p.isActive).map((p) => ({ id: p.p.id, label: `${p.p.code} ${p.p.nameAr}`, unit: p.p.unit, avg: p.avgCost }))}
        warehouses={warehouses}
        balances={balances.map((b) => ({ p: Number(b.product_id), w: Number(b.warehouse_id), q: Number(b.qty) }))}
        accounts={accounts.filter((a) => !a.code.startsWith("1110")).map((a) => ({ id: a.id, label: `${a.code} ${a.nameAr}`, code: a.code }))}
        centers={centers}
      />
    </>
  );
}
