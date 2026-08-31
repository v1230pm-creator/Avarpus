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
  return ['index', 'status', 'shop', 'calls'];
}

export function getPrimaryTabsHomeRoute({
  portal,
  canAccess,
}: Pick<TabVisibilityInput, 'portal' | 'canAccess'>): '/(tabs)' | '/(tabs)/repairs' {
  return portal && canAccess('repairs_portal') ? '/(tabs)/repairs' : '/(tabs)';
}