import React, { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type Star = {
  id: number;
  left: number;
  top: number;
  size: number;
  delay: number;
  duration: number;
};

function TwinklingStar({ star }: { star: Star }) {
  const glow = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      glow.value = 0.5;
      return;
    }
    glow.value = withDelay(
      star.delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: star.duration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.08, { duration: star.duration * 0.75, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      ),
    );
  }, [glow, reducedMotion, star.delay, star.duration]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.12 + glow.value * 0.88,
    transform: [{ scale: 0.65 + glow.value * 0.75 }],
  }));

  return (
    <Animated.View
      style={[
        styles.star,
        {
          left: `${star.left}%`,
          top: `${star.top}%`,
          width: star.size,
          height: star.size,
          borderRadius: star.size / 2,
        },
        style,
      ]}
    />
  );
}

function ShootingStar({
  delay,
  startX,
  startY,
  travelX,
  travelY,
}: {
  delay: number;
  startX: number;
  startY: number;
  travelX: number;
  travelY: number;
}) {
  const flight = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    flight.value = withRepeat(
      withSequence(
        withDelay(delay, withTiming(1, { duration: 1050, easing: Easing.out(Easing.quad) })),
        withTiming(0, { duration: 1 }),
      ),
      -1,
      false,
    );
  }, [delay, flight, reducedMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(flight.value, [0, 0.08, 0.62, 1], [0, 0.95, 0.62, 0]),
    transform: [
      { translateX: startX + flight.value * travelX },
      { translateY: startY + flight.value * travelY },
      { rotate: '32deg' },
      { scaleX: 0.65 + flight.value * 0.55 },
    ],
  }));

  if (reducedMotion) return null;

  return (
    <Animated.View style={[styles.shootingStar, style]}>
      <LinearGradient
        colors={['rgba(196,231,255,0)', 'rgba(223,244,255,0.42)', '#FFFFFF']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.trail}
      />
      <View style={styles.shootingHead} />
    </Animated.View>
  );
}

export function CosmicWelcomeBackground() {
  const { width, height } = useWindowDimensions();
  const drift = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  const stars = useMemo<Star[]>(
    () =>
      Array.from({ length: 28 }, (_, index) => ({
        id: index,
        left: (index * 41 + 7) % 96,
        top: (index * 67 + 4) % 92,
        size: 1.1 + ((index * 17) % 25) / 10,
        delay: (index * 137) % 1300,
        duration: 650 + ((index * 109) % 1150),
      })),
    [],
  );

  useEffect(() => {
    if (reducedMotion) return;
    drift.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 9000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
  }, [drift, reducedMotion]);

  const skyStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1.07 + drift.value * 0.035 },
      { translateX: (drift.value - 0.5) * 8 },
      { translateY: (drift.value - 0.5) * -10 },
    ],
  }));

  return (
    <View pointerEvents="none" style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFillObject, skyStyle]}>
        <Image
          source={require('@/assets/images/avarpus-nordic-night-background.png')}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
      </Animated.View>
      <LinearGradient
        colors={['rgba(1,7,20,0.34)', 'rgba(2,8,23,0.57)', 'rgba(2,8,23,0.94)']}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {stars.map((star) => <TwinklingStar key={star.id} star={star} />)}
      <ShootingStar delay={1800} startX={-90} startY={height * 0.08} travelX={width + 160} travelY={height * 0.22} />
      <ShootingStar delay={4200} startX={width * 0.42} startY={-70} travelX={width * 0.62} travelY={height * 0.3} />
      <ShootingStar delay={7100} startX={-110} startY={height * 0.42} travelX={width * 0.78} travelY={height * 0.18} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  star: {
    position: 'absolute',
    backgroundColor: '#EAF8FF',
    shadowColor: '#74C9FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
  },
  shootingStar: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 120,
    height: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trail: {
    width: 112,
    height: 2,
    borderRadius: 2,
  },
  shootingHead: {
    width: 5,
    height: 5,
    marginLeft: -1,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    shadowColor: '#9FDDFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 7,
  },
});