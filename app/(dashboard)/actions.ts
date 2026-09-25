"use server";

import { getSearchIndex } from "@/lib/data/search";
import type { SearchItem } from "@/lib/search-types";

export async function searchIndex(): Promise<SearchItem[]> {
  return getSearchIndex();
}
