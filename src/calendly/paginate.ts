import { calendlyRequest, type QueryValue } from "./client.js";

/** Shape of a Calendly paginated collection response — see conventions.md. */
interface CalendlyCollectionResponse<T> {
  collection: T[];
  pagination: {
    count: number;
    next_page?: string | null;
    previous_page?: string | null;
    next_page_token?: string | null;
    previous_page_token?: string | null;
  };
}

export interface PaginateResult<T> {
  items: T[];
  /**
   * True when the cursor drained (no more pages) — false when a `limit`
   * cut the walk short while `next_page_token` was still non-null. Calendly
   * reports no total count anywhere, so this flag is the only signal for
   * "more available" — see `specs/behaviors/pagination-and-limits.md`.
   */
  complete: boolean;
  pages_fetched: number;
}

const MAX_PAGE_SIZE = 100;

/**
 * Walk a Calendly cursor-paginated collection endpoint. Fetches at the
 * API-maximum page size (`count=100`) and follows `pagination.next_page_token`
 * until either the cursor drains or `limit` items have been collected.
 * `limit` of `undefined` or `0` drains to completion.
 */
export async function paginate<T = Record<string, unknown>>(
  path: string,
  query: Record<string, QueryValue> = {},
  limit?: number,
): Promise<PaginateResult<T>> {
  const items: T[] = [];
  let pageToken: string | undefined;
  let pagesFetched = 0;
  const effectiveLimit = limit && limit > 0 ? limit : undefined;

  for (;;) {
    const res = await calendlyRequest<CalendlyCollectionResponse<T>>(path, {
      query: { ...query, count: MAX_PAGE_SIZE, page_token: pageToken },
    });
    pagesFetched++;
    items.push(...res.collection);

    const next = res.pagination.next_page_token ?? undefined;

    if (!next) {
      // Cursor drained — definitively complete, even if this also happened
      // to satisfy `limit` on the same page.
      const capped = effectiveLimit !== undefined ? items.slice(0, effectiveLimit) : items;
      return { items: capped, complete: true, pages_fetched: pagesFetched };
    }

    if (effectiveLimit !== undefined && items.length >= effectiveLimit) {
      // Limit reached with more pages available — never claim completeness.
      return { items: items.slice(0, effectiveLimit), complete: false, pages_fetched: pagesFetched };
    }

    pageToken = next;
  }
}

/**
 * Build the header fragment `pagination-and-limits.md` mandates: a bare
 * `count` when the cursor drained, or a loud "shown, more available" string
 * plus `complete: false` when a limit cut the walk short. Never a bare
 * number that could be misread as "this is everything".
 */
export function paginationSummary(result: PaginateResult<unknown>): Record<string, unknown> {
  if (result.complete) {
    return { count: result.items.length, complete: true };
  }
  return {
    count: `${result.items.length} shown, more available`,
    complete: false,
  };
}

/** Standard help hint appended when `paginationSummary` reports `complete: false`. */
export function moreAvailableHint(limitFlag = "--limit"): string {
  return `Raise ${limitFlag} or narrow the window to see more`;
}
