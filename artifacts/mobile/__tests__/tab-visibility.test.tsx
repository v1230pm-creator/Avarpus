import { getVisiblePrimaryTabs } from '@/utils/tabVisibility';

describe('primary tab visibility', () => {
  it('keeps repairs inside Khata and settings outside the bottom bar', () => {
    const visible = getVisiblePrimaryTabs({
      customer: false,
      portal: false,
      canAccess: () => true,
    });

    expect(visible).toEqual(['index', 'status', 'customers', 'khata', 'updates']);
    expect(visible).not.toContain('repairs');
    expect(visible).not.toContain('settings');
  });

  it('preserves the repair-only home for dealer portal accounts', () => {
    expect(getVisiblePrimaryTabs({
      customer: false,
      portal: true,
      canAccess: (feature) => feature === 'repairs_portal',
    })).toEqual(['repairs']);
  });

  it('shows Khata as the repair hub for staff without payment access', () => {
    expect(getVisiblePrimaryTabs({
      customer: false,
      portal: false,
      canAccess: (feature) => feature === 'repairs',
    })).toEqual(['index', 'status', 'khata', 'updates']);
  });

  it('keeps customer accounts on their compact chat home', () => {
    expect(getVisiblePrimaryTabs({
      customer: true,
      portal: false,
      canAccess: () => false,
    })).toEqual(['index']);
  });
});