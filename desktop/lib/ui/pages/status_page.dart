/// 状态页：运行状态 + 启停控制 + Web 控制台地址（shadcn 版，控制台窗口内）。
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../providers.dart';
import '../../services/proc.dart';
import '../widgets.dart';

class StatusPage extends ConsumerStatefulWidget {
  const StatusPage({super.key});

  @override
  ConsumerState<StatusPage> createState() => _StatusPageState();
}

class _StatusPageState extends ConsumerState<StatusPage> {
  bool _busy = false;

  Future<void> _run(String okMsg, Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      if (mounted) showFeedback(context, ok: okMsg);
    } catch (e) {
      if (mounted) showFeedback(context, error: e);
    } finally {
      if (mounted) setState(() => _busy = false);
      ref.invalidate(workerStatusProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final statusAsync = ref.watch(workerStatusProvider);
    final settings = ref.watch(settingsProvider);
    final sidecarReady = ref.watch(sidecarReadyProvider);

    return ListView(
      children: [
        if (!sidecarReady) ...[
          const ShadAlert.destructive(
            icon: Icon(Icons.warning_amber_rounded),
            title: Text('应用文件不完整'),
            description: Text('Worker 功能不可用，请重新安装 DSH Pocket Worker 后再试'),
          ),
          const SizedBox(height: 4),
        ],
        SectionCard(
          title: 'Worker',
          trailing: _busy
              ? const SizedBox(
                  width: 16, height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : null,
          child: statusAsync.when(
            data: (st) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    StatusDot(ok: st.running, label: st.running ? '运行中' : '已停止', dim: !st.reachable),
                    const Spacer(),
                    if (st.run != null)
                      Text('pid ${st.run!.pid}', style: theme.textTheme.muted.copyWith(fontSize: 12)),
                  ],
                ),
                const SizedBox(height: 8),
                InfoRow('dsh 版本', st.run?.dshVersion ?? ''),
                InfoRow('运行时长', st.run?.uptimeLabel ?? '—'),
                InfoRow(
                  '名称',
                  st.run?.name.isNotEmpty == true
                      ? st.run!.name
                      : settings.workerName.isEmpty
                          ? '（hostname）'
                          : settings.workerName,
                ),
                _WebConsoleRow(webUrl: st.run?.webUrl ?? ''),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: ShadButton(
                        enabled: !_busy && !st.running,
                        onPressed: () => _run('已启动', () async {
                          final svc = ref.read(workerServiceProvider);
                          await svc.start(ref.read(settingsProvider));
                        }),
                        leading: const Icon(Icons.play_arrow, size: 15),
                        child: const Text('启动'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: ShadButton.outline(
                        enabled: !_busy && st.running,
                        onPressed: () => _run('已停止', () => ref.read(workerServiceProvider).stop()),
                        leading: const Icon(Icons.stop, size: 15),
                        child: const Text('停止'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: ShadButton.outline(
                        enabled: !_busy && st.running,
                        onPressed: () => _run(
                          '已重启',
                          () => ref.read(workerServiceProvider).restart(ref.read(settingsProvider)),
                        ),
                        leading: const Icon(Icons.refresh, size: 15),
                        child: const Text('重启'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            loading: () => const Center(
              child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()),
            ),
            error: (e, _) => Text('状态不可用：$e'),
          ),
        ),
        const _AppVersionFooter(),
      ],
    );
  }
}

/// Web 控制台行：显示不带 token 的地址；复制/打开携带完整已认证 URL（token 不上屏）。
class _WebConsoleRow extends StatelessWidget {
  const _WebConsoleRow({required this.webUrl});

  final String webUrl;

  /// 展示用：剥掉 query（token），保留 `http://127.0.0.1:3080`。
  static String _display(String url) {
    final i = url.indexOf('?');
    return i > 0 ? url.substring(0, i) : url;
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    if (webUrl.isEmpty) {
      return const InfoRow('Web 控制台', '');
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 84,
            child: Text('Web 控制台', style: theme.textTheme.muted.copyWith(fontSize: 12)),
          ),
          Expanded(child: Text(_display(webUrl), style: theme.textTheme.list)),
          ShadButton.ghost(
            height: 22,
            width: 26,
            leading: const Icon(Icons.copy, size: 14),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: webUrl));
              if (context.mounted) showFeedback(context, ok: '已复制 Web 控制台地址');
            },
          ),
          ShadButton.ghost(
            height: 22,
            width: 26,
            leading: const Icon(Icons.open_in_new, size: 14),
            onPressed: () => openInBrowser(webUrl),
          ),
        ],
      ),
    );
  }
}

class _AppVersionFooter extends ConsumerWidget {
  const _AppVersionFooter();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appInfo = ref.watch(appInfoProvider);
    final theme = ShadTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Center(
        child: Text(
          'DSH Pocket Worker v${appInfo.value?.version ?? '…'}',
          style: theme.textTheme.muted.copyWith(fontSize: 11),
        ),
      ),
    );
  }
}
