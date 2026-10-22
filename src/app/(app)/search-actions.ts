"use server";

import { requireUser } from "@/lib/auth";
import { searchRecords, type SearchHit } from "@/lib/search";

export async function globalSearch(q: string): Promise<SearchHit[]> {
  const user = await requireUser();
  return searchRecords(user.perms, q.slice(0, 80));
}
