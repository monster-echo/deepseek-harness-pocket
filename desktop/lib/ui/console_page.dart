/// 控制台页（应用本体）：内嵌 dsh 自带 Web GUI（companion 进程 127.0.0.1 端口），
/// URL 来自 run.json 的 webUrl（supervisor 从 `dsh web:` 行捕获，含本轮 ?token=）。
///
/// 窗口内零 chrome：健康态 = 纯 harness 界面；管理入口全部在托盘菜单。
/// 异常态才由本页的引导面接管（启动/状态/配对入口）。
///
/// 生命周期约定：dsh 重启 → supervisor 先清 webUrl 再等新 URL →
/// 状态轮询让本页短暂回到引导面、拿到新 URL 后按 URL 为 key 重建 WebView，
/// 因此「token 失效 → 401」的自愈路径就是常规刷新，无需解析响应码。
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../app_nav.dart';
import '../providers.dart';
import '../services/proc.dart';

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

    if (webUrl.isEmpty) return _ConsoleGuide(running: st?.running ?? false, reachable: st?.reachable ?? false);
    if (Platform.isWindows) return const _WindowsFallback();
    return KeyedSubtree(key: ValueKey(webUrl), child: WebViewWidget(controller: _controller!));
  }
}

/// 引导面：控制台不可用时的接管 UI（也是新用户的第一屏）。
class _ConsoleGuide extends ConsumerWidget {
  const _ConsoleGuide({required this.running, required this.reachable});

  final bool running;
  final bool reachable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final st = ref.watch(workerStatusProvider).value;
    final webUrl = st?.run?.webUrl ?? '';

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(running ? Icons.hourglass_top : Icons.power_settings_new, size: 40, color: theme.hintColor),
          const SizedBox(height: 12),
          Text(
            running ? 'dsh 仍在启动中' : 'Worker 未运行',
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Text(
            running ? '控制台就绪后本页会自动载入（约 10 秒）' : '启动后即可在本窗口操作 DeepSeek Harness',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
          ),
          const SizedBox(height: 20),
          if (!running)
            FilledButton.icon(
              onPressed: reachable
                  ? () async {
                      try {
                        await ref.read(workerServiceProvider).start(ref.read(settingsProvider));
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context)
                            ..hideCurrentSnackBar()
                            ..showSnackBar(SnackBar(content: Text('失败：$e')));
                        }
                      }
                      ref.invalidate(workerStatusProvider);
                    }
                  : null,
              icon: const Icon(Icons.play_arrow),
              label: const Text('启动 Worker'),
            )
          else
            OutlinedButton.icon(
              onPressed: () => ref.invalidate(workerStatusProvider),
              icon: const Icon(Icons.refresh),
              label: const Text('重新检查'),
            ),
          const SizedBox(height: 8),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextButton(onPressed: () => AppNav.pushPanel('status'), child: const Text('状态')),
              TextButton(onPressed: () => AppNav.pushPanel('pairing'), child: const Text('配对')),
              TextButton(onPressed: () => AppNav.pushPanel('logs'), child: const Text('日志')),
            ],
          ),
          if (!Platform.isWindows && webUrl.isNotEmpty) ...[
            const SizedBox(height: 4),
            TextButton(
              onPressed: () => openInBrowser(webUrl),
              child: const Text('在浏览器打开控制台'),
            ),
          ],
        ],
      ),
    );
  }
}

/// Windows：webview_flutter 无实现，控制台外开浏览器兜底。
class _WindowsFallback extends ConsumerWidget {
  const _WindowsFallback();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final webUrl = ref.watch(workerStatusProvider).value?.run?.webUrl ?? '';
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.web_asset_off, size: 40, color: theme.hintColor),
          const SizedBox(height: 12),
          Text('Windows 端内嵌控制台暂未支持', style: theme.textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            webUrl.isEmpty ? '启动 Worker 后可复制控制台地址，在浏览器中使用完整 Harness' : '复制控制台地址，在浏览器中使用完整 Harness',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
          ),
          const SizedBox(height: 16),
          if (webUrl.isNotEmpty)
            FilledButton.icon(
              onPressed: () => openInBrowser(webUrl),
              icon: const Icon(Icons.open_in_new),
              label: const Text('在浏览器打开控制台'),
            ),
        ],
      ),
    );
  }
}
