import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { DesignSystemGallery } from '../components/app/DesignSystemGallery';
import { AppIcon } from '../design-system/AppIcon';
import { AsyncState } from '../state/asyncState';
import { telemetry } from '../telemetry/Telemetry';

type DemoState = AsyncState<ReadonlyArray<string>>;
const states: ReadonlyArray<DemoState> = [
  { status: 'loading' },
  { status: 'empty' },
  { status: 'error', message: '服务暂时不可用' },
  { status: 'offline' },
  { status: 'unauthorized' },
  { status: 'success', data: ['状态加载成功'] },
];

export function StateGalleryScreen() {
  const [index, setIndex] = useState(0);
  const state = states[index];
  const next = () => setIndex((value) => (value + 1) % states.length);
  return (
    <View className="bg-muted/40 flex-1">
      <ScreenHeader title="状态库 / 原语" />
      <ScrollView contentContainerClassName="pb-10">
        <View className="items-center gap-4 p-6">
          <StateContent state={state} />
          <View className="w-full">
            <Button
              className="min-h-[52px] w-full"
              onPress={() => {
                telemetry.track('ui_action', { action_id: 'button.切换状态' });
                next();
              }}
            >
              <Text>切换状态</Text>
            </Button>
          </View>
        </View>
        <View className="px-4">
          <DesignSystemGallery />
        </View>
      </ScrollView>
    </View>
  );
}

function StateContent({ state }: Readonly<{ state: DemoState }>) {
  const brand = useCSSVariable('--color-primary') as string;
  const config = {
    idle: ['check', '等待操作'],
    loading: ['settings', '正在加载'],
    empty: ['gift', '暂无数据'],
    error: ['alert', state.status === 'error' ? state.message : '发生错误'],
    offline: ['globe', '网络连接已断开'],
    unauthorized: ['lock', '请先登录'],
    success: ['check', '加载成功'],
  } as const;
  const [icon, label] = config[state.status];
  return (
    <View className="items-center gap-3">
      <View className="bg-primary/10 h-[72px] w-[72px] items-center justify-center rounded-full">
        <AppIcon name={icon} color={brand} size={36} />
      </View>
      <Text className="text-foreground text-xl font-bold">{label}</Text>
      <Text className="text-muted-foreground text-sm">状态互斥，由统一状态机驱动。</Text>
    </View>
  );
}

function ScreenHeader({ title }: Readonly<{ title: string }>) {
  const navigation = useNavigation();
  return (
    <View className="border-border/60 h-[58px] flex-row items-center justify-between border-b px-2">
      <View className="w-[88px] items-start">
        {navigation.canGoBack() ? (
          <Button
            accessibilityLabel="返回"
            onPress={() => navigation.goBack()}
            size="icon"
            variant="ghost"
          >
            <Icon as={ArrowLeft} className="size-5" />
          </Button>
        ) : null}
      </View>
      <Text className="absolute left-[88px] right-[88px] text-center text-[17px] font-bold">
        {title}
      </Text>
      <View className="w-[88px] items-end" />
    </View>
  );
}
