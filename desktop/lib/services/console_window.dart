/// 控制台窗口管理（主窗口引擎侧）。
///
/// 双窗口架构：
/// - 主窗口（引擎 0）= DeepSeek Harness 网页壳（webview），零管理 chrome；
/// - 控制台窗口 = desktop_multi_window 创建的独立引擎，承载全部管理面板。
///
/// 本服务只从主引擎调用。打开速度是这里的核心指标：
/// - **预热**（[prewarm]）：应用启动后台就把控制台引擎拉起（hiddenAtLaunch），
///   托盘点击时窗口已经存在，只剩「显示」一步，不再有引擎冷启动的白等；
/// - **探活**（[_waitReady]）：子引擎注册好方法通道立刻返回，替代原来写死的
///   800ms 盲等 + 500ms×3 重试；
/// - 子引擎不自行 show（main.dart 侧约定），显示时机完全由本服务控制，
///   否则预热会在启动时闪一下控制台窗口。
library;

import 'dart:async';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/foundation.dart' show debugPrint;

class ConsoleWindowService {
  String? _consoleWindowId;
  Future<void>? _inflight;
  bool _ready = false;

  /// 预热：应用启动后调用一次，把控制台引擎提前拉起（隐藏）。
  /// 失败不抛（窗口不可用时按需创建的老路径仍然工作）。
  Future<void> prewarm() async {
    final id = await _ensureWindow();
    if (id == null) return;
    unawaited(_waitReady(id));
  }

  /// 打开控制台：确保窗口存在 → 等通道就绪 → 切面板 → 显示并聚焦。
  Future<void> open({String? panel}) async {
    var id = await _ensureWindow();
    if (id == null) return;
    var controller = WindowController.fromWindowId(id);
    await _waitReady(id);
    if (panel != null) await _navigate(controller, panel);
    if (await _show(controller)) return;

    // 窗口可能已被销毁（注册表移除）：清缓存重开一次
    _consoleWindowId = null;
    _ready = false;
    id = await _ensureWindow();
    if (id == null) return;
    controller = WindowController.fromWindowId(id);
    await _waitReady(id);
    if (panel != null) await _navigate(controller, panel);
    await _show(controller);
  }

  Future<bool> _show(WindowController controller) async {
    try {
      await controller.show();
      return true;
    } catch (e) {
      debugPrint('[console-window] show failed: $e');
      return false;
    }
  }

  /// 确保控制台窗口存在（并发去重：预热与首次点击同时发生时只创建一个）。
  Future<String?> _ensureWindow() async {
    final known = _consoleWindowId;
    if (known != null) return known;
    final inflight = _inflight;
    if (inflight != null) {
      await inflight;
      return _consoleWindowId;
    }
    final completer = Completer<void>();
    _inflight = completer.future;
    try {
      final found = await _findConsoleWindow();
      if (found != null) return found;
      final controller = await WindowController.create(const WindowConfiguration(
        arguments: '{"type":"console"}',
        hiddenAtLaunch: true,
      ));
      _consoleWindowId = controller.windowId;
      _ready = false;
      return _consoleWindowId;
    } catch (e) {
      debugPrint('[console-window] create failed: $e');
      return null;
    } finally {
      _inflight = null;
      completer.complete();
    }
  }

  /// 等子引擎的方法通道可用（子引擎注册 handler 后 ping 立即返回）。
  /// 预热过的情况下这里几乎零等待。
  Future<bool> _waitReady(
    String id, {
    Duration timeout = const Duration(seconds: 8),
  }) async {
    if (_ready) return true;
    final controller = WindowController.fromWindowId(id);
    final deadline = DateTime.now().add(timeout);
    var delayMs = 30;
    while (DateTime.now().isBefore(deadline)) {
      try {
        await controller.invokeMethod('ping');
        _ready = true;
        return true;
      } catch (_) {
        // 子引擎尚未注册 handler：退避重试
        await Future<void>.delayed(Duration(milliseconds: delayMs));
        if (delayMs < 200) delayMs *= 2;
      }
    }
    debugPrint('[console-window] ready probe timed out after $timeout');
    return false;
  }

  Future<void> _navigate(WindowController controller, String panel) async {
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        await controller.invokeMethod('navigate', {'panel': panel});
        return;
      } catch (e) {
        debugPrint('[console-window] navigate retry ${attempt + 1}: $e');
        await Future<void>.delayed(const Duration(milliseconds: 150));
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