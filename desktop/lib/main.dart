/// DSH Pocket 桌面端入口（双窗口架构）。
///
/// - 主窗口引擎：DeepSeek Harness 网页壳 + 托盘 + 自启/更新/worker 引导。
/// - 控制台引擎（desktop_multi_window 子窗口）：全部管理面板（shadcn UI），
///   经 WindowMethodChannel 接收主引擎托盘的导航指令。
library;

import 'dart:async';
import 'dart:io' show Platform;

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import 'providers.dart';
import 'services/notify.dart';
import 'services/proc.dart';
import 'services/tray.dart';
import 'services/worker.dart';
import 'ui/console_app.dart';
import 'ui/main_window.dart';

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  // desktop_multi_window 子窗口入口：main 会被新引擎以
  // ['multi_window', windowId, argumentsJson] 重新执行
  if (args.isNotEmpty && args[0] == 'multi_window') {
    await _runConsoleEngine();
    return;
  }
  await _runMainEngine();
}

// ---------- 主窗口引擎 ----------

Future<void> _runMainEngine() async {
  await windowManager.ensureInitialized();

  const options = WindowOptions(
    size: Size(1024, 720),
    minimumSize: Size(640, 480),
    title: 'DeepSeek Harness — DSH Pocket',
    titleBarStyle: TitleBarStyle.normal,
  );

  final container = ProviderContainer();

  await windowManager.waitUntilReadyToShow(options, () async {
    await windowManager.setPreventClose(true); // 关闭 = 收进托盘
    await windowManager.show();
    await windowManager.focus();
  });

  runApp(UncontrolledProviderScope(container: container, child: const MainWindowApp()));

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
    // 自动发现新版本：启动后台检查一次 + 每日定时；
    // 发现即发桌面通知，点击通知打开控制台状态页（检查更新入口在那里）
    container.read(updaterServiceProvider).onVersionFound = (version) {
      DesktopNotify.versionFound(version, onClick: () {
        container.read(consoleWindowServiceProvider).open(panel: 'status');
      });
    };
    await container.read(updaterServiceProvider).init();
  } catch (_) {}
  if (Platform.environment['DSH_DEBUG_NOTIFY'] == '1') {
    // 走与生产完全相同的通知链路（仅版本号是假的），用于验证通知通道
    await DesktopNotify.versionFound('0.1.9', onClick: () {
      container.read(consoleWindowServiceProvider).open(panel: 'status');
    });
  }

  // 固定逻辑：应用启动即确保 worker 在运行（不提供开关）
  final settings = container.read(settingsProvider);
  await Future<void>.delayed(const Duration(milliseconds: 800));
  final bootError = container.read(workerBootErrorProvider.notifier);
  try {
    final st =
        await container.read(workerServiceProvider).status(fallbackPort: settings.port);
    if (!st.running) {
      try {
        await container.read(workerServiceProvider).start(settings);
        bootError.set(null);
      } on WorkerActionException catch (e) {
        // 起不来的根因只在异常消息里（pnpm 路径/凭证/端口…），吞掉就是「点了没反应」
        bootError.set(e.message);
        debugPrint('[bootstrap] worker auto-start failed: ${e.message}');
      }
    }
  } on SidecarMissingException {
    // 控制台顶部有横幅提示
  } catch (e) {
    bootError.set('$e');
    debugPrint('[bootstrap] worker auto-start failed: $e');
  }
  container.invalidate(workerStatusProvider);
}

// ---------- 控制台引擎 ----------

Future<void> _runConsoleEngine() async {
  await windowManager.ensureInitialized();

  const options = WindowOptions(
    size: Size(480, 720),
    minimumSize: Size(420, 600),
    title: 'DSH Pocket 控制台',
    titleBarStyle: TitleBarStyle.normal,
  );

  final container = ProviderContainer();

  await windowManager.waitUntilReadyToShow(options, () async {
    // 控制台关闭 = 隐藏（保留引擎，托盘再点秒开）；随进程退出销毁
    await windowManager.setPreventClose(true);
    await windowManager.show();
    await windowManager.focus();
  });

  runApp(UncontrolledProviderScope(container: container, child: const ConsoleApp()));

  // 跨窗口导航：主引擎托盘 → 切换面板
  unawaited(_listenConsoleNavigation(container));
}

Future<void> _listenConsoleNavigation(ProviderContainer container) async {
  try {
    final controller = await WindowController.fromCurrentEngine();
    await controller.setWindowMethodHandler((call) async {
      if (call.method == 'navigate') {
        final args = call.arguments;
        final panel = args is Map && args['panel'] is String ? args['panel'] as String : null;
        // 切到目标面板（托盘点「账号/配对/…」时对应内容区直接呈现）
        container.read(consolePanelProvider.notifier).set(panel);
      }
      return null;
    });
  } catch (e) {
    debugPrint('[console] navigation handler failed: $e');
  }
}
