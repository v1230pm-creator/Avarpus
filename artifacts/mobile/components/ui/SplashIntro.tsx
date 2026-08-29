import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import Svg, { Defs, LinearGradient, Path, Polygon, Stop } from 'react-native-svg';
import { CosmicWelcomeBackground } from '@/components/ui/CosmicWelcomeBackground';

const LETTERS = 'AVARPUS'.split('');
const STAR_COUNT = 54;
const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

type StarSpec = {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
};

function MovingStar({ star }: { star: StarSpec }) {
  const progress = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      progress.value = 0.45;
      return;
    }
    progress.value = withDelay(
      star.delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: star.duration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: star.duration, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );
  }, [progress, reducedMotion, star.delay, star.duration]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.18 + progress.value * 0.82,
    transform: [
      { translateX: progress.value * star.drift },
      { translateY: -progress.value * (8 + star.size * 3) },
      { scale: 0.7 + progress.value * 0.65 },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.star,
        {
          left: `${star.x}%`,
          top: `${star.y}%`,
          width: star.size,
          height: star.size,
          borderRadius: star.size / 2,
        },
        animatedStyle,
      ]}
    />
  );
}

function MovingWave({
  top,
  delay,
  duration,
  opacity,
  direction = 1,
}: {
  top: `${number}%`;
  delay: number;
  duration: number;
  opacity: number;
  direction?: 1 | -1;
}) {
  const phase = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    phase.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false),
    );
  }, [delay, duration, phase, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: direction * phase.value * -180 }],
  }));

  return (
    <Animated.View style={[styles.waveLayer, { top, opacity }, animatedStyle]}>
      <Svg width={900} height={120} viewBox="0 0 900 120">
        <Defs>
          <LinearGradient id={`wave-${delay}`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#006CFF" stopOpacity="0" />
            <Stop offset="0.2" stopColor="#168BFF" stopOpacity="0.9" />
            <Stop offset="0.52" stopColor="#53C7FF" stopOpacity="1" />
            <Stop offset="0.82" stopColor="#168BFF" stopOpacity="0.9" />
            <Stop offset="1" stopColor="#006CFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path
          d="M0 62 C75 8 145 112 220 62 S365 12 440 62 S585 112 660 62 S805 12 900 62"
          fill="none"
          stroke={`url(#wave-${delay})`}
          strokeWidth="2.2"
        />
        <Path
          d="M0 77 C75 23 145 127 220 77 S365 27 440 77 S585 127 660 77 S805 27 900 77"
          fill="none"
          stroke={`url(#wave-${delay})`}
          strokeWidth="0.8"
          strokeDasharray="3 7"
        />
      </Svg>
    </Animated.View>
  );
}

function TriangleTrace({ size }: { size: number }) {
  const traceOffset = useSharedValue(220);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      traceOffset.value = 0;
      return;
    }
    traceOffset.value = withDelay(
      420,
      withRepeat(
        withTiming(-220, { duration: 1450, easing: Easing.inOut(Easing.cubic) }),
        2,
        false,
      ),
    );
  }, [reducedMotion, traceOffset]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: traceOffset.value,
  }));

  return (
    <View style={[styles.trace, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="triangleShine" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFF8D7" stopOpacity="0.2" />
            <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity="1" />
            <Stop offset="1" stopColor="#FFD45D" stopOpacity="0.2" />
          </LinearGradient>
        </Defs>
        <AnimatedPolygon
          points="49,5 95,89 75,89 49,38 24,89 5,89"
          fill="none"
          stroke="url(#triangleShine)"
          strokeWidth="2.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="28 220"
          animatedProps={animatedProps}
        />
      </Svg>
    </View>
  );
}

function WaveLetter({ letter, index }: { letter: string; index: number }) {
  const entrance = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      entrance.value = 1;
      return;
    }
    entrance.value = withDelay(
      900 + index * 125,
      withSequence(
        withTiming(0.45, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(0.72, { duration: 180, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
      ),
    );
  }, [entrance, index, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const waveY = entrance.value < 0.58 ? -26 : entrance.value < 0.86 ? 13 : 0;
    return {
      opacity: entrance.value,
      transform: [
        { translateX: (1 - entrance.value) * -24 },
        { translateY: waveY },
        { scale: 0.82 + entrance.value * 0.18 },
      ],
    };
  });

  return (
    <Animated.Text style={[styles.letter, animatedStyle]} accessibilityElementsHidden>
      {letter}
    </Animated.Text>
  );
}

export function SplashIntro({ onFinish }: { onFinish: () => void }) {
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [isFinished, setIsFinished] = useState(false);
  const markSize = Math.min(width * 0.58, 250);
  const stars = useMemo<StarSpec[]>(
    () =>
      Array.from({ length: STAR_COUNT }, (_, index) => ({
        id: index,
        x: (index * 37 + 11) % 100,
        y: (index * 61 + 7) % 100,
        size: 1.2 + ((index * 13) % 28) / 10,
        delay: (index * 83) % 950,
        duration: 700 + ((index * 97) % 1100),
        drift: ((index % 5) - 2) * 3.5,
      })),
    [],
  );

  useEffect(() => {
    const duration = reducedMotion ? 550 : 4000;
    const timer = setTimeout(() => {
      setIsFinished(true);
      onFinish();
    }, duration);
    return () => clearTimeout(timer);
  }, [onFinish, reducedMotion]);

  if (isFinished) return null;

  return (
    <View style={[styles.container, { width, height }]}>
      <CosmicWelcomeBackground />
      <MovingWave top="17%" delay={0} duration={2500} opacity={0.34} />
      <MovingWave top="34%" delay={180} duration={3100} opacity={0.5} direction={-1} />
      <MovingWave top="67%" delay={90} duration={2800} opacity={0.42} />
      <MovingWave top="80%" delay={260} duration={3300} opacity={0.25} direction={-1} />

      {stars.map((star) => <MovingStar key={star.id} star={star} />)}

      <View style={styles.brandGroup}>
        <View style={[styles.markWrap, { width: markSize, height: markSize }]}>
          <View style={styles.markGlow} />
          <Image
            source={require('@/assets/images/avarpus-a-transparent-v2.png')}
            style={styles.exactMark}
            contentFit="contain"
            accessibilityLabel="Avarpus"
          />
          <TriangleTrace size={markSize} />
        </View>
        <View style={styles.wordmark} accessibilityRole="text" accessibilityLabel="Avarpus">
          {LETTERS.map((letter, index) => (
            <WaveLetter key={`${letter}-${index}`} letter={letter} index={index} />
          ))}
        </View>
        <Text style={styles.tagline}>SECURE · PRIVATE · CONNECTED</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#010714',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 9999,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#DDF4FF',
    shadowColor: '#168BFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 5,
  },
  waveLayer: {
    position: 'absolute',
    left: -180,
    width: 900,
    height: 120,
  },
  brandGroup: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 20,
  },
  markWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlow: {
    position: 'absolute',
    width: '72%',
    height: '72%',
    borderRadius: 999,
    backgroundColor: '#0A5BDB',
    opacity: 0.22,
  },
  exactMark: {
    width: '100%',
    height: '100%',
  },
  trace: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    minHeight: 76,
    marginTop: -8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    color: '#F8FBFF',
    fontSize: 48,
    lineHeight: 62,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    textShadowColor: 'rgba(22,139,255,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  tagline: {
    marginTop: -4,
    color: '#409CFF',
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 2.4,
  },
});