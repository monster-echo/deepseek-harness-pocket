/// 配对页：二维码 + 配对码 + rotate（兜底路径，用于把电脑共享给其他账号）。
/// 同账号用户直接登录即可（账号页），无需使用本页。
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../providers.dart';
import '../widgets.dart';

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
      if (mounted) showFeedback(context, ok: okMsg);
    } catch (e) {
      if (mounted) showFeedback(context, error: e);
    } finally {
      if (mounted) setState(() => _busy = false);
      ref.invalidate(workerStatusProvider);
      ref.invalidate(pairingProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final pairingAsync = ref.watch(pairingProvider);

    return ListView(
      children: [
        SectionCard(
          title: '扫码配对（共享给其他账号）',
          trailing: ShadButton.ghost(
            height: 26,
            enabled: !_busy,
            onPressed: () => _run('配对码已更新', () async {
              await ref.read(workerServiceProvider).rotateToken();
            }),
            leading: const Icon(Icons.key_outlined, size: 15),
            child: const Text('换配对码', style: TextStyle(fontSize: 12)),
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
                          Text('配对码  ', style: theme.textTheme.muted.copyWith(fontSize: 12)),
                          SelectableText(
                            payload.code,
                            style: theme.textTheme.h3.copyWith(letterSpacing: 4),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      InfoRow('主机指纹', payload.fingerprint, copyable: true),
                      const SizedBox(height: 4),
                      Text(
                        '手机 App → 扫码，或输入配对码（同账号无需此步）',
                        style: theme.textTheme.muted.copyWith(fontSize: 11),
                      ),
                    ],
                  ),
            loading: () => const Center(
              child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()),
            ),
            error: (e, _) => Text('配对信息读取失败：$e'),
          ),
        ),
      ],
    );
  }
}
