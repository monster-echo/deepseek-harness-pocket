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
import '../models.dart';
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
  /// 拖拽中的临时宽度（松手后写入设置持久化）。
  double? _dragWidth;

  /// 折叠态图标栏宽度。
  static const _collapsedWidth = 56.0;

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

  void _commitWidth(double width) {
    final settings = ref.read(settingsProvider);
    if (settings.consoleSidebarWidth == width) return;
    ref.read(settingsProvider.notifier).update(settings.copyWith(consoleSidebarWidth: width));
  }

  void _toggleCollapsed() {
    final settings = ref.read(settingsProvider);
    ref.read(settingsProvider.notifier).update(
          settings.copyWith(consoleSidebarCollapsed: !settings.consoleSidebarCollapsed),
        );
  }

  /// 拖拽调宽：折叠态下拖动自动展开并从折叠宽度起步。
  void _onResize(double delta) {
    final settings = ref.read(settingsProvider);
    final base = _dragWidth ?? (settings.consoleSidebarCollapsed
        ? _collapsedWidth
        : settings.consoleSidebarWidth);
    final next = (base + delta).clamp(
      AppSettings.consoleSidebarMinWidth,
      AppSettings.consoleSidebarMaxWidth,
    );
    setState(() => _dragWidth = next);
    if (settings.consoleSidebarCollapsed) {
      ref.read(settingsProvider.notifier).update(settings.copyWith(consoleSidebarCollapsed: false));
    }
  }

  void _endResize() {
    final width = _dragWidth;
    setState(() => _dragWidth = null);
    if (width != null) _commitWidth(width);
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final current = ref.watch(consolePanelProvider);
    final running = ref.watch(workerStatusProvider).value?.running ?? false;
    final settings = ref.watch(settingsProvider);
    final collapsed = settings.consoleSidebarCollapsed && _dragWidth == null;
    final width = collapsed ? _collapsedWidth : (_dragWidth ?? settings.consoleSidebarWidth);

    return ColoredBox(
      color: theme.colorScheme.background,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: width,
            child: _Sidebar(
              current: current,
              running: running,
              collapsed: collapsed,
              onToggleCollapsed: _toggleCollapsed,
            ),
          ),
          // 拖拽手柄：双击切换折叠；宽度持久化到 desktop-settings.json
          _ResizeHandle(
            onDrag: _onResize,
            onDragEnd: _endResize,
            onDoubleTap: _toggleCollapsed,
          ),
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

/// 侧栏与内容区之间的拖拽分隔条（视觉 1px、命中区 7px）。
class _ResizeHandle extends StatefulWidget {
  const _ResizeHandle({
    required this.onDrag,
    required this.onDragEnd,
    required this.onDoubleTap,
  });

  final void Function(double delta) onDrag;
  final VoidCallback onDragEnd;
  final VoidCallback onDoubleTap;

  @override
  State<_ResizeHandle> createState() => _ResizeHandleState();
}

class _ResizeHandleState extends State<_ResizeHandle> {
  bool _hovering = false;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final line = _hovering ? theme.colorScheme.primary : theme.colorScheme.border;
    return MouseRegion(
      cursor: SystemMouseCursors.resizeLeftRight,
      onEnter: (_) => setState(() => _hovering = true),
      onExit: (_) => setState(() => _hovering = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onHorizontalDragUpdate: (details) => widget.onDrag(details.delta.dx),
        onHorizontalDragEnd: (_) => widget.onDragEnd(),
        onDoubleTap: widget.onDoubleTap,
        child: SizedBox(
          width: 7,
          child: Center(
            child: Container(width: 1, color: line),
          ),
        ),
      ),
    );
  }
}

/// 左侧栏：品牌 + 面板导航 + 底部 worker 状态。
/// [collapsed] = 只留图标（带 tooltip），把宽度让给内容区。
class _Sidebar extends ConsumerWidget {
  const _Sidebar({
    required this.current,
    required this.running,
    required this.collapsed,
    required this.onToggleCollapsed,
  });

  final String current;
  final bool running;
  final bool collapsed;
  final VoidCallback onToggleCollapsed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ShadTheme.of(context);
    final appInfo = ref.watch(appInfoProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(collapsed ? 8 : 14, 14, collapsed ? 8 : 14, 8),
          child: collapsed
              ? Center(
                  child: ShadButton.ghost(
                    height: 26,
                    width: 26,
                    leading: const Icon(Icons.chevron_right, size: 16),
                    onPressed: onToggleCollapsed,
                  ),
                )
              : Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('DSH Pocket', style: theme.textTheme.h4),
                          Text('控制台', style: theme.textTheme.muted.copyWith(fontSize: 11)),
                        ],
                      ),
                    ),
                    ShadButton.ghost(
                      height: 26,
                      width: 26,
                      leading: const Icon(Icons.chevron_left, size: 16),
                      onPressed: onToggleCollapsed,
                    ),
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
              collapsed: collapsed,
              onTap: () => ref.read(consolePanelProvider.notifier).set(key),
            ),
          ),
        const Spacer(),
        Padding(
          padding: EdgeInsets.all(collapsed ? 8 : 12),
          child: collapsed
              ? Tooltip(
                  message: running ? '运行中' : '已停止',
                  child: Center(
                    child: Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: running ? const Color(0xFF34C759) : theme.colorScheme.destructive,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                )
              : Column(
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
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
    this.collapsed = false,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool collapsed;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final scheme = theme.colorScheme;
    final content = Container(
      padding: EdgeInsets.symmetric(horizontal: collapsed ? 0 : 10, vertical: 8),
      decoration: BoxDecoration(
        color: selected ? scheme.secondary : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisAlignment: collapsed ? MainAxisAlignment.center : MainAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: selected ? scheme.foreground : scheme.mutedForeground),
          if (!collapsed) ...[
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: (selected ? theme.textTheme.p : theme.textTheme.muted)
                    .copyWith(fontSize: 13),
              ),
            ),
          ],
        ],
      ),
    );
    return Semantics(
      button: true,
      selected: selected,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: collapsed ? Tooltip(message: label, child: content) : content,
      ),
    );
  }
}
