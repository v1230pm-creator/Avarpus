export type PrimaryTabName =
  | 'index'
  | 'status'
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
  customer,
  portal,
  canAccess,
}: TabVisibilityInput): PrimaryTabName[] {
  if (customer) return ['index'];
  if (portal) return canAccess('repairs_portal') ? ['repairs'] : ['index'];

  const tabs: PrimaryTabName[] = ['index', 'status'];
  if (canAccess('customers')) tabs.push('customers');
  if (canAccess('payments') || canAccess('repairs')) tabs.push('khata');
  tabs.push('updates');
  return tabs;
}

export function getPrimaryTabsHomeRoute({
  portal,
  canAccess,
}: Pick<TabVisibilityInput, 'portal' | 'canAccess'>): '/(tabs)' | '/(tabs)/repairs' {
  return portal && canAccess('repairs_portal') ? '/(tabs)/repairs' : '/(tabs)';
}