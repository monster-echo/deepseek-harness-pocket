/**
 * 扫码页（Telegram 风格）：全屏暗色取景 + 扫到即出「授权登录」确认卡。
 *
 * 支持两种码：
 * 1. **授权登录**（主）：扫桌面端控制台「账号」页的 `dshp://link?...`。
 *    与 Telegram 的两段式一致：先 `previewDeviceLink(code)` 向服务端问清
 *    「这是哪台电脑」（名字以服务端已注册的 Worker 为准，防伪造二维码），
 *    用户在确认卡上点「授权登录」才真的 `approveDeviceLink`。
 * 2. **配对绑定**（旧路径）：`dshp://pair?...`（`dshc qr`）→ bindWorkerByCode。
 *
 * 取景体验对齐 Telegram：全屏黑色相机、方形挖孔 + 四角亮框、扫描线动画、
 * 顶部标题/关闭/手电筒，扫到后压暗相机弹出确认卡。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, Text as RNText, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  Flashlight,
  FlashlightOff,
  Laptop,
  QrCode as QRCode,
  ShieldCheck,
  X,
} from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useApp } from '@/state/AppStore';
import { useDshStore } from '@/state/dshStore';
import { approveDeviceLink, bindWorkerByCode, previewDeviceLink } from '@/dsh/connection';
import { parseLinkScan, parsePairScan } from './qrPayload';
import type { LinkScan } from './qrPayload';

/** 取景框边长（正方形，Telegram 同款比例）。 */
const CUTOUT = 250;

/** 待确认的授权请求：码 + 服务端权威设备信息。 */
type PendingLink = LinkScan & {
  deviceName: string;
  devicePlatform?: string;
  deviceIp?: string;
  workerKnown: boolean;
};

export function QrPairScreen() {
  const { back, showToast, user } = useApp();
  const connectGateway = useDshStore((s) => s.connectGateway);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  // 相机回调会连续触发：扫到有效码后立刻上锁，避免重复处理
  const lockedRef = useRef(false);

  useEffect(() => {
    if (permission !== null && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  /** 授权登录：确认卡上的「授权登录」。 */
  const authorize = useCallback(
    (payload: PendingLink): void => {
      if (busy) return;
      setBusy(true);
      setHint(null);
      const email = user?.email ?? undefined;
      void approveDeviceLink(payload.code, email ?? undefined)
        .then(() => {
          setPendingLink(null);
          showToast(
            payload.deviceName !== '这台电脑' ? `已授权 ${payload.deviceName} 登录` : '已授权这台电脑登录',
            'success',
          );
          back();
        })
        .catch((error: unknown) => {
          setBusy(false);
          setHint(error instanceof Error ? error.message : '授权失败，请重试');
        });
    },
    [back, busy, showToast, user],
  );

  const onScan = useCallback(
    (data: string): void => {
      if (lockedRef.current || busy || pendingLink !== null) return;
      // ① 授权登录码：先问服务端这是哪台电脑，出确认卡（不立即执行）
      const link = parseLinkScan(data);
      if (link !== null) {
        lockedRef.current = true;
        void previewDeviceLink(link.code)
          .then((info) => {
            setPendingLink({
              ...link,
              deviceName: info.name,
              devicePlatform: info.platform,
              deviceIp: info.ip,
              workerKnown: info.workerKnown,
            });
            setHint(null);
          })
          .catch((error: unknown) => {
            lockedRef.current = false;
            setHint(error instanceof Error ? error.message : '识别失败，请重试');
          });
        return;
      }
      // ② 旧配对码：保持原行为（直接绑定）
      const payload = parsePairScan(data);
      if (payload === null) {
        setHint('这不是配对/授权二维码，请对准电脑上显示的二维码');
        return;
      }
      lockedRef.current = true;
      setBusy(true);
      setHint(null);
      void bindWorkerByCode(payload.code, payload.name)
        .then(() => {
          connectGateway();
          showToast(
            payload.name !== undefined ? `已绑定 ${payload.name}` : '已绑定电脑',
            'success',
          );
          back();
        })
        .catch((error: unknown) => {
          lockedRef.current = false;
          setBusy(false);
          setHint(error instanceof Error ? error.message : '绑定失败，请重试');
        });
    },
    [back, busy, connectGateway, pendingLink, showToast],
  );

  const cancelPending = useCallback((): void => {
    setPendingLink(null);
    setHint(null);
    lockedRef.current = false;
  }, []);

  const granted = permission?.granted === true;

  return (
    <View className="flex-1 bg-black">
      {/* 顶栏：关闭 / 标题 / 手电筒（Telegram 同布局） */}
      <View className="absolute left-0 right-0 top-0 z-10 flex-row items-center justify-between px-4 pb-3 pt-12">
        <Pressable onPress={() => back()} hitSlop={12} accessibilityLabel="关闭">
          <Icon as={X} className="size-6 text-white/90" />
        </Pressable>
        <RNText className="text-[17px] font-semibold text-white">扫描二维码</RNText>
        <Pressable
          onPress={() => setTorch((t) => !t)}
          hitSlop={12}
          accessibilityLabel={torch ? '关闭手电筒' : '打开手电筒'}
        >
          <Icon as={torch ? FlashlightOff : Flashlight} className="size-6 text-white/90" />
        </Pressable>
      </View>

      {granted ? (
        <View className="flex-1">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={
              busy || pendingLink !== null ? undefined : (result) => onScan(result.data)
            }
          />
          {/* 取景遮罩：四周压暗 + 方形亮框 + 扫描线 */}
          <View className="absolute inset-0 items-center justify-center">
            <CutoutOverlay />
            {pendingLink === null && !busy ? <ScanLine /> : null}
          </View>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Icon as={QRCode} className="size-10 text-white/60" />
          <Text className="text-base font-semibold text-white">需要相机权限</Text>
          <Text className="text-center text-sm leading-5 text-white/60">
            扫码需要读取相机；没有权限时可在「添加电脑」里手输配对码。
          </Text>
          <Button
            className="mt-1"
            disabled={permission !== null && !permission.canAskAgain}
            onPress={() => void requestPermission()}
          >
            <Text>授权相机</Text>
          </Button>
        </View>
      )}

      {/* 底部：确认卡（压暗相机）/ 进度 / 提示 */}
      <View className="absolute bottom-0 left-0 right-0 px-4 pb-8">
        {busy ? (
          <View className="items-center gap-2 rounded-2xl bg-black/70 px-4 py-4">
            <ActivityIndicator />
            <Text className="text-sm text-white/80">
              {pendingLink !== null ? '正在授权这台电脑…' : '正在绑定…'}
            </Text>
          </View>
        ) : pendingLink !== null ? (
          <AuthorizeCard
            payload={pendingLink}
            email={user?.email ?? undefined}
            onAuthorize={() => authorize(pendingLink)}
            onCancel={cancelPending}
          />
        ) : (
          <View className="gap-1.5 rounded-2xl bg-black/60 px-4 py-3">
            <Text className="text-sm leading-5 text-white/80">
              把电脑上显示的二维码放入框内：桌面端 DSH Pocket「账号」页的码用于
              <RNText className="font-semibold text-white">授权登录</RNText>，
              <RNText className="font-mono text-[13px] text-white">dshc qr</RNText>
              的码用于
              <RNText className="font-semibold text-white">配对绑定</RNText>。
            </Text>
            {hint !== null && <Text className="text-sm text-red-400">{hint}</Text>}
          </View>
        )}
      </View>
    </View>
  );
}

/** 确认卡：Telegram 的「登录？」弹窗，但展示的是服务端核实的设备信息。 */
function AuthorizeCard({
  payload,
  email,
  onAuthorize,
  onCancel,
}: {
  payload: PendingLink;
  email?: string;
  onAuthorize: () => void;
  onCancel: () => void;
}) {
  const lines = [payload.deviceName];
  if (payload.devicePlatform !== undefined) {
    lines.push(platformLabel(payload.devicePlatform));
  }
  if (payload.deviceIp !== undefined && payload.deviceIp.length > 0) {
    lines.push(`来自 ${payload.deviceIp}`);
  }
  if (!payload.workerKnown) {
    lines.push('（该电脑还没连上服务，先授权，连上后即出现在设备列表）');
  }
  return (
    <View className="rounded-3xl bg-background p-5 shadow-2xl">
      <View className="items-center gap-2">
        <View className="bg-primary/10 h-12 w-12 items-center justify-center rounded-full">
          <Icon as={Laptop} className="size-6 text-primary" />
        </View>
        <Text className="text-foreground text-[17px] font-semibold">登录到 DSH Pocket？</Text>
      </View>
      <View className="mt-3 gap-1 rounded-xl bg-muted/60 px-3 py-2.5">
        {lines.map((line, i) => (
          <RNText
            key={line}
            className={i === 0 ? 'text-foreground text-center text-[15px] font-semibold' : 'text-muted-foreground text-center text-[13px]'}
          >
            {line}
          </RNText>
        ))}
      </View>
      <Text className="text-muted-foreground mt-2.5 text-[13px] leading-5">
        授权后这台电脑会登录你的账号{email !== undefined ? `（${email}）` : ''}，
        并出现在你的工作电脑列表里。请确认是你本人的电脑。
      </Text>
      <View className="mt-4 flex-row gap-3">
        <Button className="flex-1" onPress={onAuthorize}>
          <Icon as={ShieldCheck} className="text-primary-foreground size-4" />
          <Text>授权登录</Text>
        </Button>
        <Button className="flex-1" variant="outline" onPress={onCancel}>
          <Text>取消</Text>
        </Button>
      </View>
    </View>
  );
}

/** 平台标识 → 中文（桌面端 Dart 上送 macos|windows|linux；兼容 Go 风格 darwin|win32）。 */
function platformLabel(platform: string): string {
  switch (platform) {
    case 'macos':
    case 'darwin':
      return 'macOS';
    case 'windows':
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return platform;
  }
}

/** 四角亮框 + 挖孔遮罩：用四条边把取景框外区域压暗，角上画亮色 L 形。 */
function CutoutOverlay(): React.JSX.Element {
  const border = 'absolute bg-white/90';
  const len = 26;
  const thick = 3;
  const corners: Array<{ style: object }> = [
    { style: { top: 0, left: 0, width: len, height: thick } },
    { style: { top: 0, left: 0, width: thick, height: len } },
    { style: { top: 0, right: 0, width: len, height: thick } },
    { style: { top: 0, right: 0, width: thick, height: len } },
    { style: { bottom: 0, left: 0, width: len, height: thick } },
    { style: { bottom: 0, left: 0, width: thick, height: len } },
    { style: { bottom: 0, right: 0, width: len, height: thick } },
    { style: { bottom: 0, right: 0, width: thick, height: len } },
  ];
  return (
    <View
      testID="qr-cutout"
      style={{
        width: CUTOUT,
        height: CUTOUT,
        shadowColor: '#000',
        shadowOpacity: 0.9,
        shadowRadius: 16,
      }}
    >
      {corners.map((c, i) => (
        <View key={i} className={border} style={c.style} />
      ))}
    </View>
  );
}

/** 扫描线：在取景框内上下往复（Telegram/微信同款）。 */
function ScanLine(): React.JSX.Element {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [y]);
  return (
    <View className="absolute" style={{ width: CUTOUT, height: CUTOUT }} pointerEvents="none">
      <Animated.View
        className="bg-primary/80 absolute left-2 right-2 h-[2px] rounded-full"
        style={{ transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, CUTOUT - 4] }) }] }}
      />
    </View>
  );
}