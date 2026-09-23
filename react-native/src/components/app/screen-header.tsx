import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';

/**
 * 二级页统一页头（RNR 版）。
 *
 * 导航器设了 `headerShown: false`，返回入口必须由页面自己提供，
 * 否则 push 出来的页面无法回退。
 */
export function ScreenHeader({
  title,
  rightAction,
}: Readonly<{
  title: string;
  rightAction?: Readonly<{ label: string; onPress: () => void; disabled?: boolean }>;
}>) {
  const navigation = useNavigation();
  const canGoBack = navigation.canGoBack();
  return (
    <View className="border-border/60 h-[58px] flex-row items-center justify-between border-b px-2">
      <View className="w-[88px] items-start">
        {canGoBack ? (
          <Button
            accessibilityLabel="返回"
            size="icon"
            variant="ghost"
            onPress={() => navigation.goBack()}
          >
            <Icon as={ChevronLeft} className="text-foreground size-5" />
          </Button>
        ) : null}
      </View>
      <Text className="absolute left-[88px] right-[88px] text-center text-[17px] font-bold">
        {title}
      </Text>
      <View className="w-[88px] items-end">
        {rightAction ? (
          <Button
            accessibilityLabel={rightAction.label}
            disabled={rightAction.disabled}
            size="sm"
            variant="ghost"
            onPress={rightAction.onPress}
          >
            <Text className="text-sm font-bold">{rightAction.label}</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}
