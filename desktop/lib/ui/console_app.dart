/// 控制台窗口（独立引擎）：shadcn UI 的管理面板集合。
///
/// 布局 = 左侧栏（状态/账号/配对/dsh 版本/日志）+ 右侧内容区。
/// 关闭窗口 = 隐藏（引擎保留，托盘再点秒开）；面板切换来源：
/// - 本窗口侧栏点击；
/// - 主引擎托盘 → WindowMethodChannel 'navigate'（main.dart 注册 handler）。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:window_manager/window_manager.dart';

import '../app_nav.dart';
import '../providers.dart';

/// 当前面板（控制台窗口侧栏选中项；跨窗口导航改写此值）。
class ConsolePanelNotifier extends Notifier<String> {
  @override
  String build() => 'status';

  /// 切换面板（未知键归一为 status；跨窗口导航也走这里）。
  void set(String? panel) => state = normalizePanel(panel);
}

final consolePanelProvider =
    NotifierProvider<ConsolePanelNotifier, String>(ConsolePanelNotifier.new);

class ConsoleApp extends ConsumerWidget {
  const ConsoleApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    const scheme = ShadZincColorScheme.light(primary: Color(0xFF4D6BFE));
    return ShadApp(
      title: 'DSH Pocket 控制台',
      debugShowCheckedModeBanner: false,
      theme: ShadThemeData(brightness: Brightness.light, colorScheme: scheme),
      darkTheme: ShadThemeData(
        brightness: Brightness.dark,
        colorScheme: const ShadZincColorScheme.dark(primary: Color(0xFF7A90FF)),
      ),
      themeMode: ThemeMode.system,
      home: const ConsoleShell(),
    );
  }
}

class ConsoleShell extends ConsumerStatefulWidget {
  const ConsoleShell({super.key});

  @override
  ConsumerState<ConsoleShell> createState() => _ConsoleShellState();
}

class _ConsoleShellState extends ConsumerState<ConsoleShell> with WindowListener {
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
    // 关闭 = 隐藏（引擎保留，托盘再点秒开）
    await windowManager.hide();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final current = ref.watch(consolePanelProvider);
    final running = ref.watch(workerStatusProvider).value?.running ?? false;

    return ColoredBox(
      color: theme.colorScheme.background,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Sidebar(current: current, running: running),
          const VerticalDivider(width: 1, thickness: 1),
          Expanded(
            child: KeyedSubtree(
              key: ValueKey(current),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                child: buildPanel(current),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 左侧栏：品牌 + 面板导航 + 底部 worker 状态。
class _Sidebar extends ConsumerWidget {
  const _Sidebar({required this.current, required this.running});

  final String current;
  final bool running;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ShadTheme.of(context);
    final appInfo = ref.watch(appInfoProvider);

    return SizedBox(
      width: 128,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('DSH Pocket', style: theme.textTheme.h4),
                Text('Worker 控制台', style: theme.textTheme.muted.copyWith(fontSize: 11)),
              ],
            ),
          ),
          const SizedBox(height: 6),
          for (final key in kPanelKeys)
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 2),
              child: _NavItem(
                icon: panelIcon(key),
                label: kPanelLabels[key]!,
                selected: current == key,
                onTap: () => ref.read(consolePanelProvider.notifier).set(key),
              ),
            ),
          const Spacer(),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: running ? const Color(0xFF34C759) : theme.colorScheme.destructive,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(running ? '运行中' : '已停止', style: theme.textTheme.small),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'v${appInfo.value?.version ?? '…'}',
                  style: theme.textTheme.muted.copyWith(fontSize: 10),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final scheme = theme.colorScheme;
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? scheme.secondary : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Icon(icon, size: 16, color: selected ? scheme.foreground : scheme.mutedForeground),
              const SizedBox(width: 8),
              Text(
                label,
                style: (selected ? theme.textTheme.p : theme.textTheme.muted)
                    .copyWith(fontSize: 13),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
