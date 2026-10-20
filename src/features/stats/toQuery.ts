import { emptyFilter, parseQuery } from "@/features/library/search";
import type { StatsQuery } from "@/lib/types";
import { type StatsForm, groupInfo } from "./options";

/**
 * The form as the backend takes it. The pickers win over the same thing typed in the search box.
 * An id list from a picker is only sent when something is picked, since an empty list already
 * means "don't filter".
 */
export function toQuery(form: StatsForm): StatsQuery {
  const filter = form.search.trim() ? parseQuery(form.search) : emptyFilter();
  if (form.status) filter.readStatus = form.status;
  if (form.shelfIds.length) filter.shelfIdsAny = form.shelfIds;
  if (form.categoryIds.length) filter.categoryIdsAny = form.categoryIds;
  if (form.tagIds.length) filter.tagIdsAny = form.tagIds;

  return {
    measure: form.measure,
    groupBy: form.groupBy,
    filter,
    limit: groupInfo(form.groupBy).bySize ? form.limit : null,
    includeEmpty: form.includeEmpty,
  };
}
