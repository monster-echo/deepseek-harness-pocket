/// DSH Pocket Worker 桌面端入口。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import 'app.dart';
import 'providers.dart';
import 'services/proc.dart';
import 'services/tray.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await windowManager.ensureInitialized();

  const options = WindowOptions(
    size: Size(480, 760),
    minimumSize: Size(440, 640),
    title: 'DSH Pocket Worker',
    titleBarStyle: TitleBarStyle.normal,
  );

  final container = ProviderContainer();

  await windowManager.waitUntilReadyToShow(options, () async {
    await windowManager.setPreventClose(true); // 关闭 = 收进托盘
    await windowManager.show();
    await windowManager.focus();
  });

  runApp(UncontrolledProviderScope(container: container, child: const DshApp()));

  unawaited(_bootstrap(container));
}

/// 首帧后异步引导：托盘、更新器、按需拉起 worker。
Future<void> _bootstrap(ProviderContainer container) async {
  try {
    await TrayController(container).init();
  } catch (_) {
    // 托盘失败不阻塞（无会话环境等）
  }
  try {
    await container.read(updaterServiceProvider).init();
  } catch (_) {}

  final settings = container.read(settingsProvider);
  if (settings.autoStartWorker) {
    await Future<void>.delayed(const Duration(milliseconds: 800));
    try {
      final st = await container.read(workerServiceProvider).status();
      if (!st.running) {
        await container.read(workerServiceProvider).start(settings);
      }
    } on SidecarMissingException {
      // UI 顶部有横幅
    } catch (_) {}
    container.invalidate(workerStatusProvider);
    container.invalidate(pairingProvider);
  }
}
