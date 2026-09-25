/**
 * Which React Query entries hold Shop-scoped business data.
 *
 * Every hook generated in `@workspace/api-client-react` keys its query by the
 * request path first (`/api/customers`, `/api/repairs/<id>/payments`, …), so
 * a predicate has to match on the `/api/<family>` root — a bare `/customers`
 * prefix never matches anything and fails silently. Personal families (auth,
 * chat, statuses, notifications, app updates, the Shop membership list) are
 * deliberately not listed: they belong to the account, not to a workspace.
 */
const BUSINESS_QUERY_FAMILIES = [
  'activity',
  'approvals',
  'customers',
  'dashboard',
  'dealers',
  'finance',
  'inventory',
  'payments',
  'purchases',
  'refunds',
  'repairs',
  'returns',
  'role-features',
  'staff',
  'stock-movements',
] as const;

export const BUSINESS_QUERY_ROOTS: readonly string[] = BUSINESS_QUERY_FAMILIES.map((family) => `/api/${family}`);

/** True for a query whose key root is one of the business families above. */
export function isBusinessQuery(query: { queryKey: readonly unknown[] }): boolean {
  const root = query.queryKey[0];
  if (typeof root !== 'string') return false;
  return BUSINESS_QUERY_ROOTS.some(
    (prefix) => root === prefix || root.startsWith(`${prefix}/`) || root.startsWith(`${prefix}?`),
  );
}
