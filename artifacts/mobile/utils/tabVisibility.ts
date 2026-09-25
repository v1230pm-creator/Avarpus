export type PrimaryTabName =
  | 'index'
  | 'status'
  | 'shop'
  | 'calls'
  | 'repairs'
  | 'customers'
  | 'khata'
  | 'updates';

type TabVisibilityInput = {
  customer: boolean;
  portal: boolean;
  canAccess: (feature: string) => boolean;
};

export function getVisiblePrimaryTabs({
  customer: _customer,
  portal: _portal,
  canAccess: _canAccess,
}: TabVisibilityInput): PrimaryTabName[] {
  if (_customer && _canAccess('repairs_portal')) return ['index', 'repairs', 'status', 'shop', 'calls'];
  return ['index', 'status', 'shop', 'calls'];
}

/**
 * The Shop workspace's own bottom navigation. These four tools are never
 * primary tabs: they are reached from the Shop tab and, while the user is
 * inside any of them, replace the main footer (Chats / Status / Shop / Calls)
 * with "Repairs | Khata | Inventory | Customers".
 */
export type WorkspaceTabName = 'repairs' | 'khata' | 'inventory' | 'customers';

const WORKSPACE_TAB_NAMES: readonly WorkspaceTabName[] = ['repairs', 'khata', 'inventory', 'customers'];

type WorkspaceTabsInput = TabVisibilityInput & {
  /** Route segments of the focused screen, e.g. `['(tabs)', 'repairs', '[id]']`. */
  segments: readonly string[];
};

/** The tools this account may open, in footer order (Repairs first). */
function allowedWorkspaceTools(canAccess: TabVisibilityInput['canAccess']): WorkspaceTabName[] {
  return WORKSPACE_TAB_NAMES.filter((name) => {
    if (name === 'repairs') return canAccess('repairs') || canAccess('repairs_portal');
    if (name === 'khata') return canAccess('payments') || canAccess('repairs');
    return canAccess(name);
  });
}

/**
 * Which workspace tabs to show for the focused route, or `null` when the main
 * footer applies: outside the four tools, for customer / dealer-portal
 * accounts (they never own the workspace), for chat rooms (they live under the
 * customers tab but belong to the messenger). Staff limited to a single tool
 * still get the workspace footer (one item) so the workspace's exit-on-back
 * behaviour stays the same for everyone.
 */
export function getWorkspaceTabs({
  segments,
  customer,
  portal,
  canAccess,
}: WorkspaceTabsInput): WorkspaceTabName[] | null {
  if (customer || portal) return null;
  const tab = segments[1];
  if (!tab || !(WORKSPACE_TAB_NAMES as readonly string[]).includes(tab)) return null;
  if (tab === 'customers' && segments[2] === 'chat') return null;

  const allowed = allowedWorkspaceTools(canAccess);
  return allowed.length > 0 ? allowed : null;
}

type ShopTabInput = TabVisibilityInput & {
  /** The account has an active Shop (its `shopId` pointer is set). */
  hasShop: boolean;
};

/**
 * Where the main footer's Shop tab lands. There is no Shop dashboard: an
 * account that owns or works in a Shop opens its first tool directly —
 * Repairs whenever it is allowed — and the workspace footer takes over. The
 * Shop screen remains only for accounts without a workspace to enter (no Shop
 * yet, customer and dealer-portal logins, staff with every tool switched off),
 * where it offers set-up / join.
 */
export function getShopTabTarget({ customer, portal, hasShop, canAccess }: ShopTabInput): WorkspaceTabName | 'shop' {
  if (customer || portal || !hasShop) return 'shop';
  return allowedWorkspaceTools(canAccess)[0] ?? 'shop';
}

/** The slice of a tab navigator route that the workspace back logic reads. */
export type TabRoute = {
  key: string;
  name: string;
  state?: { index?: number; routes?: Array<{ name: string }> };
};

/**
 * Where Android Back should go from the focused workspace screen:
 * - `exit`: the tool's list is showing (or its stack has not mounted yet), so
 *   leave the workspace for Chats, where the main footer takes over again;
 * - `tool-root`: a child screen was deep-linked as the only entry of its stack
 *   (nothing to pop), so return to the tool's list first;
 * - `null`: a normal child screen — decline and let the focused stack pop.
 */
export function workspaceBackTarget(route: TabRoute | undefined): 'exit' | 'tool-root' | null {
  const nested = route?.state;
  const routes = nested?.routes ?? [];
  if (routes.length === 0) return 'exit';
  const focusedChild = routes[nested?.index ?? routes.length - 1]?.name;
  if (!focusedChild || focusedChild === 'index') return 'exit';
  return routes.length <= 1 ? 'tool-root' : null;
}

export function getPrimaryTabsHomeRoute({
  portal,
  canAccess,
}: Pick<TabVisibilityInput, 'portal' | 'canAccess'>): '/(tabs)' | '/(tabs)/repairs' {
  return portal && canAccess('repairs_portal') ? '/(tabs)/repairs' : '/(tabs)';
}