import React from 'react';
import { Image, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image as ImageIcon } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useApp } from '../state/AppStore';

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
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-wide">问题截图</Text>
        <Text className="text-muted-foreground text-xs">{value.length}/{maximumScreenshots}</Text>
      </View>
      {value.length ? (
        <View className="flex-row flex-wrap gap-3">
          {value.map((screenshot, index) => (
            <View
              key={`${screenshot.fileName}-${index}`}
              className="bg-card overflow-hidden rounded-lg"
            >
              <Image
                accessibilityLabel={`问题截图 ${index + 1}`}
                source={{ uri: screenshot.data }}
                className="h-[104px] w-[104px]"
              />
              <Pressable
                accessibilityRole="button"
                className="min-h-[44px] items-center justify-center"
                onPress={() => remove(index)}
              >
                <Text className="text-destructive font-bold">移除</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text className="text-muted-foreground text-sm">可上传最多 3 张截图，帮助我们定位问题。</Text>
      )}
      {value.length < maximumScreenshots ? (
        <Button className="min-h-[52px] w-full" variant="outline" onPress={() => void choose()}>
          <Icon as={ImageIcon} size={20} />
          <Text>添加问题截图</Text>
        </Button>
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
