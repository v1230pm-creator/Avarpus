import { getShopTabTarget, getVisiblePrimaryTabs, getWorkspaceTabs, workspaceBackTarget } from '@/utils/tabVisibility';

describe('shop workspace footer', () => {
  const owner = { customer: false, portal: false, canAccess: () => true };

  it('replaces the main footer only inside the four shop tools', () => {
    const workspace = ['repairs', 'khata', 'inventory', 'customers'];
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'repairs'] })).toEqual(workspace);
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'repairs', '[id]'] })).toEqual(workspace);
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'khata'] })).toEqual(workspace);
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'inventory'] })).toEqual(workspace);
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'customers', '[id]'] })).toEqual(workspace);
  });

  it('keeps the main footer on Chats, Status, Shop, Calls and inside chat rooms', () => {
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)'] })).toBeNull();
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'status'] })).toBeNull();
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'shop'] })).toBeNull();
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'calls'] })).toBeNull();
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'more', 'profile'] })).toBeNull();
    expect(getWorkspaceTabs({ ...owner, segments: ['(tabs)', 'customers', 'chat', '[roomId]'] })).toBeNull();
  });

  it('never shows the workspace footer to portal or customer accounts', () => {
    expect(getWorkspaceTabs({ customer: false, portal: true, canAccess: () => true, segments: ['(tabs)', 'repairs'] })).toBeNull();
    expect(getWorkspaceTabs({ customer: true, portal: false, canAccess: () => true, segments: ['(tabs)', 'repairs'] })).toBeNull();
  });

  it('shows staff only the tools their permissions allow, down to a single tool', () => {
    expect(getWorkspaceTabs({
      ...owner,
      canAccess: (feature) => ['repairs', 'customers'].includes(feature),
      segments: ['(tabs)', 'repairs'],
    })).toEqual(['repairs', 'khata', 'customers']);
    expect(getWorkspaceTabs({
      ...owner,
      canAccess: (feature) => feature === 'inventory',
      segments: ['(tabs)', 'inventory'],
    })).toEqual(['inventory']);
    expect(getWorkspaceTabs({ ...owner, canAccess: () => false, segments: ['(tabs)', 'inventory'] })).toBeNull();
  });
});

describe('shop tab target', () => {
  const owner = { customer: false, portal: false, hasShop: true, canAccess: () => true };

  it('opens Repairs directly for an account inside a Shop — there is no dashboard', () => {
    expect(getShopTabTarget(owner)).toBe('repairs');
  });

  it('falls back to the first tool a staff role may open', () => {
    expect(getShopTabTarget({ ...owner, canAccess: (feature) => feature === 'payments' })).toBe('khata');
    expect(getShopTabTarget({ ...owner, canAccess: (feature) => feature === 'inventory' })).toBe('inventory');
    expect(getShopTabTarget({ ...owner, canAccess: (feature) => feature === 'customers' })).toBe('customers');
  });

  it('keeps the Shop screen for accounts with nothing to enter', () => {
    // Owner roles pass every feature gate even before a Shop exists, so the
    // shop pointer — not permissions — decides whether set-up / join shows.
    expect(getShopTabTarget({ ...owner, hasShop: false })).toBe('shop');
    expect(getShopTabTarget({ ...owner, canAccess: () => false })).toBe('shop');
    expect(getShopTabTarget({ ...owner, portal: true })).toBe('shop');
    expect(getShopTabTarget({ ...owner, customer: true })).toBe('shop');
  });
});

describe('workspace hardware back', () => {
  it('exits the workspace from a tool root, whether or not its stack has mounted', () => {
    expect(workspaceBackTarget({ key: 'inventory-1', name: 'inventory' })).toBe('exit');
    expect(workspaceBackTarget({ key: 'repairs-1', name: 'repairs', state: { index: 0, routes: [{ name: 'index' }] } })).toBe('exit');
    expect(workspaceBackTarget({
      key: 'khata-1', name: 'khata', state: { index: 0, routes: [{ name: 'index' }, { name: 'transaction' }] },
    })).toBe('exit');
  });

  it('lets a normal child screen pop, but sends a deep-linked lone child to its list first', () => {
    expect(workspaceBackTarget({
      key: 'repairs-1', name: 'repairs', state: { index: 1, routes: [{ name: 'index' }, { name: '[id]' }] },
    })).toBeNull();
    expect(workspaceBackTarget({ key: 'repairs-1', name: 'repairs', state: { index: 0, routes: [{ name: '[id]' }] } })).toBe('tool-root');
  });
});

describe('primary tab visibility', () => {
  it('keeps business tools inside Shop and exposes four personal destinations', () => {
    const visible = getVisiblePrimaryTabs({
      customer: false,
      portal: false,
      canAccess: () => true,
    });

    expect(visible).toEqual(['index', 'status', 'shop', 'calls']);
    expect(visible).not.toContain('repairs');
    expect(visible).not.toContain('khata');
    expect(visible).not.toContain('settings');
  });

  it('keeps the same personal destinations for dealer portal accounts', () => {
    expect(getVisiblePrimaryTabs({
      customer: false,
      portal: true,
      canAccess: (feature) => feature === 'repairs_portal',
    })).toEqual(['index', 'status', 'shop', 'calls']);
  });

  it('keeps staff permissions out of primary navigation', () => {
    expect(getVisiblePrimaryTabs({
      customer: false,
      portal: false,
      canAccess: (feature) => feature === 'repairs',
    })).toEqual(['index', 'status', 'shop', 'calls']);
  });

  it('keeps standalone customers chat/profile-only by hiding repair navigation', () => {
    expect(getVisiblePrimaryTabs({
      customer: true,
      portal: false,
      canAccess: () => false,
    })).toEqual(['index', 'status', 'shop', 'calls']);
  });

  it('shows My Repairs only for a server-linked customer portal', () => {
    expect(getVisiblePrimaryTabs({
      customer: true,
      portal: false,
      canAccess: (feature) => feature === 'repairs_portal',
    })).toEqual(['index', 'repairs', 'status', 'shop', 'calls']);
  });
});