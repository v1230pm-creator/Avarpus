import { getVisiblePrimaryTabs } from '@/utils/tabVisibility';

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