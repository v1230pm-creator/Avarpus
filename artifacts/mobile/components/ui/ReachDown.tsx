import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  Keyboard,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { reach, size } from '@/constants/spacing';
import { heldShift, isTextField, reachLimit, strayed } from '@/utils/reachDown';

/**
 * One-hand reach for a whole screen. A finger that rests still anywhere on the
 * page for `reach.hold` takes hold of it (a light tap of the motor says so);
 * the page — app bar, back button and header actions included — then follows
 * the finger down or up and stays exactly where it is let go. There are no
 * stops: any position between the top and `reach.keep` short of the bottom is
 * a resting place, and a later hold moves it again from there. Above the page
 * the blank strip shows the screen's own background; a tap on it, the
 * keyboard opening, or a change of `resetKey` (the route, say) brings the page
 * back to the top.
 *
 * A finger that moves before the hold is a scroll, a swipe or a tap and is
 * left alone, so lists inside keep scrolling as they always did. Text fields
 * keep their own hold (caret, paste menu): a touch that lands on one is
 * recognised from its host element and never takes the page. Other controls
 * with a hold of their own — a message bubble's long press — opt out through
 * `useReachHoldOff`.
 *
 * Mount it once per navigator around the screen area (`screenLayout`), so the
 * tab bar underneath stays put while the page moves.
 *
 * Touch ownership per platform:
 * - Android: the hold ends on the gesture root taking the touch over; a plain
 *   scroller that already started dragging has cancelled the hold before that.
 * - Web: the browser scrolls a touch itself once it moves, so while the page is
 *   held its `touchmove` is prevented from the root, keeping the pointer
 *   stream with the gesture.
 * - iOS: the scroll view's pan needs travel to begin; a still finger never
 *   starts it, and the activation cancels the touch for the views underneath.
 */

const IS_WEB = Platform.OS === 'web';

/** Settled, bounce-free spring for the way back up: the page parks, it does not wobble. */
const SPRING = { damping: 26, stiffness: 260, mass: 1 } as const;

type ReachDownState = {
  holdOff: () => void;
};

const ReachDownContext = createContext<ReachDownState | null>(null);

const NO_HOLD_OFF = () => undefined;

/**
 * For a control that has a hold of its own — a text field's caret and paste
 * menu, a message bubble's long press — call the returned function from its
 * `onPressIn`: that touch then belongs to the control and never takes the page.
 * Outside a `ReachDown` it does nothing.
 */
export function useReachHoldOff(): () => void {
  return useContext(ReachDownContext)?.holdOff ?? NO_HOLD_OFF;
}

type Props = {
  children: React.ReactNode;
  /** Style of the screen area (its background shows in the strip above a moved page). */
  style?: StyleProp<ViewStyle>;
  /** Any value whose change should bring the page back up (the current route). */
  resetKey?: unknown;
};

export function ReachDown({ children, style, resetKey }: Props) {
  const colors = useColors();
  const rootRef = useRef<View>(null);

  const shift = useSharedValue(0);
  const limit = useSharedValue(0);
  const base = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  /** Window y of the finger when it took hold of the page, or -1 while the page is not held. */
  const heldFrom = useSharedValue(-1);
  /** Ticket of the current touch; a hold timer holding an older ticket belongs to a touch that has ended. */
  const ticket = useSharedValue(0);
  /** Raised from JS by a control that keeps the touch (see useReachHoldOff); the hold timer then stands down. */
  const holdOff = useSharedValue(false);
  /** Raised from JS when the page is sent back up (route change, keyboard): the touch under way, held or not, lets go. */
  const dropped = useSharedValue(false);
  /** The page is away from its top (or about to be): the strip above it exists. */
  const [away, setAway] = useState(false);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = reachLimit(event.nativeEvent.layout.height, reach.keep);
      limit.value = next;
      // A shorter area (rotation, keyboard) keeps the page as it was, just no further down than it may now go.
      if (shift.value > next) shift.value = next;
    },
    [limit, shift],
  );

  const grabbed = useCallback(() => {
    setAway(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const released = useCallback((at: number) => {
    if (at <= 0) setAway(false);
  }, []);

  const close = useCallback(() => {
    // A finger still resting or dragging must not undo this: its hold, pending or active, is dropped first.
    dropped.value = true;
    if (shift.value === 0) {
      setAway(false);
      return;
    }
    shift.value = withSpring(0, SPRING, (finished) => {
      if (finished) runOnJS(setAway)(false);
    });
  }, [dropped, shift]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .maxPointers(1)
        .onTouchesDown((event, manager) => {
          if (event.numberOfTouches !== 1) {
            manager.fail();
            return;
          }
          const first = event.allTouches[0];
          startX.value = first.absoluteX;
          startY.value = first.absoluteY;
          holdOff.value = false;
          dropped.value = false;
          const mine = ticket.value + 1;
          ticket.value = mine;
          // The hold is timed on the UI thread, where the touch lives; by the time it fires, a control that
          // keeps the touch has had its say (holdOff), and a finger that moved has already failed the gesture.
          setTimeout(() => {
            if (ticket.value !== mine || heldFrom.value >= 0 || holdOff.value || dropped.value) return;
            manager.activate();
          }, reach.hold);
        })
        .onTouchesMove((event, manager) => {
          if (heldFrom.value >= 0) return;
          const first = event.allTouches[0];
          if (strayed(first.absoluteX - startX.value, first.absoluteY - startY.value, reach.slop)) manager.fail();
        })
        .onTouchesUp(() => {
          ticket.value = ticket.value + 1;
        })
        .onTouchesCancelled(() => {
          ticket.value = ticket.value + 1;
        })
        .onStart((event) => {
          heldFrom.value = event.absoluteY;
          base.value = shift.value;
          runOnJS(grabbed)();
        })
        .onUpdate((event) => {
          // A dropped hold leaves the page to the spring taking it back up.
          if (dropped.value) return;
          shift.value = heldShift(base.value, event.absoluteY - heldFrom.value, limit.value);
        })
        .onFinalize(() => {
          ticket.value = ticket.value + 1;
          if (heldFrom.value < 0) return;
          heldFrom.value = -1;
          if (dropped.value) return;
          runOnJS(released)(shift.value);
        }),
    [base, dropped, grabbed, heldFrom, holdOff, limit, released, shift, startX, startY, ticket],
  );

  const context = useMemo<ReachDownState>(
    () => ({
      holdOff: () => {
        holdOff.value = true;
      },
    }),
    [holdOff],
  );

  // Touch events reach here from JS a moment after the gesture saw the touch begin, well within the hold.
  const onTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      if (isTextField(event.target)) holdOff.value = true;
    },
    [holdOff],
  );

  // A new route brings the page back where it belongs.
  useEffect(() => {
    close();
  }, [close, resetKey]);

  // The keyboard takes the lower part of the window; a page that is also down would leave nothing usable.
  useEffect(() => {
    if (!away) return;
    const subscription = Keyboard.addListener('keyboardDidShow', close);
    return () => subscription.remove();
  }, [away, close]);

  // Web: once the page is held, its touch must not become a browser scroll of the list underneath.
  useEffect(() => {
    if (!IS_WEB) return;
    const node = rootRef.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const keepPointer = (event: TouchEvent) => {
      if (heldFrom.value >= 0 && event.cancelable) event.preventDefault();
    };
    node.addEventListener('touchmove', keepPointer, { passive: false });
    return () => node.removeEventListener('touchmove', keepPointer);
  }, [heldFrom]);

  const pageStyle = useAnimatedStyle(() => ({ transform: [{ translateY: shift.value }] }));
  const gapStyle = useAnimatedStyle(() => ({ height: shift.value }));

  return (
    <ReachDownContext.Provider value={context}>
      <GestureDetector gesture={pan}>
        <View
          ref={rootRef}
          collapsable={false}
          style={[styles.root, style]}
          onLayout={onLayout}
          onTouchStart={onTouchStart}
        >
          {away && (
            // Sits under the page and is exactly as tall as the gap the page has left above itself.
            <Animated.View style={[styles.gap, gapStyle]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Move the page back up"
                onPress={close}
                style={styles.gapTap}
              >
                <Feather name="chevron-up" size={size.headerIcon} color={colors.mutedForeground} />
              </Pressable>
            </Animated.View>
          )}
          <Animated.View style={[styles.page, pageStyle]}>{children}</Animated.View>
        </View>
      </GestureDetector>
    </ReachDownContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  page: { flex: 1 },
  gap: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  gapTap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
