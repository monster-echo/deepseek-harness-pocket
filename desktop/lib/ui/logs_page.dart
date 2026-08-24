/// 日志页：tail ~/.deepseek-harness-pocket/dshc.log。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/paths.dart';
import '../services/proc.dart';
import '../services/worker.dart';

class LogsPage extends ConsumerStatefulWidget {
  const LogsPage({super.key});

  @override
  ConsumerState<LogsPage> createState() => _LogsPageState();
}

class _LogsPageState extends ConsumerState<LogsPage> {
  List<String> _lines = const [];
  bool _autoScroll = true;
  Timer? _timer;
  final _controller = ScrollController();

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final lines = await tailWorkerLog();
    if (!mounted) return;
    setState(() => _lines = lines);
    if (_autoScroll && _controller.hasClients) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_controller.hasClients) {
          _controller.jumpTo(_controller.position.maxScrollExtent);
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 8, 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '~/.deepseek-harness-pocket/dshc.log（近 $_maxLinesShown 行，2 秒刷新）',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
                ),
              ),
              IconButton(
                tooltip: '在文件管理器中显示',
                onPressed: () => revealInFileBrowser(AppPaths.workerLogFile),
                icon: const Icon(Icons.folder_open, size: 18),
              ),
              IconButton(
                tooltip: '刷新',
                onPressed: _refresh,
                icon: const Icon(Icons.refresh, size: 18),
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('自动滚底'),
                  Switch(
                    value: _autoScroll,
                    onChanged: (v) => setState(() => _autoScroll = v),
                  ),
                ],
              ),
            ],
          ),
        ),
        Expanded(
          child: _lines.isEmpty
              ? Center(
                  child: Text('暂无日志', style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor)),
                )
              : ListView.builder(
                  controller: _controller,
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                  itemCount: _lines.length,
                  itemBuilder: (_, i) => Text(
                    _lines[i],
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontFamily: 'Courier New',
                      fontFamilyFallback: const ['Menlo', 'monospace'],
                      fontSize: 11.5,
                      height: 1.35,
                    ),
                  ),
                ),
        ),
      ],
    );
  }

  static const _maxLinesShown = 300;
}
