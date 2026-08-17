import React, { useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { AppButton } from '../design-system/components';
import { AppIcon, IconName } from '../design-system/AppIcon';
import { useApp } from '../state/AppStore';
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

const cropSize = 280;
const zoomStep = 0.25;
const initialZoom = 1.25;
const nudgeStep = 12;

type Point = Readonly<{ x: number; y: number }>;

export function AvatarCropEditor({
  asset,
  onCancel,
  onConfirm,
}: Readonly<{
  asset: ImagePickerAsset;
  onCancel: () => void;
  onConfirm: (avatarUrl: string) => void;
}>) {
  const { palette } = usePreferences();
  const { user, showToast } = useApp();
  const [zoom, setZoom] = useState(initialZoom);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);
  const dragStart = useRef<Point>({ x: 0, y: 0 });
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const geometry = cropGeometry(asset, zoom);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2
    ),
    onPanResponderGrant: () => { dragStart.current = offsetRef.current; },
    onPanResponderMove: (_, gesture) => {
      const next = clampOffset({
        x: dragStart.current.x + gesture.dx,
        y: dragStart.current.y + gesture.dy,
      }, geometryRef.current);
      offsetRef.current = next;
      setOffset(next);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);

  const changeZoom = (next: number) => {
    const value = Math.min(3, Math.max(1, next));
    setZoom(value);
    const nextOffset = clampOffset(offsetRef.current, cropGeometry(asset, value));
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
  };
  const moveBy = (x: number, y: number) => {
    const next = clampOffset({
      x: offsetRef.current.x + x,
      y: offsetRef.current.y + y,
    }, geometryRef.current);
    offsetRef.current = next;
    setOffset(next);
  };
  const confirm = async () => {
    setProcessing(true);
    try {
      const crop = sourceCrop(asset, zoom, offset);
      const result = await manipulateAsync(
        asset.uri,
        [{ crop }, { resize: { width: 512, height: 512 } }],
        { base64: true, compress: 0.78, format: SaveFormat.JPEG },
      );
      if (!result.base64) throw new Error('裁剪失败');
      // base64 → OSS：presigned PUT 直传，avatarUrl 存对象 URL（不再 data URL）。
      const { apiClient } = await import('../data/apiClient');
      const url = await apiClient.uploadAvatarToStorage(
        result.base64, user?.id ?? 'anon',
      );
      onConfirm(url);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '头像上传失败', 'error');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal animationType="fade" transparent visible>
      <View style={editorStyles.backdrop}>
        <View style={[editorStyles.sheet, { backgroundColor: palette.surface }]}>
          <Text style={styles.heading}>移动和裁剪头像</Text>
          <Text style={styles.secondary}>拖动图片调整位置，使用下方按钮缩放。</Text>
          <View
            style={[editorStyles.cropFrame, { backgroundColor: palette.surfaceMuted }]}
            {...panResponder.panHandlers}
          >
            <View style={editorStyles.nonInteractive}>
              <Image
                accessibilityLabel="待裁剪头像"
                source={{ uri: asset.uri }}
                style={[
                  editorStyles.image,
                  {
                    width: geometry.width,
                    height: geometry.height,
                    transform: [{ translateX: offset.x }, { translateY: offset.y }],
                  },
                ]}
              />
            </View>
          </View>
          <View style={editorStyles.zoomControls}>
            <ZoomButton label="缩小头像" icon="minus" onPress={() => changeZoom(zoom - zoomStep)} />
            <Text style={styles.caption}>{Math.round(zoom * 100)}%</Text>
            <ZoomButton label="放大头像" icon="plus" onPress={() => changeZoom(zoom + zoomStep)} />
          </View>
          <View style={editorStyles.moveControls}>
            <NudgeButton label="上移" onPress={() => moveBy(0, -nudgeStep)} />
            <NudgeButton label="下移" onPress={() => moveBy(0, nudgeStep)} />
            <NudgeButton label="左移" onPress={() => moveBy(-nudgeStep, 0)} />
            <NudgeButton label="右移" onPress={() => moveBy(nudgeStep, 0)} />
          </View>
          <View style={editorStyles.actions}>
            <AppButton label="取消" onPress={onCancel} variant="secondary" />
            <AppButton
              disabled={processing}
              label={processing ? '处理中…' : '使用此裁剪'}
              onPress={() => void confirm()}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NudgeButton({
  label,
  onPress,
}: Readonly<{ label: string; onPress: () => void }>) {
  const { palette } = usePreferences();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[editorStyles.nudgeButton, { backgroundColor: palette.surfaceMuted }]}
    >
      <Text style={styles.caption}>{label}</Text>
    </Pressable>
  );
}

function ZoomButton({
  label,
  icon,
  onPress,
}: Readonly<{ label: string; icon: IconName; onPress: () => void }>) {
  const { palette } = usePreferences();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[editorStyles.zoomButton, { backgroundColor: palette.surfaceMuted }]}
    >
      <AppIcon color={palette.text} name={icon} size={22} />
    </Pressable>
  );
}

function cropGeometry(asset: ImagePickerAsset, zoom: number) {
  const scale = Math.max(cropSize / asset.width, cropSize / asset.height) * zoom;
  return { scale, width: asset.width * scale, height: asset.height * scale };
}

function clampOffset(point: Point, geometry: ReturnType<typeof cropGeometry>): Point {
  const maxX = Math.max(0, (geometry.width - cropSize) / 2);
  const maxY = Math.max(0, (geometry.height - cropSize) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, point.x)),
    y: Math.max(-maxY, Math.min(maxY, point.y)),
  };
}

function sourceCrop(asset: ImagePickerAsset, zoom: number, offset: Point) {
  const { scale } = cropGeometry(asset, zoom);
  const size = cropSize / scale;
  return {
    originX: Math.round(Math.max(
      0,
      Math.min(asset.width - size, (asset.width - size) / 2 - offset.x / scale),
    )),
    originY: Math.round(Math.max(
      0,
      Math.min(asset.height - size, (asset.height - size) / 2 - offset.y / scale),
    )),
    width: Math.round(size),
    height: Math.round(size),
  };
}

const editorStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.x5,
    backgroundColor: colors.scrim,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    padding: spacing.x5,
    gap: spacing.x4,
    borderRadius: radii.sheet,
    backgroundColor: colors.surface,
  },
  cropFrame: {
    width: cropSize,
    height: cropSize,
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: radii.round,
    backgroundColor: colors.surfaceMuted,
  },
  image: { alignSelf: 'center' },
  nonInteractive: { pointerEvents: 'none' },
  zoomControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.x5 },
  moveControls: { flexDirection: 'row', justifyContent: 'center', gap: spacing.x2 },
  nudgeButton: {
    minWidth: 56,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.control,
    backgroundColor: colors.surfaceMuted,
  },
  zoomButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.round,
    backgroundColor: colors.surfaceMuted,
  },
  actions: { gap: spacing.x3 },
});
