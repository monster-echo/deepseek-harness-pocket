/// 配对页：二维码 + 配对码 + rotate（原状态页配对卡片独立成页，托盘菜单入口）。
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../providers.dart';
import 'widgets.dart';

class PairingPage extends ConsumerStatefulWidget {
  const PairingPage({super.key});

  @override
  ConsumerState<PairingPage> createState() => _PairingPageState();
}

class _PairingPageState extends ConsumerState<PairingPage> {
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
    final theme = Theme.of(context);
    final pairingAsync = ref.watch(pairingProvider);

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: [
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
                          Text('配对码  ', style: theme.textTheme.bodySmall),
                          SelectableText(
                            payload.code,
                            style: theme.textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.bold,
                              letterSpacing: 4,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      InfoRow('主机指纹', payload.fingerprint, copyable: true),
                      const SizedBox(height: 4),
                      Text(
                        '手机 App → 扫码，或输入配对码',
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
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
