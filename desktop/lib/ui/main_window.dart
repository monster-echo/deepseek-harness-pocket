/// 主窗口：DeepSeek Harness 网页的壳。
///
/// 双窗口架构下主窗口只做一件事：全屏内嵌 dsh 自带 Web GUI（健康态零 chrome）。
/// Worker 未就绪时显示引导面（启动/打开控制台），不再承载任何管理面板——
/// 状态/账号/配对/版本/日志全部在独立控制台窗口（托盘菜单进入）。
///
/// 生命周期约定：dsh 重启 → supervisor 先清 webUrl 再等新 URL →
/// 状态轮询让本页短暂回到引导面、拿到新 URL 后按 URL 为 key 重建 WebView。
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../providers.dart';
import '../services/proc.dart';
import '../services/worker.dart';

class MainWindowApp extends StatelessWidget {
  const MainWindowApp({super.key});

  @override
  Widget build(BuildContext context) {
    const scheme = ShadZincColorScheme.light(primary: Color(0xFF4D6BFE));
    return ShadApp(
      title: 'DeepSeek Harness — DSH Pocket',
      debugShowCheckedModeBanner: false,
      theme: ShadThemeData(
        brightness: Brightness.light,
        colorScheme: scheme,
      ),
      darkTheme: ShadThemeData(
        brightness: Brightness.dark,
        colorScheme: const ShadZincColorScheme.dark(primary: Color(0xFF7A90FF)),
      ),
      themeMode: ThemeMode.system,
      home: const ConsolePage(),
    );
  }
}

class ConsolePage extends ConsumerStatefulWidget {
  const ConsolePage({super.key});

  @override
  ConsumerState<ConsolePage> createState() => _ConsolePageState();
}

class _ConsolePageState extends ConsumerState<ConsolePage> {
  WebViewController? _controller;
  String? _loadedUrl;

  /// URL 变了就重建控制器（dsh 重启后 token 必变，旧页面不可复用）。
  void _ensureController(String webUrl) {
    if (_loadedUrl == webUrl && _controller != null) return;
    _loadedUrl = webUrl;
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (request) async {
          // 只放行 loopback：外部链接（文档等）转交系统浏览器，token 不出本机
          final uri = Uri.tryParse(request.url);
          final host = uri?.host ?? '';
          final isLoopback = host == '127.0.0.1' || host == 'localhost' || host == '::1' || host == '[::1]';
          if (isLoopback) return NavigationDecision.navigate;
          await openInBrowser(request.url);
          return NavigationDecision.prevent;
        },
      ))
      ..loadRequest(Uri.parse(webUrl));
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(workerStatusProvider);
    final st = status.value;
    final webUrl = st?.run?.webUrl ?? '';

    // URL 需要变化时在 build 里同步重建控制器：_ensureController 以 URL 幂等
    if (webUrl.isNotEmpty && !Platform.isWindows) _ensureController(webUrl);

    if (webUrl.isEmpty) {
      return _GuidePage(
        running: st?.running ?? false,
        reachable: st?.reachable ?? false,
        bootError: ref.watch(workerBootErrorProvider),
      );
    }
    if (Platform.isWindows) return const _WindowsFallback();
    return KeyedSubtree(key: ValueKey(webUrl), child: WebViewWidget(controller: _controller!));
  }
}

/// 引导面：Harness 控制台不可用时的接管 UI。
class _GuidePage extends ConsumerWidget {
  const _GuidePage({required this.running, required this.reachable, this.bootError});

  final bool running;
  final bool reachable;

  /// 最近一次自动/手动拉起失败的原因；null 或已在运行时不展示。
  final String? bootError;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ShadTheme.of(context);
    final st = ref.watch(workerStatusProvider).value;
    final webUrl = st?.run?.webUrl ?? '';

    return ColoredBox(
      color: theme.colorScheme.background,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(running ? Icons.hourglass_top : Icons.power_settings_new, size: 40, color: theme.colorScheme.mutedForeground),
            const SizedBox(height: 12),
            Text(running ? 'dsh 仍在启动中' : '服务未运行', style: theme.textTheme.h3),
            const SizedBox(height: 6),
            Text(
              running ? '控制台就绪后本页会自动载入（约 10 秒）' : '启动后即可在本窗口操作 DeepSeek Harness',
              textAlign: TextAlign.center,
              style: theme.textTheme.muted,
            ),
            if (!running && bootError != null) ...[
              const SizedBox(height: 10),
              Text(
                '启动失败：$bootError',
                textAlign: TextAlign.center,
                style: theme.textTheme.muted.copyWith(color: theme.colorScheme.destructive),
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            const SizedBox(height: 20),
            if (!running)
              ShadButton(
                onPressed: reachable
                    ? () async {
                        try {
                          await ref.read(workerServiceProvider).start(ref.read(settingsProvider));
                          ref.read(workerBootErrorProvider.notifier).set(null);
                        } on WorkerActionException catch (e) {
                          ref.read(workerBootErrorProvider.notifier).set(e.message);
                        } catch (e) {
                          ref.read(workerBootErrorProvider.notifier).set('$e');
                        }
                        ref.invalidate(workerStatusProvider);
                      }
                    : null,
                leading: const Icon(Icons.play_arrow, size: 16),
                child: const Text('启动'),
              )
            else
              ShadButton.outline(
                onPressed: () => ref.invalidate(workerStatusProvider),
                leading: const Icon(Icons.refresh, size: 16),
                child: const Text('重新检查'),
              ),
            const SizedBox(height: 10),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                ShadButton.ghost(
                  onPressed: () => ref.read(consoleWindowServiceProvider).open(panel: 'status'),
                  child: const Text('打开控制台'),
                ),
                if (!Platform.isWindows && webUrl.isNotEmpty) ...[
                  const SizedBox(width: 6),
                  ShadButton.ghost(
                    onPressed: () => openInBrowser(webUrl),
                    child: const Text('在浏览器打开'),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Windows：webview_flutter 无实现，控制台外开浏览器兜底。
class _WindowsFallback extends ConsumerWidget {
  const _WindowsFallback();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ShadTheme.of(context);
    final webUrl = ref.watch(workerStatusProvider).value?.run?.webUrl ?? '';
    return ColoredBox(
      color: theme.colorScheme.background,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.web_asset_off, size: 40, color: theme.colorScheme.mutedForeground),
            const SizedBox(height: 12),
            Text('Windows 端内嵌控制台暂未支持', style: theme.textTheme.h3),
            const SizedBox(height: 6),
            Text(
              webUrl.isEmpty ? '启动服务后可复制控制台地址，在浏览器中使用完整 Harness' : '复制控制台地址，在浏览器中使用完整 Harness',
              textAlign: TextAlign.center,
              style: theme.textTheme.muted,
            ),
            const SizedBox(height: 16),
            if (webUrl.isNotEmpty)
              ShadButton(
                onPressed: () => openInBrowser(webUrl),
                leading: const Icon(Icons.open_in_new, size: 16),
                child: const Text('在浏览器打开控制台'),
              ),
          ],
        ),
      ),
    );
  }
}
