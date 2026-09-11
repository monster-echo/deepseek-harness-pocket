/// 应用外壳：控制台即应用体 + sidecar 缺失横幅 + 关闭到托盘。
///
/// 窗口内没有任何管理 chrome：健康态就是纯 DeepSeek Harness Web UI，
/// 状态/配对/版本/日志全部走托盘菜单（services/tray.dart）以路由推入。
library;

import 'dart:io';

import 'package:flutter/foundation.dart' show kDebugMode, kReleaseMode;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import 'app_nav.dart';
import 'providers.dart';
import 'ui/console_page.dart';

class DshApp extends ConsumerStatefulWidget {
  const DshApp({super.key});

  @override
  ConsumerState<DshApp> createState() => _DshAppState();
}

class _DshAppState extends ConsumerState<DshApp> with WindowListener {
  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
    if (kDebugMode) {
      // 调试辅助：DSH_DEBUG_ROUTE=status|pairing|versions|logs 启动即打开对应面板
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final route = Platform.environment['DSH_DEBUG_ROUTE'];
        if (route != null && route.isNotEmpty) AppNav.pushPanel(route);
      });
    }
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    super.dispose();
  }

  @override
  void onWindowClose() async {
    // 关闭窗口 = 隐藏到托盘；真正退出走托盘菜单
    await windowManager.hide();
  }

  @override
  Widget build(BuildContext context) {
    final sidecarReady = ref.watch(sidecarReadyProvider);
    return MaterialApp(
      title: 'DSH Pocket Worker',
      debugShowCheckedModeBanner: false,
      navigatorKey: AppNav.navigatorKey,
      navigatorObservers: [AppNav.observer],
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF4D6BFE)),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4D6BFE),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: Scaffold(
        body: Column(
          children: [
            if (!sidecarReady) const _SidecarBanner(),
            const Expanded(child: ConsolePage()),
          ],
        ),
      ),
    );
  }
}

class _SidecarBanner extends StatelessWidget {
  const _SidecarBanner();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.errorContainer,
      child: ListTile(
        dense: true,
        leading: Icon(Icons.warning_amber_rounded, color: Theme.of(context).colorScheme.onErrorContainer),
        title: Text(
          '应用文件不完整，Worker 功能不可用',
          style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer, fontSize: 13),
        ),
        subtitle: Text(
          kReleaseMode
              ? '请重新安装 DSH Pocket Worker 后再试'
              : '开发态先运行 desktop/tool/build-sidecar.sh；正式安装包不应出现此提示',
          style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer, fontSize: 11),
        ),
      ),
    );
  }
}
