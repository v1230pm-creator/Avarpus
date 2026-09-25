/**
 * One-hand reach: the rules that decide when a resting finger has hold of the
 * page and where the page may go, plus the wrapper's wiring (no return control
 * until the page is away from its top, the opt-out hook, text-field detection).
 */
import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ReachDown, useReachHoldOff } from '@/components/ui/ReachDown';
import { heldShift, isTextField, reachLimit, strayed } from '@/utils/reachDown';
import { reach } from '@/constants/spacing';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const LIMIT = 500;

describe('reach tokens', () => {
  it('waits longer than Android’s own long press so a text field’s hold is settled first', () => {
    expect(reach.hold).toBeGreaterThan(400);
    expect(reach.hold).toBeLessThan(600);
  });
});

describe('strayed', () => {
  it('lets a finger tremble within the slop', () => {
    expect(strayed(3, -4, reach.slop)).toBe(false);
    expect(strayed(reach.slop, reach.slop, reach.slop)).toBe(false);
  });

  it('calls any larger travel a scroll or a swipe, in either axis and direction', () => {
    expect(strayed(0, reach.slop + 1, reach.slop)).toBe(true);
    expect(strayed(0, -(reach.slop + 1), reach.slop)).toBe(true);
    expect(strayed(reach.slop + 1, 0, reach.slop)).toBe(true);
    expect(strayed(-(reach.slop + 1), 0, reach.slop)).toBe(true);
  });
});

describe('reachLimit', () => {
  it('keeps the top strip on screen', () => {
    expect(reachLimit(800, reach.keep)).toBe(800 - reach.keep);
  });

  it('pins an unmeasured or tiny area', () => {
    expect(reachLimit(0, reach.keep)).toBe(0);
    expect(reachLimit(reach.keep - 1, reach.keep)).toBe(0);
  });
});

describe('heldShift', () => {
  it('follows the finger from wherever the page was taken hold of', () => {
    expect(heldShift(0, 120, LIMIT)).toBe(120);
    expect(heldShift(200, 50, LIMIT)).toBe(250);
    expect(heldShift(200, -50, LIMIT)).toBe(150);
  });

  it('stops at the top and at the limit without resistance or overshoot', () => {
    expect(heldShift(100, -300, LIMIT)).toBe(0);
    expect(heldShift(400, 300, LIMIT)).toBe(LIMIT);
    expect(heldShift(0, 0, 0)).toBe(0);
  });
});

describe('isTextField', () => {
  it('recognises text fields by their host element on every platform', () => {
    expect(isTextField({ tagName: 'RN:TextInput' })).toBe(true);
    expect(isTextField({ tagName: 'INPUT' })).toBe(true);
    expect(isTextField({ tagName: 'TEXTAREA' })).toBe(true);
  });

  it('leaves everything else to the page', () => {
    expect(isTextField({ tagName: 'RN:View' })).toBe(false);
    expect(isTextField({ tagName: 'RN:Paragraph' })).toBe(false);
    expect(isTextField({ tagName: 'DIV' })).toBe(false);
    expect(isTextField(42)).toBe(false);
    expect(isTextField(null)).toBe(false);
    expect(isTextField(undefined)).toBe(false);
    expect(isTextField({})).toBe(false);
  });
});

describe('ReachDown', () => {
  it('renders the page and shows no return control until the page is away from its top', () => {
    render(
      <ReachDown>
        <Text>Page body</Text>
      </ReachDown>,
    );
    expect(screen.getByText('Page body')).toBeTruthy();
    expect(screen.queryByLabelText('Move the page back up')).toBeNull();
  });

  it('hands a control inside a working opt-out and a control outside a harmless one', () => {
    let inside: (() => void) | null = null;
    let outside: (() => void) | null = null;
    function Inside() {
      inside = useReachHoldOff();
      return null;
    }
    function Outside() {
      outside = useReachHoldOff();
      return null;
    }
    render(
      <>
        <ReachDown>
          <Inside />
        </ReachDown>
        <Outside />
      </>,
    );
    expect(typeof inside).toBe('function');
    expect(typeof outside).toBe('function');
    expect(() => inside!()).not.toThrow();
    expect(() => outside!()).not.toThrow();
  });
});
