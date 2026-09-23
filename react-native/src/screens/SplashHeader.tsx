import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';

type SplashHeaderProps = Readonly<{
  canSkip: boolean;
  countdown: number;
  onSkip: () => void;
  surfaceColor: string;
}>;

export function SplashHeader({
  canSkip,
  countdown,
  onSkip,
  surfaceColor,
}: SplashHeaderProps) {
  return (
    <View className="min-h-[44px] flex-row items-center justify-between">
      <View
        accessibilityLabel={`倒计时 ${countdown}`}
        accessibilityLiveRegion="polite"
        className="h-11 w-11 items-center justify-center rounded-full"
        style={{ backgroundColor: surfaceColor }}
      >
        <Text className="text-primary text-lg font-bold">{countdown}</Text>
      </View>
      {canSkip ? (
        <Pressable
          accessibilityLabel="跳过宣传页"
          accessibilityRole="button"
          onPress={onSkip}
          className="min-h-[44px] min-w-[44px] items-center justify-center px-3"
        >
          <Text className="text-muted-foreground text-sm">跳过</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
