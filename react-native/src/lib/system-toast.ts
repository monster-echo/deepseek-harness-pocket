/**
 * 系统 toast。
 *
 * 不再自绘浮层——自绘的绝对定位横幅无法感知灵动岛/刘海，必然压住状态栏区域。
 * 这里改用平台原生呈现：
 *   - Android：`ToastAndroid`（真正的系统 toast，由系统负责位置与时长）
 *   - iOS：系统没有 toast API，退回 `Alert`（原生 UIAlertController，位置由系统决定）
 */
import { Alert, Platform, ToastAndroid } from 'react-native';

export type SystemToastTone = 'info' | 'success' | 'error';

const IOS_TITLE: Readonly<Record<SystemToastTone, string>> = {
  info: '提示',
  success: '成功',
  error: '出错了',
};

export function showSystemToast(message: string, tone: SystemToastTone = 'info'): void {
  if (message.length === 0) return;
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert(IOS_TITLE[tone], message, [{ text: '知道了' }]);
}
