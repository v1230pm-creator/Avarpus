import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

const LETTERS = 'Avarpus'.split('');
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const TRACE_PATH_LENGTH = 300;
const TRACE_GEOMETRY_LENGTH = 273;
const TRACE_PATH =
  'M 9 88 L 50 6 L 91 88 C 79 87 68 80 58 74 C 50 69 44 69 36 73 C 27 78 18 85 9 91';

function tracePointAtProgress(progress: number) {
  'worklet';
  const distance = Math.max(0, Math.min(1, progress)) * TRACE_GEOMETRY_LENGTH;
  const segments = [92, 92, 35, 22, 32];
  let remaining = distance;

  if (remaining <= segments[0]) {
    const t = remaining / segments[0];
    return { x: 9 + (50 - 9) * t, y: 88 + (6 - 88) * t };
  }
  remaining -= segments[0];

  if (remaining <= segments[1]) {
    const t = remaining / segments[1];
    return { x: 50 + (91 - 50) * t, y: 6 + (88 - 6) * t };
  }
  remaining -= segments[1];

  const cubicPoint = (
    t: number,
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
  ) => {
    const inverse = 1 - t;
    const inverseSquared = inverse * inverse;
    const tSquared = t * t;
    return {
      x:
        inverseSquared * inverse * p0.x +
        3 * inverseSquared * t * p1.x +
        3 * inverse * tSquared * p2.x +
        tSquared * t * p3.x,
      y:
        inverseSquared * inverse * p0.y +
        3 * inverseSquared * t * p1.y +
        3 * inverse * tSquared * p2.y +
        tSquared * t * p3.y,
    };
  };

  if (remaining <= segments[2]) {
    return cubicPoint(
      remaining / segments[2],
      { x: 91, y: 88 },
      { x: 79, y: 87 },
      { x: 68, y: 80 },
      { x: 58, y: 74 },
    );
  }
  remaining -= segments[2];

  if (remaining <= segments[3]) {
    return cubicPoint(
      remaining / segments[3],
      { x: 58, y: 74 },
      { x: 50, y: 69 },
      { x: 44, y: 69 },
      { x: 36, y: 73 },
    );
  }
  remaining -= segments[3];

  return cubicPoint(
    remaining / segments[4],
    { x: 36, y: 73 },
    { x: 27, y: 78 },
    { x: 18, y: 85 },
    { x: 9, y: 91 },
  );
}

function useMeteorCircleProps(
  traceProgress: ReturnType<typeof useSharedValue<number>>,
  lag: number,
  maxOpacity: number,
  radius: number,
) {
  return useAnimatedProps(() => {
    'worklet';
    const progress = traceProgress.value;
    const point = tracePointAtProgress(progress - lag);
    const visibility =
      progress <= lag
        ? 0
        : maxOpacity * Math.min(1, (progress - lag) / 0.025);

    return {
      cx: point.x,
      cy: point.y,
      opacity: visibility,
      r: radius,
    };
  });
}

function MilkyWayLoadingBackground({ onReady }: { onReady: () => void }) {
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
    <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
      <Image
        source={require('@/assets/images/avarpus-nordic-night-background.png')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        onLoad={onReady}
        onError={onReady}
      />
      <View style={styles.skyShade} />
    </Animated.View>
  );
}

function LogoProgressTrace({
  size,
  active,
  loadingReady,
  onComplete,
}: {
  size: number;
  active: boolean;
  loadingReady: boolean;
  onComplete: () => void;
}) {
  const traceProgress = useSharedValue(0);
  const dotPulse = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  const loadingAnimationStarted = useRef(false);
  const completionStarted = useRef(false);
  const mountedRef = useRef(true);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const completeFromAnimation = useCallback(() => {
    if (mountedRef.current) onCompleteRef.current();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelAnimation(traceProgress);
      cancelAnimation(dotPulse);
    };
  }, [dotPulse, traceProgress]);

  useEffect(() => {
    if (!active || loadingAnimationStarted.current || completionStarted.current) return;
    loadingAnimationStarted.current = true;

    if (reducedMotion) {
      if (loadingReady) {
        completionStarted.current = true;
        traceProgress.value = 1;
        dotPulse.value = 1;
        completeFromAnimation();
      } else {
        traceProgress.value = 0.86;
      }
      return;
    }

    traceProgress.value = withTiming(0.86, {
      duration: 3600,
      easing: Easing.out(Easing.cubic),
    });
  }, [
    active,
    completeFromAnimation,
    dotPulse,
    loadingReady,
    reducedMotion,
    traceProgress,
  ]);

  useEffect(() => {
    if (!active || !loadingReady || completionStarted.current) return;
    completionStarted.current = true;

    if (reducedMotion) {
      traceProgress.value = 1;
      dotPulse.value = 1;
      completeFromAnimation();
      return;
    }

    cancelAnimation(traceProgress);
    traceProgress.value = withTiming(
      1,
      { duration: 720, easing: Easing.inOut(Easing.cubic) },
      (finished) => {
        if (!finished) return;
        dotPulse.value = withSequence(
          withTiming(0.55, { duration: 120 }),
          withTiming(1, { duration: 420 }, (dotFinished) => {
            if (dotFinished) runOnJS(completeFromAnimation)();
          }),
        );
      },
    );
  }, [
    active,
    completeFromAnimation,
    dotPulse,
    loadingReady,
    reducedMotion,
    traceProgress,
  ]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: TRACE_PATH_LENGTH * (1 - traceProgress.value),
  }));

  const meteorTailFarProps = useMeteorCircleProps(traceProgress, 0.075, 0.1, 0.9);
  const meteorTailProps = useMeteorCircleProps(traceProgress, 0.05, 0.2, 1.3);
  const meteorGlowProps = useMeteorCircleProps(traceProgress, 0.025, 0.4, 1.9);
  const meteorHeadProps = useMeteorCircleProps(traceProgress, 0, 0.78, 2.6);
  const dotAnimatedProps = useAnimatedProps(() => ({
    opacity: dotPulse.value,
    r: 8 + dotPulse.value * 2,
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
        <Path
          d={TRACE_PATH}
          fill="none"
          stroke="#FFF3B0"
          strokeOpacity={0.18}
          strokeWidth={2.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <AnimatedPath
          d={TRACE_PATH}
          fill="none"
          stroke="url(#triangleShine)"
          strokeWidth="2.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={TRACE_PATH_LENGTH}
          animatedProps={animatedProps}
        />
        <AnimatedCircle
          fill="#6BB5FF"
          animatedProps={meteorTailFarProps}
        />
        <AnimatedCircle
          fill="#86C5FF"
          animatedProps={meteorTailProps}
        />
        <AnimatedCircle
          fill="#B9E0FF"
          animatedProps={meteorGlowProps}
        />
        <AnimatedCircle
          fill="#FFF9D6"
          stroke="#B9E5FF"
          strokeWidth={0.8}
          animatedProps={meteorHeadProps}
        />
        <Circle
          cx={50}
          cy={53}
          r={9.5}
          fill="#06162D"
          opacity={0.96}
        />
        <AnimatedCircle
          cx={50}
          cy={53}
          fill="#2F92FF"
          stroke="#B7E0FF"
          strokeWidth={1.4}
          animatedProps={dotAnimatedProps}
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

export function SplashIntro({
  onFinish,
  loadingReady,
}: {
  onFinish: () => void;
  loadingReady: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [markReady, setMarkReady] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const revealStarted = useRef(false);
  const mountedRef = useRef(true);
  const markSize = Math.min(width * 0.42, 180);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!backgroundReady || !markReady || revealStarted.current) return;
    revealStarted.current = true;
    SplashScreen.setOptions({ duration: 0, fade: false });
    SplashScreen.hideAsync()
      .catch(() => undefined)
      .finally(() => {
        if (mountedRef.current) setRevealed(true);
      });
  }, [backgroundReady, markReady]);

  const handleTraceComplete = useCallback(() => {
    if (!mountedRef.current) return;
    setIsFinished(true);
    onFinish();
  }, [onFinish]);

  if (isFinished) return null;

  return (
    <View style={[styles.container, { width, height }]}>
      <StatusBar barStyle="light-content" backgroundColor="#040914" translucent={false} />
      <MilkyWayLoadingBackground
        onReady={() => setBackgroundReady(true)}
      />

      <View style={styles.brandGroup}>
        <View style={[styles.markWrap, { width: markSize, height: markSize }]}>
          <Image
            source={require('@/assets/images/avarpus-a-transparent-v2.png')}
            style={styles.exactMark}
            contentFit="contain"
            accessibilityLabel="Avarpus"
            onLoad={() => setMarkReady(true)}
            onError={() => setMarkReady(true)}
          />
          <LogoProgressTrace
            size={markSize}
            active={revealed}
            loadingReady={loadingReady}
            onComplete={handleTraceComplete}
          />
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
    backgroundColor: '#040914',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 9999,
  },
  skyShade: {
    ...StyleSheet.absoluteFill,
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