import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  runOnJS,
  withRepeat,
  useReducedMotion,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

const NUM_STARS = 40;
const stars = Array.from({ length: NUM_STARS }).map((_, i) => ({
  id: i,
  delay: Math.random() * 2000,
  startX: Math.random() * width,
  startY: Math.random() * height,
  size: Math.random() * 2.5 + 1,
  duration: 1500 + Math.random() * 1500,
}));

const Star = ({ delay, startX, startY, size, duration }: any) => {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 0.5;
      return;
    }
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.8, { duration, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.1, { duration, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      )
    );
    translateY.value = withDelay(
      delay,
      withRepeat(
        withTiming(-15, { duration: duration * 2, easing: Easing.linear }),
        -1,
        true
      )
    );
  }, [reducedMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.star,
        { width: size, height: size, borderRadius: size / 2, left: startX, top: startY },
        style,
      ]}
    />
  );
};

export function SplashIntro({ onFinish }: { onFinish: () => void }) {
  const shineTranslateX = useSharedValue(-width * 1.5);
  const reducedMotion = useReducedMotion();
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    if (reducedMotion) {
      const timer = setTimeout(() => {
        setIsFinished(true);
        onFinish();
      }, 1500);
      return () => clearTimeout(timer);
    }

    // Shine sweeps across
    shineTranslateX.value = withDelay(
      400,
      withTiming(
        width * 1.5,
        { duration: 1800, easing: Easing.inOut(Easing.ease) },
        (finished) => {
          if (finished) {
            runOnJS(setIsFinished)(true);
            runOnJS(onFinish)();
          }
        }
      )
    );
  }, [reducedMotion]);

  const shineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shineTranslateX.value }, { rotate: '25deg' }],
  }));

  if (isFinished) return null;

  return (
    <View style={styles.container}>
      {/* Blurred background to seamlessly fill the edges */}
      <Image
        source={require('@/assets/images/avarpus-splash.png')}
        style={[StyleSheet.absoluteFillObject, styles.backgroundImage]}
        contentFit="cover"
        blurRadius={60}
      />
      {/* Main crisp image */}
      <Image
        source={require('@/assets/images/avarpus-splash.png')}
        style={styles.mainImage}
        contentFit="contain"
      />

      {/* Star particles overlay */}
      {stars.map((star) => (
        <Star key={star.id} {...star} />
      ))}

      {/* Shine sweep */}
      {!reducedMotion && (
        <Animated.View style={[styles.shineContainer, shineStyle]} pointerEvents="none">
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.25)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#030712',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  mainImage: {
    width: '100%',
    height: '100%',
  },
  backgroundImage: {
    opacity: 0.3,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    shadowColor: '#1683FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  shineContainer: {
    position: 'absolute',
    top: -height,
    bottom: -height,
    width: width * 0.35,
  },
});
