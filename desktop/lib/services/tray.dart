/// 托盘常驻：图标 + 菜单（打开/启动/停止/退出）。
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
    await trayManager.setToolTip('DSH Pocket Worker');
    await trayManager.setContextMenu(
      Menu(
        items: [
          MenuItem(key: 'open', label: '打开面板'),
          MenuItem.separator(),
          MenuItem(key: 'start', label: '启动 Worker'),
          MenuItem(key: 'stop', label: '停止 Worker'),
          MenuItem.separator(),
          MenuItem(key: 'quit', label: '退出'),
        ],
      ),
    );
    trayManager.addListener(this);
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

  /// 真正退出：按设置决定是否连带停 worker。
  Future<void> quitApp() async {
    final s = _container.read(settingsProvider);
    if (s.stopWorkerOnExit) {
      try {
        await _container.read(workerServiceProvider).stop();
      } catch (_) {}
    }
    await windowManager.destroy();
  }
}
