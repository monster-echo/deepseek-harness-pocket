import React, { ErrorInfo, ReactNode } from 'react';
import { Text, View } from 'react-native';
import { styles } from '../theme/styles';
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
      <View style={styles.centered}>
        <Text style={styles.title}>页面暂时无法显示</Text>
        <Text style={styles.secondary}>错误已经记录，请重新启动应用。</Text>
      </View>
    );
  }
}

