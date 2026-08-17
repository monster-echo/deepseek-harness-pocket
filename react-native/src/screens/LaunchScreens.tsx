import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { useVideoPlayer, VideoView } from 'expo-video';
import { AppButton } from '../design-system/components';
import { PromoIllustration } from '../design-system/PromoIllustration';
import { useApp } from '../state/AppStore';
import { usePreferences } from '../preferences/PreferencesProvider';
import { RuntimeConfig } from '../domain/models';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

const LogoImage = require('../../assets/splash-icon.png');

// 品牌闪屏阶段常量
const MIN_LOGO_MS = 1000; // logo+loading 最短展示时间，避免 bootstrap 极快时闪跳
const MAX_SPLASH_WAIT_MS = 8000; // fetch 无显式超时，最长等待兜底防挂死

// ── Splash screen ────────────────────────────────────────────────────
// 统一三端启动体验：原生 logo → 品牌闪屏 → home。闪屏仅在「在线且有 splash 配置」
// 时展示（全屏媒体 + 右上角胶囊跳过 + 倒计时）；离线或未配置 → 直接进首页。
// 合规：非按钮区域不可点击跳转，仅跳过按钮可点。
export function SplashScreen() {
  const { replace, config, bootstrapped, online } = useApp();
  const { palette } = usePreferences();
  const [minElapsed, setMinElapsed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const doneRef = useRef(false);

  // 首帧渲染完成后隐藏原生启动屏：与 App.tsx 的 preventAutoHideAsync 配合，
  // 无缝过渡到 JS 品牌闪屏，避免闪跳并遮住 dev-client 的 bundle 下载。
  useEffect(() => {
    void ExpoSplashScreen.hideAsync();
  }, []);

  const goHome = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    replace('home');
  }, [replace]);

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_LOGO_MS);
    return () => clearTimeout(t);
  }, []);

  // fetch 无显式超时，最长等待兜底，避免一直卡在 loading
  useEffect(() => {
    const t = setTimeout(goHome, MAX_SPLASH_WAIT_MS);
    return () => clearTimeout(t);
  }, [goHome]);

  const ready = minElapsed && bootstrapped;
  useEffect(() => {
    if (!ready || countdown !== null) return;
    if (!config.splash || !online) {
      goHome(); // 未配置闪屏或离线 → 直接进首页
      return;
    }
    // 进闪屏前预加载图片：远程图首拉 1-2s，在 loading 阶段拉好，
    // 进入品牌闪屏时图片已就绪、0 等待。失败也照常进闪屏（走 fallback）。
    const url = config.splash.imageUrl;
    const enter = () => setCountdown(config.splash!.durationSeconds);
    if (url) Image.prefetch(url).finally(enter);
    else enter();
  }, [ready, config.splash, online, countdown, goHome]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      goHome();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? c : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, goHome]);

  if (countdown === null) {
    // 阶段 loading：logo + appName + tagline + 转圈 + "加载中…"
    // 背景用 app 主色，原生 splash → loading → 闪屏 → home 全程一致
    return (
      <View accessibilityLabel="启动中" style={[styles.centered, { backgroundColor: palette.background }]}>
        <Image
          source={LogoImage}
          style={launchStyles.logoMark}
          accessibilityLabel="品牌图标"
        />
        <Text style={styles.title}>{config.brand.appName}</Text>
        <Text style={styles.secondary}>{config.brand.tagline}</Text>
        <ActivityIndicator color={colors.brand} style={launchStyles.loadingSpinner} />
        <Text style={launchStyles.loadingText}>加载中…</Text>
      </View>
    );
  }

  // countdown 非空即已确认有 splash 配置；类型兜底
  const splash = config.splash;
  if (!splash) return null;
  const canSkip = splash.skippable !== false;
  return (
    <View style={[launchStyles.splashRoot, { backgroundColor: palette.background }]}>
      <SplashMedia splash={splash} background={palette.background} />
      <View pointerEvents="box-none" style={launchStyles.overlay}>
        <View style={launchStyles.topBar}>
          <SkipCapsule canSkip={canSkip} countdown={Math.max(countdown, 0)} onSkip={goHome} />
        </View>
      </View>
    </View>
  );
}

// 右上角胶囊跳过按钮（开屏广告标准形态：半透明深底 + 白字 + 倒计时）
function SkipCapsule({
  canSkip,
  countdown,
  onSkip,
}: Readonly<{ canSkip: boolean; countdown: number; onSkip: () => void }>) {
  return (
    <Pressable
      accessibilityLabel={`跳过闪屏，剩余 ${countdown} 秒`}
      accessibilityRole="button"
      onPress={onSkip}
      style={launchStyles.skipCapsule}
    >
      <Text style={launchStyles.skipCapsuleText}>
        {canSkip ? `${countdown}s 跳过` : `${countdown}s`}
      </Text>
    </Pressable>
  );
}

// 全屏媒体背景：视频（videoUrl）> 图片（imageUrl cover）> 品牌 fallback。
// 视频静音自动循环播放（iOS 自动播放需静音）；加载失败自动回退下一级。
// 媒体加载期间显示白底 logo 占位，加载完成后淡入，避免等待期黑屏。
function SplashMedia({
  splash,
  background,
}: Readonly<{ splash: NonNullable<RuntimeConfig['splash']>; background: string }>) {
  const [failed, setFailed] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    setFailed(false);
    setMediaReady(false);
    fade.setValue(0);
  }, [splash.imageUrl, splash.videoUrl, fade]);

  const player = useVideoPlayer(splash.videoUrl ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    if (splash.videoUrl) p.play();
  });
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') setFailed(true);
      if (status === 'readyToPlay') setMediaReady(true);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (mediaReady) {
      Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }
  }, [mediaReady, fade]);

  const hasMedia = (splash.videoUrl || splash.imageUrl) && !failed;

  return (
    <View style={[launchStyles.splashMediaRoot, { backgroundColor: background }]}>
      {/* 媒体加载占位：app 背景色 + 品牌 logo，避免等待期黑屏/色差 */}
      <View style={[launchStyles.mediaPlaceholder, { backgroundColor: background }]}>
        <Image source={LogoImage} style={launchStyles.placeholderLogo} accessibilityLabel="品牌图标" />
      </View>
      {hasMedia ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          {splash.videoUrl ? (
            <VideoView
              contentFit="cover"
              nativeControls={false}
              player={player}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <Image
              accessibilityLabel="闪屏图片"
              onError={() => setFailed(true)}
              onLoad={() => setMediaReady(true)}
              resizeMode="cover"
              source={{ uri: splash.imageUrl ?? undefined }}
              style={StyleSheet.absoluteFill}
            />
          )}
        </Animated.View>
      ) : (
        // 无媒体或加载失败 → 品牌 fallback（内置插画 + 活动文案）
        <View style={[StyleSheet.absoluteFill, launchStyles.fallback, { backgroundColor: background }]}>
          <PromoIllustration />
          <Text style={launchStyles.badge}>{splash.badge}</Text>
          <Text style={styles.title}>{splash.title}</Text>
          <Text style={styles.secondary}>{splash.description}</Text>
        </View>
      )}
    </View>
  );
}

export function OnboardingScreen() {
  const { replace } = useApp();
  return (
    <View style={styles.centered}>
      <PromoIllustration />
      <Text style={styles.title}>三步了解核心功能</Text>
      <Text style={styles.secondary}>首次安装展示，完成后不会重复出现。</Text>
      <View style={launchStyles.fullWidth}>
        <AppButton label="完成引导" onPress={() => replace('home')} />
      </View>
    </View>
  );
}

const launchStyles = StyleSheet.create({
  splashRoot: { flex: 1 },
  splashMediaRoot: { flex: 1 },
  mediaPlaceholder: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderLogo: { width: 48, height: 48, opacity: 0.6 },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'space-between',
    padding: spacing.x3,
  },
  topBar: { alignItems: 'flex-end' },
  skipCapsule: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 72,
    paddingHorizontal: spacing.x3,
    borderRadius: radii.round,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  skipCapsuleText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
    padding: spacing.x6,
  },
  logoMark: { width: 48, height: 48 },
  badge: { color: colors.brand, fontSize: 13, fontWeight: '700' },
  fullWidth: { width: '100%' },
  loadingSpinner: { marginTop: spacing.x4 },
  loadingText: { color: colors.brand, fontSize: 14, marginTop: spacing.x2 },
});
