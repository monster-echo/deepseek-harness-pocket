import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { AppButton } from '../design-system/components';
import { useApp } from '../state/AppStore';
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

export type FeedbackScreenshot = Readonly<{
  fileName: string;
  mimeType: 'image/jpeg';
  data: string;
}>;

const maximumScreenshots = 3;
const maximumWidth = 1280;

export function FeedbackScreenshots({
  value,
  onChange,
}: Readonly<{
  value: readonly FeedbackScreenshot[];
  onChange: (next: readonly FeedbackScreenshot[]) => void;
}>) {
  const { showToast } = useApp();
  const { palette } = usePreferences();
  const choose = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast('需要相册权限才能添加问题截图', 'error');
      return;
    }
    const remaining = maximumScreenshots - value.length;
    const selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
    });
    if (selection.canceled) return;
    const additions = await Promise.all(
      selection.assets.slice(0, remaining).map(toScreenshot),
    );
    onChange([...value, ...additions.filter(isScreenshot)]);
  };
  const remove = (index: number) => {
    onChange(value.filter((_, current) => current !== index));
  };

  return (
    <View style={screenshotStyles.section}>
      <View style={screenshotStyles.heading}>
        <Text style={styles.sectionLabel}>问题截图</Text>
        <Text style={styles.caption}>{value.length}/{maximumScreenshots}</Text>
      </View>
      {value.length ? (
        <View style={screenshotStyles.previews}>
          {value.map((screenshot, index) => (
            <View
              key={`${screenshot.fileName}-${index}`}
              style={[screenshotStyles.previewCard, { backgroundColor: palette.surface }]}
            >
              <Image
                accessibilityLabel={`问题截图 ${index + 1}`}
                source={{ uri: screenshot.data }}
                style={screenshotStyles.preview}
              />
              <Pressable
                accessibilityRole="button"
                onPress={() => remove(index)}
                style={screenshotStyles.remove}
              >
                <Text style={screenshotStyles.removeText}>移除</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.secondary}>可上传最多 3 张截图，帮助我们定位问题。</Text>
      )}
      {value.length < maximumScreenshots ? (
        <AppButton
          icon="image"
          label="添加问题截图"
          onPress={() => void choose()}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

async function toScreenshot(
  asset: ImagePicker.ImagePickerAsset,
): Promise<FeedbackScreenshot | null> {
  const actions = asset.width > maximumWidth
    ? [{ resize: { width: maximumWidth } }]
    : [];
  const result = await manipulateAsync(
    asset.uri,
    actions,
    { base64: true, compress: 0.68, format: SaveFormat.JPEG },
  );
  if (!result.base64) return null;
  return {
    fileName: normalizedName(asset.fileName),
    mimeType: 'image/jpeg',
    data: `data:image/jpeg;base64,${result.base64}`,
  };
}

function normalizedName(value?: string | null) {
  const stem = value?.replace(/\.[^.]+$/, '').slice(0, 100) || `screenshot-${Date.now()}`;
  return `${stem}.jpg`;
}

function isScreenshot(
  value: FeedbackScreenshot | null,
): value is FeedbackScreenshot {
  return value !== null;
}

const screenshotStyles = StyleSheet.create({
  section: { gap: spacing.x3 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previews: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x3 },
  previewCard: {
    overflow: 'hidden',
    borderRadius: radii.control,
    backgroundColor: colors.surface,
  },
  preview: { width: 104, height: 104 },
  remove: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: colors.error, fontWeight: '700' },
});
