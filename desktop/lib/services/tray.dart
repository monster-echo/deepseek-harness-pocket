/// 托盘常驻：状态行 + 菜单（打开/启动/停止/检查更新/开机启动/退出）。
///
/// 菜单与 tooltip 随 worker 运行态刷新（只在翻转时重建，不随轮询 tick 抖动）；
/// 退出 = 停止 worker 再退出（固定行为）；关窗只是收托盘（app.dart）。
library;

import 'dart:io' show Platform;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

import '../models.dart';
import '../providers.dart';
import 'worker.dart';

typedef WorkerAction = Future<void> Function(WorkerService svc, AppSettings settings);

class TrayController with TrayListener {
  TrayController(this._container);

  final ProviderContainer _container;
  bool _inited = false;

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
    // 运行态翻转 / 自启开关变化 → 重建菜单（workerRunningProvider 值不变时不通知）
    _container.listen<AsyncValue<WorkerStatus>>(
      workerStatusProvider,
      (_, _) => _refreshMenu(),
    );
    _container.listen<AsyncValue<bool>>(
      autostartEnabledProvider,
      (_, _) => _refreshMenu(),
    );
  }

  Future<void> _refreshMenu() async {
    final running = _container.read(workerStatusProvider).value?.running ?? false;
    final autostart = _container.read(autostartEnabledProvider).value ?? false;
    await trayManager.setToolTip('DSH Pocket Worker — ${running ? '运行中' : '已停止'}');
    await trayManager.setContextMenu(
      Menu(
        items: [
          MenuItem(key: 'status', label: 'Worker：${running ? '运行中' : '已停止'}', disabled: true),
          MenuItem.separator(),
          MenuItem(key: 'open', label: '打开面板'),
          MenuItem(key: 'start', label: '启动 Worker', disabled: running),
          MenuItem(key: 'stop', label: '停止 Worker', disabled: !running),
          MenuItem.separator(),
          MenuItem(key: 'update', label: '检查更新'),
          MenuItem.checkbox(key: 'autostart', label: '开机启动', checked: autostart),
          MenuItem.separator(),
          MenuItem(key: 'quit', label: '退出'),
        ],
      ),
    );
  }

  @override
  void onTrayIconMouseDown() {
    windowManager.show();
  }

  @override
  void onTrayIconRightMouseDown() {
    trayManager.popUpContextMenu();
  }

  @override
  void onTrayMenuItemClick(MenuItem menuItem) async {
    switch (menuItem.key) {
      case 'open':
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
    }
  }

  Future<void> _runWorkerAction(WorkerAction action) async {
    try {
      await action(_container.read(workerServiceProvider), _container.read(settingsProvider));
    } catch (_) {
      // 托盘动作静默失败（面板里有可见的错误展示）
    } finally {
      _container.invalidate(workerStatusProvider);
      _container.invalidate(pairingProvider);
    }
  }

  /// 真正退出：停止 worker（固定行为）后退出。
  Future<void> quitApp() async {
    try {
      await _container.read(workerServiceProvider).stop();
    } catch (_) {}
    await windowManager.destroy();
  }
}
