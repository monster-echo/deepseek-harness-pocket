/// shadcn 共享小部件：SectionCard / InfoRow / StatusDot / 反馈 toast。
library;

import 'package:flutter/material.dart' show Icons;
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

/// 分区卡片：标题 + 右侧动作 + 内容（ShadCard 封装，统一控制台观感）。
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, required this.child, this.trailing});

  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return ShadCard(
      title: Text(title, style: theme.textTheme.h4),
      trailing: trailing,
      child: Padding(
        padding: const EdgeInsets.only(top: 4),
        child: child,
      ),
    );
  }
}

/// 信息行：label + value（可复制）。
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.copyable = false});

  final String label;
  final String value;
  final bool copyable;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 84,
            child: Text(
              label,
              style: theme.textTheme.muted.copyWith(fontSize: 12),
            ),
          ),
          Expanded(
            child: Text(value.isEmpty ? '—' : value, style: theme.textTheme.list),
          ),
          if (copyable && value.isNotEmpty)
            ShadButton.ghost(
              height: 22,
              width: 26,
              leading: const Icon(Icons.copy, size: 14),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: value));
                if (context.mounted) showFeedback(context, ok: '已复制 $label');
              },
            ),
        ],
      ),
    );
  }
}

/// 状态圆点 + 文本（运行中/已停止等）。
class StatusDot extends StatelessWidget {
  const StatusDot({super.key, required this.ok, required this.label, this.dim = false});

  final bool ok;
  final String label;
  final bool dim;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final scheme = theme.colorScheme;
    final color = dim ? scheme.mutedForeground : (ok ? const Color(0xFF34C759) : scheme.destructive);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 8),
        Text(label, style: theme.textTheme.p),
      ],
    );
  }
}

/// 统一反馈：shadcn toast（sonner）。
void showFeedback(BuildContext context, {String? ok, Object? error}) {
  final sonner = ShadSonner.of(context);
  final id = DateTime.now().microsecondsSinceEpoch % 1000000;
  if (error != null) {
    sonner.show(ShadToast.destructive(
      id: id,
      title: const Text('操作失败'),
      description: Text(error.toString()),
    ));
    return;
  }
  sonner.show(ShadToast(id: id, title: Text(ok ?? '完成')));
}

/// 详情键值（小号 label 在上、内容在下）。
class DetailField extends StatelessWidget {
  const DetailField(this.label, this.value, {super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: theme.textTheme.muted.copyWith(fontSize: 12)),
        const SizedBox(height: 2),
        Text(value.isEmpty ? '—' : value, style: theme.textTheme.p),
      ],
    );
  }
}
