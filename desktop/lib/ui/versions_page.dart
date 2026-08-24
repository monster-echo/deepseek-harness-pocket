/// 版本页：切换 deepseek harness（@deepseek-ai/dsh）来源 / 托管多版本管理。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models.dart';
import '../providers.dart';
import '../services/paths.dart';
import 'widgets.dart';

class VersionsPage extends ConsumerStatefulWidget {
  const VersionsPage({super.key});

  @override
  ConsumerState<VersionsPage> createState() => _VersionsPageState();
}

class _VersionsPageState extends ConsumerState<VersionsPage> {
  bool _busy = false;
  String? _installingVersion;
  final _customController = TextEditingController();

  @override
  void dispose() {
    _customController.dispose();
    super.dispose();
  }

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
      ref.invalidate(installedDshProvider);
    }
  }

  void _setMode(String mode) {
    final s = ref.read(settingsProvider);
    ref.read(settingsProvider.notifier).update(s.copyWith(dshMode: mode));
  }

  void _useManaged(String version) {
    final s = ref.read(settingsProvider);
    ref.read(settingsProvider.notifier).update(s.copyWith(dshMode: 'managed', managedVersion: version));
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsProvider);
    final statusAsync = ref.watch(workerStatusProvider);
    final installedAsync = ref.watch(installedDshProvider);
    final availableAsync = ref.watch(availableDshProvider);

    final runningVersion = statusAsync.value?.run?.dshVersion ?? '';

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: [
        SectionCard(
          title: '当前在用',
          child: Column(
            children: [
              InfoRow('dsh 版本', runningVersion.isEmpty ? '（未运行）' : runningVersion),
              InfoRow('来源', switch (settings.dshMode) {
                'managed' => '应用托管（${settings.managedVersion}）',
                'custom' => '指定路径（${settings.customDshPath}）',
                _ => '系统 PATH',
              }),
            ],
          ),
        ),
        SectionCard(
          title: 'dsh 来源',
          child: RadioGroup<String>(
            groupValue: settings.dshMode,
            onChanged: (v) => _setMode(v!),
            child: Column(
              children: [
                RadioListTile<String>(
                  value: 'system',
                  title: const Text('系统 dsh'),
                  subtitle: const Text('使用 PATH 上已有的 dsh（npm -g 或自行安装）'),
                  dense: true,
                ),
                RadioListTile<String>(
                  value: 'managed',
                  title: const Text('应用托管版本'),
                  subtitle: Text('安装在 ${_shortHome()}/runtimes/dsh/，多版本并存可随时切换'),
                  dense: true,
                ),
                RadioListTile<String>(
                  value: 'custom',
                  title: const Text('指定路径'),
                  dense: true,
                ),
              ],
            ),
          ),
        ),
        if (settings.dshMode == 'custom')
          Padding(
            padding: const EdgeInsets.fromLTRB(28, 0, 28, 0),
            child: TextField(
              controller: _customController..text = settings.customDshPath,
              decoration: const InputDecoration(
                labelText: 'dsh 可执行文件路径',
                helperText: '切换来源或重启 worker 后生效',
                isDense: true,
              ),
              onChanged: (v) {
                final s = ref.read(settingsProvider);
                ref.read(settingsProvider.notifier).update(s.copyWith(customDshPath: v));
              },
            ),
          ),
        SectionCard(
          title: '生效',
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '切换来源或改设置后需重启 Worker 生效',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _run('已按当前设置重启', () => ref.read(workerServiceProvider).restart(ref.read(settingsProvider))),
                icon: const Icon(Icons.restart_alt, size: 16),
                label: const Text('重启 Worker'),
              ),
            ],
          ),
        ),
        SectionCard(
          title: '托管版本',
          trailing: IconButton(
            tooltip: '重新扫描',
            onPressed: () => ref.invalidate(installedDshProvider),
            icon: const Icon(Icons.refresh, size: 18),
          ),
          child: installedAsync.when(
            data: (list) => list.isEmpty
                ? const Text('尚未安装托管版本，从下方列表安装')
                : Column(
                    children: [
                      for (final d in list)
                        ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(d.version),
                          subtitle: Text(
                            '${_fmtDate(d.installedAt)} · ${d.binPath}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (settings.dshMode == 'managed' && settings.managedVersion == d.version)
                                const Chip(label: Text('使用中'), visualDensity: VisualDensity.compact)
                              else
                                TextButton(
                                  onPressed: () => _useManaged(d.version),
                                  child: const Text('使用'),
                                ),
                              IconButton(
                                tooltip: '删除',
                                icon: const Icon(Icons.delete_outline, size: 18),
                                onPressed: (settings.dshMode == 'managed' && settings.managedVersion == d.version) || runningVersion.isNotEmpty && d.version == runningVersion
                                    ? null
                                    : () => _run('已删除 ${d.version}', () => ref.read(runtimeServiceProvider).remove(d.version)),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
            loading: () => const Center(child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator())),
            error: (e, _) => Text('扫描失败：$e'),
          ),
        ),
        SectionCard(
          title: '安装新版本',
          trailing: IconButton(
            tooltip: '刷新可用版本（npm registry）',
            onPressed: () => ref.invalidate(availableDshProvider),
            icon: const Icon(Icons.cloud_outlined, size: 18),
          ),
          child: availableAsync.when(
            data: (versions) => _InstallPanel(
              versions: versions,
              installed: installedAsync.value ?? const [],
              busy: _busy,
              installing: _installingVersion,
              onInstall: (v) async {
                setState(() => _installingVersion = v);
                try {
                  await _run('已安装 $v', () => ref.read(runtimeServiceProvider).install(v, ref.read(settingsProvider).registry));
                } finally {
                  if (mounted) setState(() => _installingVersion = null);
                }
              },
              onInstalled: _useManaged,
            ),
            loading: () => const Center(child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator())),
            error: (e, _) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('获取失败：$e'),
                const SizedBox(height: 6),
                Text(
                  '请稍后重试；也可修改 ~/.deepseek-harness-pocket/desktop-settings.json 里的 registry',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  String _shortHome() {
    final h = AppPaths.home;
    return h.length > 18 ? '…${h.substring(h.length - 18)}' : h;
  }

  String _fmtDate(DateTime t) =>
      '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
}

class _InstallPanel extends StatefulWidget {
  const _InstallPanel({
    required this.versions,
    required this.installed,
    required this.busy,
    required this.installing,
    required this.onInstall,
    required this.onInstalled,
  });

  final List<String> versions;
  final List<InstalledDsh> installed;
  final bool busy;
  final String? installing;
  final Future<void> Function(String version) onInstall;
  final void Function(String version) onInstalled;

  @override
  State<_InstallPanel> createState() => _InstallPanelState();
}

class _InstallPanelState extends State<_InstallPanel> {
  String? _selected;

  @override
  Widget build(BuildContext context) {
    final installedSet = widget.installed.map((d) => d.version).toSet();
    final candidates = widget.versions.where((v) => !installedSet.contains(v)).toList(growable: false);

    if (candidates.isEmpty) {
      return const Text('可用版本均已安装');
    }
    _selected ??= candidates.first;

    return Row(
      children: [
        Expanded(
          child: DropdownButtonFormField<String>(
            initialValue: candidates.contains(_selected) ? _selected : candidates.first,
            items: [
              for (final v in candidates) DropdownMenuItem(value: v, child: Text(v)),
            ],
            onChanged: (v) => setState(() => _selected = v),
            decoration: const InputDecoration(isDense: true, border: OutlineInputBorder()),
          ),
        ),
        const SizedBox(width: 8),
        widget.installing != null
            ? const Padding(
                padding: EdgeInsets.symmetric(horizontal: 12),
                child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
              )
            : FilledButton.tonalIcon(
                onPressed: widget.busy
                    ? null
                    : () async {
                        final v = _selected ?? candidates.first;
                        await widget.onInstall(v);
                        widget.onInstalled(v);
                      },
                icon: const Icon(Icons.download, size: 16),
                label: const Text('安装'),
              ),
      ],
    );
  }
}
