/// 状态页：运行状态 + 启停控制 + Web 控制台地址（配对已拆到 pairing_page）。
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import '../services/proc.dart';
import 'widgets.dart';

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
      if (mounted) showActionFeedback(context, ok: okMsg);
    } catch (e) {
      if (mounted) showActionFeedback(context, error: e);
    } finally {
      if (mounted) setState(() => _busy = false);
      ref.invalidate(workerStatusProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final statusAsync = ref.watch(workerStatusProvider);
    final settings = ref.watch(settingsProvider);

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: [
        SectionCard(
          title: 'Worker',
          trailing: _busy
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : null,
          child: statusAsync.when(
            data: (st) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    StatusDot(ok: st.running, label: st.running ? '运行中' : '已停止', dim: !st.reachable),
                    const Spacer(),
                    if (st.run != null) Text('pid ${st.run!.pid}', style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
                const SizedBox(height: 8),
                InfoRow('dsh 版本', st.run?.dshVersion ?? ''),
                InfoRow('运行时长', st.run?.uptimeLabel ?? '—'),
                InfoRow('名称', st.run?.name.isNotEmpty == true ? st.run!.name : settings.workerName.isEmpty ? '（hostname）' : settings.workerName),
                _WebConsoleRow(webUrl: st.run?.webUrl ?? ''),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _busy || st.running
                            ? null
                            : () => _run('已启动', () async {
                                  final svc = ref.read(workerServiceProvider);
                                  await svc.start(ref.read(settingsProvider));
                                }),
                        icon: const Icon(Icons.play_arrow),
                        label: const Text('启动'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy || !st.running
                            ? null
                            : () => _run('已停止', () => ref.read(workerServiceProvider).stop()),
                        icon: const Icon(Icons.stop),
                        label: const Text('停止'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy || !st.running
                            ? null
                            : () => _run('已重启', () => ref.read(workerServiceProvider).restart(ref.read(settingsProvider))),
                        icon: const Icon(Icons.refresh),
                        label: const Text('重启'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
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
    final theme = Theme.of(context);
    if (webUrl.isEmpty) {
      return const InfoRow('Web 控制台', '');
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 76,
            child: Text('Web 控制台', style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor)),
          ),
          Expanded(child: Text(_display(webUrl), style: theme.textTheme.bodyMedium)),
          IconButton(
            tooltip: '复制完整地址（含凭证）',
            visualDensity: VisualDensity.compact,
            iconSize: 14,
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: webUrl));
              if (context.mounted) {
                ScaffoldMessenger.of(context)
                  ..hideCurrentSnackBar()
                  ..showSnackBar(const SnackBar(content: Text('已复制 Web 控制台地址'), duration: Duration(seconds: 1)));
              }
            },
            icon: const Icon(Icons.copy, size: 14),
          ),
          IconButton(
            tooltip: '在默认浏览器打开',
            visualDensity: VisualDensity.compact,
            iconSize: 14,
            onPressed: () => openInBrowser(webUrl),
            icon: const Icon(Icons.open_in_new, size: 14),
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
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Center(
        child: Text(
          'DSH Pocket Worker v${appInfo.value?.version ?? '…'}',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).hintColor),
        ),
      ),
    );
  }
}
