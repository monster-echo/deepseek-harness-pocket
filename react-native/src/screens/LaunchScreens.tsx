import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, View } from 'react-native';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { PromoIllustration } from '../design-system/PromoIllustration';
import { useApp } from '../state/AppStore';
import { RuntimeConfig } from '../domain/models';
import { telemetry } from '../telemetry/Telemetry';

const LogoImage = require('../../assets/splash-icon.png'); // eslint-disable-line @typescript-eslint/no-require-imports

// 品牌闪屏阶段常量
const MAX_SPLASH_WAIT_MS = 8000; // fetch 无显式超时，最长等待兜底防挂死

// 绝对定位填充（Animated.View / VideoView / Image 不支持 uniwind className）
const ABSOLUTE_FILL = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
} as const;

// ── 启动门（原品牌闪屏入口）──────────────────────────────────────────
// 本屏只是 bootstrap 等待门：原生 logo → （极短 loading）→ 分流落地。
// **默认关掉品牌闪屏**：无 config.splash 时 bootstrap 一完成立即分流——
// 已登录 → home，未登录 → auth.signIn（认证页即落地页）。
// 仅当服务端配置了 config.splash 且在线时才展示品牌闪屏活动（可选项）。
export function SplashScreen() {
  const { replace, config, bootstrapped, online, signedIn } = useApp();
  const primary = useCSSVariable('--color-primary') as string;
  const [countdown, setCountdown] = useState<number | null>(null);
  const doneRef = useRef(false);

  // 首帧渲染完成后隐藏原生启动屏：与 App.tsx 的 preventAutoHideAsync 配合，
  // 无缝过渡到 JS 启动门，避免闪跳并遮住 dev-client 的 bundle 下载。
  useEffect(() => {
    void ExpoSplashScreen.hideAsync();
  }, []);

  const enterApp = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    replace(signedIn ? 'home' : 'auth.signIn');
  }, [replace, signedIn]);

  // fetch 无显式超时，最长等待兜底，避免一直卡在 loading
  useEffect(() => {
    const t = setTimeout(enterApp, MAX_SPLASH_WAIT_MS);
    return () => clearTimeout(t);
  }, [enterApp]);

  const ready = bootstrapped;
  useEffect(() => {
    if (!ready || countdown !== null) return;
    if (!config.splash || !online) {
      enterApp(); // 默认：未配置闪屏或离线 → 直接落地（home / 认证页）
      return;
    }
    // 进闪屏前预加载图片：远程图首拉 1-2s，在 loading 阶段拉好，
    // 进入品牌闪屏时图片已就绪、0 等待。失败也照常进闪屏（走 fallback）。
    const url = config.splash.imageUrl;
    const enter = () => setCountdown(config.splash!.durationSeconds);
    if (url) Image.prefetch(url).finally(enter);
    else enter();
  }, [ready, config.splash, online, countdown, enterApp]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      enterApp();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? c : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, enterApp]);

  if (countdown === null) {
    // 阶段 loading：logo + appName + 转圈。bootstrap 通常几百 ms，
    // 不设最短展示时间——配置未返回即分流，默认体验无闪屏。
    return (
      <View
        accessibilityLabel="启动中"
        className="bg-background flex-1 items-center justify-center gap-4 p-6"
      >
        <Image
          source={LogoImage}
          className="h-12 w-12"
          accessibilityLabel="品牌图标"
        />
        <Text className="text-foreground text-[28px] font-bold">{config.brand.appName}</Text>
        <ActivityIndicator color={primary} className="mt-4" />
      </View>
    );
  }

  // countdown 非空即已确认有 splash 配置；类型兜底
  const splash = config.splash;
  if (!splash) return null;
  const canSkip = splash.skippable !== false;
  return (
    <View className="bg-background flex-1">
      <SplashMedia splash={splash} />
      <View pointerEvents="box-none" className="absolute inset-0 justify-between p-3">
        <View className="items-end">
          <SkipCapsule canSkip={canSkip} countdown={Math.max(countdown, 0)} onSkip={enterApp} />
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
      className="bg-black/40 min-h-9 min-w-[72px] items-center justify-center rounded-full px-3"
    >
      <Text className="text-sm font-semibold text-white">
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
}: Readonly<{ splash: NonNullable<RuntimeConfig['splash']> }>) {
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
    <View className="bg-background flex-1">
      {/* 媒体加载占位：app 背景色 + 品牌 logo，避免等待期黑屏/色差 */}
      <View className="bg-background absolute inset-0 items-center justify-center">
        <Image source={LogoImage} className="h-12 w-12 opacity-60" accessibilityLabel="品牌图标" />
      </View>
      {hasMedia ? (
        <Animated.View style={[ABSOLUTE_FILL, { opacity: fade }]}>
          {splash.videoUrl ? (
            <VideoView
              contentFit="cover"
              nativeControls={false}
              player={player}
              style={ABSOLUTE_FILL}
            />
          ) : (
            <Image
              accessibilityLabel="闪屏图片"
              onError={() => setFailed(true)}
              onLoad={() => setMediaReady(true)}
              resizeMode="cover"
              source={{ uri: splash.imageUrl ?? undefined }}
              style={ABSOLUTE_FILL}
            />
          )}
        </Animated.View>
      ) : (
        // 无媒体或加载失败 → 品牌 fallback（内置插画 + 活动文案）
        <View className="bg-background absolute inset-0 flex-1 items-center justify-center gap-2 p-6">
          <PromoIllustration />
          <Text className="text-primary text-[13px] font-bold">{splash.badge}</Text>
          <Text className="text-foreground text-[28px] font-bold">{splash.title}</Text>
          <Text className="text-muted-foreground text-sm">{splash.description}</Text>
        </View>
      )}
    </View>
  );
}

export function OnboardingScreen() {
  const { replace } = useApp();
  return (
    <View className="flex-1 items-center justify-center gap-4 p-6">
      <PromoIllustration />
      <Text className="text-foreground text-[28px] font-bold">三步了解核心功能</Text>
      <Text className="text-muted-foreground text-sm">首次安装展示，完成后不会重复出现。</Text>
      <View className="w-full">
        <Button
          className="min-h-[52px] w-full"
          onPress={() => {
            telemetry.track('ui_action', { action_id: 'button.完成引导' });
            replace('home');
          }}
        >
          <Text>完成引导</Text>
        </Button>
      </View>
    </View>
  );
}
