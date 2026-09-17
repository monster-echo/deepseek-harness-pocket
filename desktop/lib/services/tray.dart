/// 托盘常驻（主窗口引擎）：状态行 + 精简菜单。
///
/// 双窗口：托盘是全应用唯一管理入口，菜单只留主入口——
/// 控制台（全部管理面板）/ Harness 主窗口 / 启停 / 开机启动 / 退出。
/// 「开机启动」为 checkbox 菜单项，每次弹出菜单前强制按当前自启状态重建，
/// 保证勾选态始终新鲜。退出 = 停止服务再退出；关窗只是收托盘。
library;

import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import '../models.dart';
import '../providers.dart';
import 'notify.dart';
import 'worker.dart';

typedef WorkerAction = Future<void> Function(WorkerService svc, AppSettings settings);

class TrayController with TrayListener {
  TrayController(this._container);

  final ProviderContainer _container;
  bool _inited = false;
  bool _menuBuilding = false;

  /// 构建期间又有刷新请求：构建结束后补一次，避免「点了勾选态没更新」。
  bool _menuDirty = false;

  Future<void> init() async {
    if (_inited) return;
    _inited = true;
    // macOS 菜单栏用黑色 template 图（自动适配深浅色），Windows 托盘用品牌色
    if (Platform.isMacOS) {
      await trayManager.setIcon('assets/tray_icon_mac.png', isTemplate: true);
    } else {
      await trayManager.setIcon('assets/tray_icon.png');
    }
    await _refreshMenu();
    trayManager.addListener(this);
    // 运行态翻转 / 自启开关变化 → 重建菜单（值不变时不通知，不随轮询 tick 抖动）
    _container.listen<AsyncValue<WorkerStatus>>(
      workerStatusProvider,
      (_, _) => _refreshMenu(),
    );
    _container.listen<AsyncValue<bool>>(
      autostartEnabledProvider,
      (_, _) => _refreshMenu(),
    );
  }

  /// 精简菜单：状态 + 两个窗口入口 + 启停 + 自启 + 退出。
  /// 管理面板（状态/账号/版本/日志）在控制台窗口的侧栏里切换。
  Menu _buildMenu() {
    final running = _container.read(workerStatusProvider).value?.running ?? false;
    final autostart = _container.read(autostartEnabledProvider).value ?? false;
    return Menu(
      items: [
        MenuItem(key: 'worker-state', label: 'DSH Pocket：${running ? '运行中' : '已停止'}', disabled: true),
        MenuItem.separator(),
        MenuItem(key: 'open-console', label: '打开控制台'),
        MenuItem(key: 'open-main', label: '打开 Harness'),
        MenuItem.separator(),
        MenuItem(key: 'start', label: '启动', disabled: running),
        MenuItem(key: 'stop', label: '停止', disabled: !running),
        // checkbox：系统原生勾选态；右键弹出前 _refreshMenu 保证与实际自启状态一致
        MenuItem.checkbox(key: 'autostart', label: '开机启动', checked: autostart),
        MenuItem.separator(),
        MenuItem(key: 'quit', label: '退出'),
      ],
    );
  }

  Future<void> _refreshMenu() async {
    if (_menuBuilding) {
      _menuDirty = true;
      return;
    }
    _menuBuilding = true;
    try {
      final running = _container.read(workerStatusProvider).value?.running ?? false;
      await trayManager.setToolTip('DSH Pocket — ${running ? '运行中' : '已停止'}');
      await trayManager.setContextMenu(_buildMenu());
    } catch (_) {
      // 无会话环境等场景托盘不可用，静默
    } finally {
      _menuBuilding = false;
      if (_menuDirty) {
        _menuDirty = false;
        unawaited(_refreshMenu());
      }
    }
  }

  @override
  void onTrayIconMouseDown() {
    // 左键 = 控制台（管理是托盘的本职；主窗口从菜单或使用习惯进入）
    _container.read(consoleWindowServiceProvider).open(panel: 'status');
  }

  @override
  void onTrayIconRightMouseDown() async {
    // 弹出前强制刷新：先向系统重新确认自启状态（用户可能在系统设置里改过），
    // 再重建菜单，保证 checkbox 反映真实值
    try {
      await _container.read(autostartEnabledProvider.notifier).refresh();
    } catch (_) {}
    await _refreshMenu();
    trayManager.popUpContextMenu();
  }

  @override
  void onTrayMenuItemClick(MenuItem menuItem) async {
    switch (menuItem.key) {
      case 'open-console':
        await _container.read(consoleWindowServiceProvider).open(panel: 'status');
      case 'open-main':
        await windowManager.show();
        await windowManager.focus();
      case 'start':
        await _runWorkerAction((svc, s) => svc.start(s));
      case 'stop':
        await _runWorkerAction((svc, _) => svc.stop());
      case 'autostart':
        final notifier = _container.read(autostartEnabledProvider.notifier);
        final current = _container.read(autostartEnabledProvider).value ?? false;
        try {
          await notifier.set(!current);
        } catch (e) {
          // 托盘没有 context 弹 toast：用系统通知告知失败原因（如系统登录项被关）
          debugPrint('[tray] autostart toggle failed: $e');
          try {
            await DesktopNotify.notify('开机启动设置失败', body: '$e');
          } catch (_) {}
        }
        await _refreshMenu();
      case 'quit':
        await quitApp();
    }
  }

  Future<void> _runWorkerAction(WorkerAction action) async {
    final bootError = _container.read(workerBootErrorProvider.notifier);
    try {
      await action(_container.read(workerServiceProvider), _container.read(settingsProvider));
      bootError.set(null);
    } on WorkerActionException catch (e) {
      // 托盘没有 context 弹 feedback：失败原因落到 bootError，主窗口引导面可见
      bootError.set(e.message);
    } catch (_) {
      // 托盘动作静默失败（控制台里有可见的错误展示）
    } finally {
      _container.invalidate(workerStatusProvider);
    }
  }

  /// 真正退出：停止服务（固定行为）后退出。
  /// windowManager.destroy = NSApp.terminate，控制台引擎随进程一起结束。
  Future<void> quitApp() async {
    try {
      await _container.read(workerServiceProvider).stop();
    } catch (_) {}
    await windowManager.destroy();
  }
}
