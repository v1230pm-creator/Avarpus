import React, { useEffect, useState } from 'react';
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

const LETTERS = 'Avarpus'.split('');
const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

function MilkyWayLoadingBackground() {
  const journey = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      journey.value = 0.35;
      return;
    }
    journey.value = withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.cubic) });
  }, [journey, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1.04 + journey.value * 0.14 },
      { translateX: journey.value * -8 },
      { translateY: journey.value * 18 },
    ],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, animatedStyle]}>
      <Image
        source={require('@/assets/images/avarpus-nordic-night-background.png')}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
      />
      <View style={styles.skyShade} />
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
  const markSize = Math.min(width * 0.42, 180);
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
      <MilkyWayLoadingBackground />

      <View style={styles.brandGroup}>
        <View style={[styles.markWrap, { width: markSize, height: markSize }]}>
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
  skyShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(1, 7, 20, 0.48)',
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
    fontSize: 38,
    lineHeight: 52,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 2.2,
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