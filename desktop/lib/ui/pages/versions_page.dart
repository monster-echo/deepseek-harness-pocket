/// 版本页：切换 deepseek harness（@deepseek-ai/dsh）来源 / 托管多版本管理。
/// （shadcn 版，控制台窗口内）
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../models.dart';
import '../../providers.dart';
import '../../services/paths.dart';
import '../widgets.dart';

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
      if (mounted) showFeedback(context, ok: okMsg);
    } catch (e) {
      if (mounted) showFeedback(context, error: e);
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
    final theme = ShadTheme.of(context);
    final settings = ref.watch(settingsProvider);
    final statusAsync = ref.watch(workerStatusProvider);
    final installedAsync = ref.watch(installedDshProvider);
    final availableAsync = ref.watch(availableDshProvider);

    final runningVersion = statusAsync.value?.run?.dshVersion ?? '';

    return ListView(
      children: [
        SectionCard(
          title: '当前在用',
          child: Column(
            children: [
              InfoRow('dsh 版本', runningVersion.isEmpty ? '（未运行）' : runningVersion),
              InfoRow(
                '来源',
                switch (settings.dshMode) {
                  'managed' => '应用托管（${settings.managedVersion}）',
                  'custom' => '指定路径（${settings.customDshPath}）',
                  _ => '系统 PATH',
                },
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        SectionCard(
          title: 'dsh 来源',
          child: ShadRadioGroup<String>(
            initialValue: settings.dshMode,
            onChanged: (v) => _setMode(v!),
            items: [
              ShadRadio(
                value: 'system',
                label: const Text('系统 dsh'),
                sublabel: const Text('使用 PATH 上已有的 dsh（npm -g 或自行安装）'),
              ),
              ShadRadio(
                value: 'managed',
                label: const Text('应用托管版本'),
                sublabel: Text('安装在 ${_shortHome()}/runtimes/dsh/，多版本并存可随时切换'),
              ),
              ShadRadio(
                value: 'custom',
                label: const Text('指定路径'),
              ),
            ],
          ),
        ),
        if (settings.dshMode == 'custom')
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 10, 4, 0),
            child: ShadInput(
              controller: _customController..text = settings.customDshPath,
              placeholder: const Text('dsh 可执行文件路径'),
              onChanged: (v) {
                final s = ref.read(settingsProvider);
                ref.read(settingsProvider.notifier).update(s.copyWith(customDshPath: v));
              },
            ),
          ),
        const SizedBox(height: 10),
        SectionCard(
          title: '生效',
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '切换来源或改设置后需重启 Worker 生效',
                  style: theme.textTheme.muted.copyWith(fontSize: 12),
                ),
              ),
              ShadButton.outline(
                enabled: !_busy,
                onPressed: () => _run(
                  '已按当前设置重启',
                  () => ref.read(workerServiceProvider).restart(ref.read(settingsProvider)),
                ),
                leading: const Icon(Icons.restart_alt, size: 15),
                child: const Text('重启 Worker'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        SectionCard(
          title: '托管版本',
          trailing: ShadButton.ghost(
            height: 26,
            width: 28,
            onPressed: () {
              ref.invalidate(installedDshProvider);
              ref.invalidate(availableDshProvider);
            },
            leading: const Icon(Icons.refresh, size: 15),
          ),
          child: installedAsync.when(
            data: (list) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (list.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text(
                      '尚未安装托管版本，从下方安装',
                      style: theme.textTheme.muted.copyWith(fontSize: 12),
                    ),
                  )
                else
                  for (final d in list)
                    _VersionRow(
                      version: d.version,
                      meta: '${_fmtDate(d.installedAt)} · ${d.binPath}',
                      inUse: settings.dshMode == 'managed' && settings.managedVersion == d.version,
                      canDelete: !((settings.dshMode == 'managed' && settings.managedVersion == d.version) ||
                          (runningVersion.isNotEmpty && d.version == runningVersion)),
                      onUse: () => _useManaged(d.version),
                      onDelete: () => _run('已删除 ${d.version}', () => ref.read(runtimeServiceProvider).remove(d.version)),
                    ),
                const SizedBox(height: 12),
                availableAsync.when(
                  data: (versions) => _InstallPanel(
                    versions: versions,
                    installed: list,
                    busy: _busy,
                    installing: _installingVersion,
                    onInstall: (v) async {
                      setState(() => _installingVersion = v);
                      try {
                        await _run(
                          '已安装 $v',
                          () => ref.read(runtimeServiceProvider).install(v, ref.read(settingsProvider).registry),
                        );
                      } finally {
                        if (mounted) setState(() => _installingVersion = null);
                      }
                    },
                    onInstalled: _useManaged,
                  ),
                  loading: () => const Center(
                    child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator()),
                  ),
                  error: (e, _) => Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('获取失败：$e', style: theme.textTheme.p),
                      const SizedBox(height: 6),
                      Text(
                        '请稍后重试；也可修改 ~/.deepseek-harness-pocket/desktop-settings.json 里的 registry',
                        style: theme.textTheme.muted.copyWith(fontSize: 11),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            loading: () => const Center(
              child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator()),
            ),
            error: (e, _) => Text('扫描失败：$e'),
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

/// 单个已安装版本行。
class _VersionRow extends StatelessWidget {
  const _VersionRow({
    required this.version,
    required this.meta,
    required this.inUse,
    required this.canDelete,
    required this.onUse,
    required this.onDelete,
  });

  final String version;
  final String meta;
  final bool inUse;
  final bool canDelete;
  final VoidCallback onUse;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(version, style: theme.textTheme.p),
                Text(
                  meta,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.muted.copyWith(fontSize: 11),
                ),
              ],
            ),
          ),
          if (inUse)
            const ShadBadge(child: Text('使用中'))
          else
            ShadButton.outline(
              height: 28,
              onPressed: onUse,
              child: const Text('使用'),
            ),
          const SizedBox(width: 4),
          ShadButton.ghost(
            height: 28,
            width: 30,
            enabled: canDelete,
            leading: const Icon(Icons.delete_outline, size: 15),
            onPressed: onDelete,
          ),
        ],
      ),
    );
  }
}

/// 安装面板：可用版本下拉 + 安装按钮。
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
      return Text('可用版本均已安装', style: ShadTheme.of(context).textTheme.muted);
    }
    final effective = candidates.contains(_selected) ? _selected! : candidates.first;
    _selected = effective;

    return Row(
      children: [
        Expanded(
          child: ShadSelect<String>(
            initialValue: effective,
            selectedOptionBuilder: (context, value) => Text(value),
            options: [
              for (final v in candidates) ShadOption(value: v, child: Text(v)),
            ],
            onChanged: (v) => setState(() => _selected = v),
          ),
        ),
        const SizedBox(width: 8),
        if (widget.installing != null)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 12),
            child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
          )
        else
          ShadButton.secondary(
            enabled: !widget.busy,
            onPressed: () async {
              final v = _selected ?? candidates.first;
              await widget.onInstall(v);
              widget.onInstalled(v);
            },
            leading: const Icon(Icons.download, size: 15),
            child: const Text('安装'),
          ),
      ],
    );
  }
}
