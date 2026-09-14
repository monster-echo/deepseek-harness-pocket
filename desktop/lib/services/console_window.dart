/// 控制台窗口管理（主窗口引擎侧）。
///
/// 双窗口架构：
/// - 主窗口（引擎 0）= DeepSeek Harness 网页壳（webview），零管理 chrome；
/// - 控制台窗口 = desktop_multi_window 创建的独立引擎，承载全部管理面板。
///
/// 本服务只从主引擎调用：找不到控制台窗口就创建（hiddenAtLaunch，
/// 由控制台引擎自行 show），已有则经 WindowMethodChannel 通知切面板并亮窗。
library;

import 'dart:async';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/foundation.dart' show debugPrint;

class ConsoleWindowService {
  String? _consoleWindowId;
  bool _creating = false;

  Future<void> open({String? panel}) async {
    var id = _consoleWindowId ?? await _findConsoleWindow();
    if (id == null) {
      if (_creating) return; // 防抖：创建中忽略连点
      _creating = true;
      try {
        final controller = await WindowController.create(const WindowConfiguration(
          arguments: '{"type":"console"}',
          hiddenAtLaunch: true,
        ));
        id = controller.windowId;
        _consoleWindowId = id;
        // 新引擎冷启动需要时间：先给它一点时间注册导航通道
        await Future<void>.delayed(const Duration(milliseconds: 800));
      } catch (e) {
        debugPrint('[console-window] create failed: $e');
        return;
      } finally {
        _creating = false;
      }
    }
    final controller = WindowController.fromWindowId(id);
    if (panel != null) {
      await _navigate(controller, panel);
    }
    try {
      await controller.show();
    } catch (e) {
      // 窗口可能已被销毁（注册表移除）：清缓存重开一次
      debugPrint('[console-window] show failed: $e');
      _consoleWindowId = null;
      if (panel != null) {
        await open(panel: panel);
      }
    }
  }

  Future<void> _navigate(WindowController controller, String panel) async {
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        await controller.invokeMethod('navigate', {'panel': panel});
        return;
      } catch (e) {
        // 新引擎的 handler 可能尚未注册：退避重试
        debugPrint('[console-window] navigate retry ${attempt + 1}: $e');
        await Future<void>.delayed(const Duration(milliseconds: 500));
      }
    }
  }

  Future<String?> _findConsoleWindow() async {
    try {
      for (final controller in await WindowController.getAll()) {
        if (controller.arguments.contains('"console"')) {
          _consoleWindowId = controller.windowId;
          return controller.windowId;
        }
      }
    } catch (e) {
      debugPrint('[console-window] getAll failed: $e');
    }
    return null;
  }
}
