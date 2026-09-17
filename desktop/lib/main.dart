/// DSH Pocket 桌面端入口（双窗口架构）。
///
/// - 主窗口引擎：DeepSeek Harness 网页壳 + 托盘 + 自启/更新/worker 引导。
/// - 控制台引擎（desktop_multi_window 子窗口）：全部管理面板（shadcn UI），
///   经 WindowMethodChannel 接收主引擎托盘的导航指令。
library;

import 'dart:async';
import 'dart:io' show Platform, exit, stdout;

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
  // 调试开关：探测开机自启原生通道（打印结果后退出）。
  // launch_at_startup 在 macOS 上没有自带原生实现，接入前这里会抛
  // MissingPluginException —— 这条探针用来快速确认通道真的接上了。
  if (Platform.environment['DSH_DEBUG_AUTOSTART'] != null) {
    await _probeAutostart(container);
    exit(0);
  }
  if (Platform.environment['DSH_DEBUG_CONSOLE'] != null) {
    await _probeConsole(container);
    if (Platform.environment['DSH_DEBUG_CONSOLE'] == 'stay') return;
  }
  try {
    await TrayController(container).init();
  } catch (_) {
    // 托盘失败不阻塞（无会话环境等）
  }
  // 控制台引擎预热：后台提前拉起（隐藏），托盘点击时秒开。
  // 放在托盘/更新器之后，不与启动首屏抢资源。
  unawaited(
    Future<void>.delayed(const Duration(milliseconds: 400)).then((_) async {
      try {
        await container.read(consoleWindowServiceProvider).prewarm();
      } catch (_) {}
    }),
  );
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

/// 调试探针：读取/翻转/复位「开机启动」，把每一步结果打到 stdout。
/// 以 `DSH_DEBUG_AUTOSTART=1` 启动应用即执行，随后退出（不进入正常引导）。
/// 用途：确认 macOS 原生通道（AutostartChannel）真的可用——未接入时这里会是
/// MissingPluginException，表现就是托盘勾选框永远空着。
///
/// `=1` 只读（默认，干净）；`=toggle` 额外做一轮 enable→disable，
/// 注意那会在系统后台项数据库里留下一条 disabled 记录（SMAppService 的正常行为）。
Future<void> _probeAutostart(ProviderContainer container) async {
  final svc = container.read(autostartServiceProvider);
  final mode = Platform.environment['DSH_DEBUG_AUTOSTART'] ?? '1';
  try {
    await svc.setup();
    stdout.writeln('[probe] channel=launch_at_startup isEnabled=${await svc.isEnabled()}');
    if (mode == 'toggle') {
      await svc.enable();
      stdout.writeln('[probe] after enable isEnabled=${await svc.isEnabled()}');
      await svc.disable();
      stdout.writeln('[probe] after disable isEnabled=${await svc.isEnabled()}');
    }
    stdout.writeln('[probe] RESULT=OK');
  } catch (e) {
    stdout.writeln('[probe] RESULT=FAILED $e');
  }
  await stdout.flush();
}

/// 调试探针：控制台窗口打开耗时（`DSH_DEBUG_CONSOLE=cold|warm|stay`）。
///
/// - cold：不预热直接 open —— 复现改造前的「点一下要等一两秒」；
/// - warm：先 prewarm（应用启动时就是这么做的），隔几秒再 open —— 即真实点击路径；
/// - stay：同 warm，但打开账号页后不退不退出（人工/截图观察界面用）。
/// 前两者打印毫秒数，用来证明控制台是「秒开」。
Future<void> _probeConsole(ProviderContainer container) async {
  final svc = container.read(consoleWindowServiceProvider);
  final mode = Platform.environment['DSH_DEBUG_CONSOLE'] ?? 'warm';
  try {
    if (mode != 'cold') {
      final t0 = DateTime.now();
      await svc.prewarm();
      stdout.writeln('[probe] prewarm=${DateTime.now().difference(t0).inMilliseconds}ms');
      // 模拟用户过一会儿才点托盘：此时引擎已就绪
      await Future<void>.delayed(const Duration(milliseconds: 3000));
    }
    final t1 = DateTime.now();
    await svc.open(panel: mode == 'stay' ? 'account' : 'status');
    final opened = DateTime.now().difference(t1).inMilliseconds;
    stdout.writeln('[probe] mode=$mode open=${opened}ms');

    final t2 = DateTime.now();
    await svc.open(panel: 'account');
    stdout.writeln('[probe] reopen=${DateTime.now().difference(t2).inMilliseconds}ms');
    stdout.writeln('[probe] RESULT=OK');
  } catch (e) {
    stdout.writeln('[probe] RESULT=FAILED $e');
  }
  await stdout.flush();
  if (mode == 'stay') return; // 保持运行，等人工观察
  exit(0);
}

// ---------- 控制台引擎 ----------

Future<void> _runConsoleEngine() async {
  await windowManager.ensureInitialized();

  const options = WindowOptions(
    size: Size(780, 840),
    minimumSize: Size(600, 560),
    title: 'DSH Pocket 控制台',
    titleBarStyle: TitleBarStyle.normal,
  );

  final container = ProviderContainer();

  // 方法通道尽早注册：主引擎用 ping 探活，早注册 = 打开更快
  await _listenConsoleNavigation(container);

  await windowManager.waitUntilReadyToShow(options, () async {
    // 关闭 = 隐藏（引擎保留，托盘再点秒开）；随进程退出销毁。
    // 注意：这里不要 show —— 显示时机由主引擎控制（预热时窗口必须保持隐藏，
    // 否则启动瞬间会闪一下控制台）。
    await windowManager.setPreventClose(true);
  });

  runApp(UncontrolledProviderScope(container: container, child: const ConsoleApp()));
}

Future<void> _listenConsoleNavigation(ProviderContainer container) async {
  try {
    final controller = await WindowController.fromCurrentEngine();
    await controller.setWindowMethodHandler((call) async {
      switch (call.method) {
        case 'ping':
          // 探活：主引擎据此判断本引擎的通道已就绪（替代固定延时）
          return true;
        case 'navigate':
          final args = call.arguments;
          final panel = args is Map && args['panel'] is String ? args['panel'] as String : null;
          // 切到目标面板（托盘点「账号/dsh 版本/…」时对应内容区直接呈现）
          container.read(consolePanelProvider.notifier).set(panel);
          return null;
      }
      return null;
    });
  } catch (e) {
    debugPrint('[console] navigation handler failed: $e');
  }
}
