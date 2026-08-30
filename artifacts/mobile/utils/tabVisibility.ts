export type PrimaryTabName =
  | 'index'
  | 'calls'
  | 'repairs'
  | 'customers'
  | 'khata'
  | 'updates'
  | 'settings';

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

  const tabs: PrimaryTabName[] = ['index', 'calls'];
  if (canAccess('repairs')) tabs.push('repairs');
  if (canAccess('customers')) tabs.push('customers');
  if (canAccess('payments')) tabs.push('khata');
  tabs.push('updates', 'settings');
  return tabs;
}

export function getPrimaryTabsHomeRoute({
  portal,
  canAccess,
}: Pick<TabVisibilityInput, 'portal' | 'canAccess'>): '/(tabs)' | '/(tabs)/repairs' {
  return portal && canAccess('repairs_portal') ? '/(tabs)/repairs' : '/(tabs)';
}