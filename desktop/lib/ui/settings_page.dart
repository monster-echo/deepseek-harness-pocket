/// 设置页：Worker 名称/能力面 + 自启 + 检查更新。
/// gateway / 监听地址 / npm registry 属内部配置，不在界面上暴露；
/// 需要时可手改 ~/.deepseek-harness-pocket/desktop-settings.json。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models.dart';
import '../providers.dart';
import 'widgets.dart';

class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  late final TextEditingController _name;
  bool _checkingUpdate = false;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: ref.read(settingsProvider).workerName);
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _save(void Function(AppSettings s) mutate) {
    final s = ref.read(settingsProvider).copyWith();
    mutate(s);
    ref.read(settingsProvider.notifier).update(s);
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsProvider);
    final appInfo = ref.watch(appInfoProvider);
    final autostart = ref.watch(autostartEnabledProvider);
    final autostartValue = autostart.value ?? false;

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: [
        SectionCard(
          title: 'Worker',
          child: Column(
            children: [
              TextField(
                controller: _name,
                decoration: const InputDecoration(
                  labelText: 'Worker 名称',
                  helperText: '手机配对时显示的名字；留空使用 hostname',
                  isDense: true,
                ),
                onChanged: (v) => _save((s) => s.workerName = v.trim()),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Text('能力面', style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(width: 12),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: 'm1', label: Text('m1 只读')),
                      ButtonSegment(value: 'm2', label: Text('m2 交互')),
                      ButtonSegment(value: 'm3', label: Text('m3')),
                    ],
                    selected: {settings.caps},
                    onSelectionChanged: (sel) => _save((s) => s.caps = sel.first),
                  ),
                ],
              ),
            ],
          ),
        ),
        SectionCard(
          title: '行为',
          child: Column(
            children: [
              SwitchListTile(
                value: settings.autoStartWorker,
                onChanged: (v) => _save((s) => s.autoStartWorker = v),
                title: const Text('应用启动时确保 Worker 在运行'),
                dense: true,
              ),
              SwitchListTile(
                value: settings.stopWorkerOnExit,
                onChanged: (v) => _save((s) => s.stopWorkerOnExit = v),
                title: const Text('退出应用时同时停止 Worker'),
                subtitle: const Text('关闭窗口只是收进托盘，不退出'),
                dense: true,
              ),
              SwitchListTile(
                value: autostartValue,
                onChanged: autostart.hasError
                    ? null
                    : (v) => ref.read(autostartEnabledProvider.notifier).set(v),
                title: const Text('开机自动启动本应用'),
                subtitle: autostart.hasError ? const Text('（当前环境不支持：打包后的应用才可注册）') : null,
                dense: true,
              ),
            ],
          ),
        ),
        SectionCard(
          title: '关于与更新',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InfoRow('版本', appInfo.value?.version ?? '…'),
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                onPressed: _checkingUpdate
                    ? null
                    : () async {
                        setState(() => _checkingUpdate = true);
                        try {
                          await ref.read(updaterServiceProvider).checkNow();
                        } catch (e) {
                          if (!context.mounted) return;
                          showActionFeedback(context, error: e);
                        } finally {
                          if (mounted) setState(() => _checkingUpdate = false);
                        }
                      },
                icon: _checkingUpdate
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.system_update_alt, size: 16),
                label: const Text('检查更新'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
