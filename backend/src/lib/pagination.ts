// Shared cursor-based pagination helpers. Every paginated list endpoint in
// this app uses the same convention: fetch `limit + 1` rows to detect
// whether another page exists, return the first `limit` rows as `items`,
// and expose the last returned row's id as `nextCursor` (null when there is
// no further page). These helpers keep that contract in one place instead
// of five hand-maintained copies drifting apart.

interface CursorPageArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
}

// Prisma `findMany` argument fragment implementing the fetch-one-extra
// convention. `{ id: cursor }` is valid for every paginated model here
// because they all use `id` as their primary key.
export function cursorPageArgs(cursor: string | undefined, limit: number): CursorPageArgs {
  return {
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

// Turns the `limit + 1` row fetch back into a `{ items, nextCursor }` page.
export function toCursorPage<T extends { id: string }>(rows: T[], limit: number): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
  return { items, nextCursor };
}
