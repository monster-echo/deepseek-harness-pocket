/// 状态页：运行状态 + 启停控制 + 配对二维码。
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../providers.dart';
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
      ref.invalidate(pairingProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final statusAsync = ref.watch(workerStatusProvider);
    final settings = ref.watch(settingsProvider);
    final pairingAsync = ref.watch(pairingProvider);

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
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _busy
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
                        onPressed: _busy
                            ? null
                            : () => _run('已停止', () => ref.read(workerServiceProvider).stop()),
                        icon: const Icon(Icons.stop),
                        label: const Text('停止'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy
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
        SectionCard(
          title: '配对',
          trailing: TextButton.icon(
            onPressed: _busy
                ? null
                : () => _run('配对码已更新', () async {
                      await ref.read(workerServiceProvider).rotateToken();
                    }),
            icon: const Icon(Icons.key_outlined, size: 16),
            label: const Text('换配对码'),
          ),
          child: pairingAsync.when(
            data: (payload) => payload == null
                ? const Text('配对信息不可用（状态文件读取失败）')
                : Column(
                    children: [
                      Center(
                        child: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: QrImageView(
                            data: jsonEncode(payload.toJson()),
                            version: QrVersions.auto,
                            size: 190,
                            gapless: false,
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('配对码  ', style: Theme.of(context).textTheme.bodySmall),
                          SelectableText(
                            payload.code,
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 4,
                                ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      InfoRow('直连地址', payload.lanUrl ?? '（无局域网地址）', copyable: true),
                      InfoRow('主机指纹', payload.fingerprint, copyable: true),
                      const SizedBox(height: 4),
                      Text(
                        '手机 App → 扫码，或输入配对码',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).hintColor),
                      ),
                    ],
                  ),
            loading: () => const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
            error: (e, _) => Text('配对信息读取失败：$e'),
          ),
        ),
      ],
    );
  }
}
