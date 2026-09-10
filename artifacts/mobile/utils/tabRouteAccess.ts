import { isCustomerRole, isDealerPortalRole, type UserRole } from '@/types';

export type TabSegments = readonly (string | undefined)[];

type AccessInput = {
  role?: UserRole;
  canAccess: (feature: string) => boolean;
};

function isChatRoute(segments: TabSegments) {
  return segments[1] === 'index' || (segments[1] === 'customers' && segments[2] === 'chat');
}

function isPersonalRoute(segments: TabSegments) {
  return segments[1] === 'more' &&
    [
      undefined,
      'profile',
      'account',
      'security',
      'notifications',
      'settings',
      'settings-detail',
      'chats',
      'chat-backup',
    ].includes(segments[2]);
}

/** Authorization boundary for every tab deep link, before route screen hooks mount. */
export function canAccessTabsRoute(segments: TabSegments, { role, canAccess }: AccessInput): boolean {
  if (!role) return false;
  if (
    segments[1] === undefined ||
    isChatRoute(segments) ||
    isPersonalRoute(segments) ||
    ['status', 'shop', 'calls'].includes(segments[1] ?? '')
  ) return true;
  if (isCustomerRole(role)) {
    if (segments[1] !== 'repairs' || !canAccess('repairs_portal')) return false;
    // Customer repair deep links are read-only list/detail routes only.
    return !['new', 'scanner', 'return', 'returns', 'dealer', 'dealer-new'].includes(segments[2] ?? '');
  }
  if (isDealerPortalRole(role)) {
    if (segments[1] !== 'repairs' || !canAccess('repairs_portal')) return false;
    return !['new', 'scanner', 'return', 'returns', 'dealer', 'dealer-new'].includes(segments[2] ?? '');
  }

  const owner = role === 'dealer' || role === 'super_admin';
  switch (segments[1]) {
    case 'status':
    case 'shop':
    case 'calls':
    case 'updates':
      return true;
    case 'repairs':
      if (segments[2] === 'new') return canAccess('repairs_create');
      if (segments[2] === 'return') return canAccess('repairs_update');
      if (segments[2] === 'dealer' || segments[2] === 'dealer-new') return canAccess('customers');
      return canAccess('repairs');
    case 'customers':
      return canAccess('customers');
    case 'inventory':
      return canAccess('inventory');
    case 'khata':
      return segments[2] === undefined || segments[2] === 'index'
        ? canAccess('repairs') || canAccess('payments')
        : canAccess('payments');
    case 'more':
      switch (segments[2]) {
        case 'finance': return canAccess('finance');
        case 'reports': return canAccess('reports');
        case 'purchases': return canAccess('purchases');
        case 'approvals': return canAccess('approvals');
        case 'staff':
        case 'staff-add':
        case 'staff-edit':
        case 'staff-permissions':
        case 'permissions':
        case 'activity':
          return owner;
        case 'app-update': return owner || canAccess('repairs') || canAccess('inventory') || canAccess('finance');
        case 'update-manager': return role === 'super_admin';
        default: return false;
      }
    default:
      return false;
  }
}

export function canCustomerAccessTabsRoute(segments: TabSegments): boolean {
  return canAccessTabsRoute(segments, { role: 'customer', canAccess: () => false });
}

export function canPortalAccessTabsRoute(segments: TabSegments): boolean {
  return canAccessTabsRoute(segments, { role: 'dealer_owner', canAccess: (feature) => feature === 'repairs_portal' });
}