import React, { ErrorInfo, ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { telemetry } from './Telemetry';

type State = Readonly<{ failed: boolean }>;

export class AppErrorBoundary extends React.Component<
  Readonly<{ children: ReactNode }>,
  State
> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    telemetry.report(error, {
      component_stack: info.componentStack?.slice(0, 180) ?? 'unknown',
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View className="bg-background flex-1 items-center justify-center gap-4 p-6">
        <Text className="text-foreground text-2xl font-bold">页面暂时无法显示</Text>
        <Text className="text-muted-foreground text-sm">错误已经记录，请重新启动应用。</Text>
      </View>
    );
  }
}
