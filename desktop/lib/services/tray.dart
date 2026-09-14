/// 托盘常驻（主窗口引擎）：状态行 + 菜单。
///
/// 双窗口：托盘是全应用唯一管理入口。
/// - 「打开控制台」/各管理面板 → 独立控制台窗口（services/console_window.dart）；
/// - 「打开 Harness 主窗口」 → 主窗口（纯 harness 网页壳）。
///
/// 菜单与 tooltip 随 worker 运行态刷新；「开机启动」为 checkbox 菜单项，
/// 每次弹出菜单前强制按当前自启状态重建，保证勾选态始终新鲜。
/// 退出 = 停止 worker 再退出（固定行为）；关窗只是收托盘。
library;

import 'dart:io' show Platform;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import '../app_nav.dart';
import '../models.dart';
import '../providers.dart';
import 'worker.dart';

typedef WorkerAction = Future<void> Function(WorkerService svc, AppSettings settings);

class TrayController with TrayListener {
  TrayController(this._container);

  final ProviderContainer _container;
  bool _inited = false;
  bool _menuBuilding = false;

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

  /// 组装菜单（读当前容器状态；checkbox 直接反映自启开关）。
  Menu _buildMenu() {
    final running = _container.read(workerStatusProvider).value?.running ?? false;
    final autostart = _container.read(autostartEnabledProvider).value ?? false;
    return Menu(
      items: [
        MenuItem(key: 'worker-state', label: 'Worker：${running ? '运行中' : '已停止'}', disabled: true),
        MenuItem.separator(),
        MenuItem(key: 'open-console', label: '打开控制台'),
        for (final key in kPanelKeys) MenuItem(key: 'panel:$key', label: kPanelLabels[key]!),
        MenuItem(key: 'open-main', label: '打开 Harness 主窗口'),
        MenuItem.separator(),
        MenuItem(key: 'start', label: '启动 Worker', disabled: running),
        MenuItem(key: 'stop', label: '停止 Worker', disabled: !running),
        MenuItem.separator(),
        MenuItem(key: 'update', label: '检查更新'),
        // checkbox：系统原生勾选态；右键弹出前 _refreshMenu 保证与实际自启状态一致
        MenuItem.checkbox(key: 'autostart', label: '开机启动', checked: autostart),
        MenuItem.separator(),
        MenuItem(key: 'quit', label: '退出'),
      ],
    );
  }

  Future<void> _refreshMenu() async {
    if (_menuBuilding) return;
    _menuBuilding = true;
    try {
      final running = _container.read(workerStatusProvider).value?.running ?? false;
      await trayManager.setToolTip('DSH Pocket Worker — ${running ? '运行中' : '已停止'}');
      await trayManager.setContextMenu(_buildMenu());
    } catch (_) {
      // 无会话环境等场景托盘不可用，静默
    } finally {
      _menuBuilding = false;
    }
  }

  @override
  void onTrayIconMouseDown() {
    // 左键 = 控制台（管理是托盘的本职；主窗口从菜单或使用习惯进入）
    _container.read(consoleWindowServiceProvider).open(panel: 'status');
  }

  @override
  void onTrayIconRightMouseDown() async {
    // 弹出前强制刷新：checkbox（开机启动）等状态永远反映真实值
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
      case 'update':
        try {
          await _container.read(updaterServiceProvider).checkNow();
        } catch (_) {}
      case 'autostart':
        final notifier = _container.read(autostartEnabledProvider.notifier);
        final current = _container.read(autostartEnabledProvider).value ?? false;
        try {
          await notifier.set(!current);
        } catch (_) {}
        await _refreshMenu();
      case 'quit':
        await quitApp();
      default:
        // 管理面板项：panel:<key> → 控制台窗口对应面板
        final key = menuItem.key;
        if (key != null && key.startsWith('panel:')) {
          final panel = normalizePanel(key.substring('panel:'.length));
          await _container.read(consoleWindowServiceProvider).open(panel: panel);
        }
    }
  }

  Future<void> _runWorkerAction(WorkerAction action) async {
    try {
      await action(_container.read(workerServiceProvider), _container.read(settingsProvider));
    } catch (_) {
      // 托盘动作静默失败（控制台里有可见的错误展示）
    } finally {
      _container.invalidate(workerStatusProvider);
      _container.invalidate(pairingProvider);
    }
  }

  /// 真正退出：停止 worker（固定行为）后退出。
  /// windowManager.destroy = NSApp.terminate，控制台引擎随进程一起结束。
  Future<void> quitApp() async {
    try {
      await _container.read(workerServiceProvider).stop();
    } catch (_) {}
    await windowManager.destroy();
  }
}
