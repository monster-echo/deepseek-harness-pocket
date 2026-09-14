/// 日志页：tail ~/.deepseek-harness-pocket/dshc.log（shadcn 版，控制台窗口内）。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../services/paths.dart';
import '../../services/proc.dart';
import '../../services/worker.dart';

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
    final theme = ShadTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '~/.deepseek-harness-pocket/dshc.log（近 $_maxLinesShown 行，2 秒刷新）',
                  style: theme.textTheme.muted.copyWith(fontSize: 11),
                ),
              ),
              ShadButton.ghost(
                height: 26,
                width: 28,
                leading: const Icon(Icons.folder_open, size: 15),
                onPressed: () => revealInFileBrowser(AppPaths.workerLogFile),
              ),
              ShadButton.ghost(
                height: 26,
                width: 28,
                leading: const Icon(Icons.refresh, size: 15),
                onPressed: _refresh,
              ),
              const SizedBox(width: 4),
              const Text('自动滚底', style: TextStyle(fontSize: 12)),
              const SizedBox(width: 4),
              ShadSwitch(
                value: _autoScroll,
                onChanged: (v) => setState(() => _autoScroll = v),
              ),
            ],
          ),
        ),
        Expanded(
          child: _lines.isEmpty
              ? Center(
                  child: Text('暂无日志', style: theme.textTheme.muted),
                )
              : Container(
                  decoration: BoxDecoration(
                    color: theme.colorScheme.muted.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  padding: const EdgeInsets.all(10),
                  child: ListView.builder(
                    controller: _controller,
                    itemCount: _lines.length,
                    itemBuilder: (_, i) => Text(
                      _lines[i],
                      style: theme.textTheme.muted.copyWith(
                        fontFamily: 'Courier New',
                        fontFamilyFallback: const ['Menlo', 'monospace'],
                        fontSize: 11.5,
                        height: 1.35,
                      ),
                    ),
                  ),
                ),
        ),
      ],
    );
  }

  static const _maxLinesShown = 300;
}
