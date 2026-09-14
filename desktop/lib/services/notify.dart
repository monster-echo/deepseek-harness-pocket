/// 桌面系统通知（local_notifier）。
///
/// 用途：自动发现新版本时告知用户（macOS 通知中心 / Windows toast）。
/// 点击通知可打开控制台状态页（那里有「检查更新」入口）。
library;

import 'package:local_notifier/local_notifier.dart';

class DesktopNotify {
  DesktopNotify._();

  static bool _inited = false;

  static Future<void> _ensureInit() async {
    if (_inited) return;
    _inited = true;
    await localNotifier.setup(appName: 'DSH Pocket');
  }

  /// 版本发现通知；[onClick] 在用户点击通知时触发。
  static Future<void> versionFound(
    String version, {
    void Function()? onClick,
  }) async {
    await _ensureInit();
    final notification = LocalNotification(
      title: 'DSH Pocket 有新版本 $version',
      body: '打开控制台 → 状态 →「检查更新」即可安装',
    )..onClick = onClick;
    await notification.show();
  }

  /// 通用提示通知（调试/重要事件用）。
  static Future<void> notify(String title, {String? body}) async {
    await _ensureInit();
    final notification = LocalNotification(title: title, body: body);
    await notification.show();
  }
}
