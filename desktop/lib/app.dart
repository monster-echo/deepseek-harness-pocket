/// 应用外壳：主题 + 底部导航 + sidecar 缺失横幅 + 关闭到托盘。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:window_manager/window_manager.dart';

import 'providers.dart';
import 'ui/logs_page.dart';
import 'ui/status_page.dart';
import 'ui/versions_page.dart';

class DshApp extends ConsumerStatefulWidget {
  const DshApp({super.key});

  @override
  ConsumerState<DshApp> createState() => _DshAppState();
}

class _DshAppState extends ConsumerState<DshApp> with WindowListener {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
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
            Expanded(
              child: IndexedStack(
                index: _index,
                children: const [
                  StatusPage(),
                  VersionsPage(),
                  LogsPage(),
                ],
              ),
            ),
          ],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.monitor_heart_outlined), selectedIcon: Icon(Icons.monitor_heart), label: '状态'),
            NavigationDestination(icon: Icon(Icons.layers_outlined), selectedIcon: Icon(Icons.layers), label: '版本'),
            NavigationDestination(icon: Icon(Icons.article_outlined), selectedIcon: Icon(Icons.article), label: '日志'),
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
          '内置 node sidecar 缺失，Worker 功能不可用',
          style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer, fontSize: 13),
        ),
        subtitle: Text(
          '开发态先运行 desktop/tool/build-sidecar.sh；正式安装包不应出现此提示',
          style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer, fontSize: 11),
        ),
      ),
    );
  }
}
