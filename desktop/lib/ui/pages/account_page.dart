/// 账号页：浏览器登录 / 绑定状态 / 登出（登录是与手机端互联的唯一方式）。
///
/// 登录不在应用内收集账号密码：点击「在浏览器中登录」跳转系统浏览器，
/// 在掌鲸认证网页完成登录后重定向回本机回调（loopback），自动保存会话。
/// 登录成功后会话写入 account-session.json，bridge 插件 uplink 上送 gateway
/// 自动绑定；本页也可手动「绑定这台电脑」（REST /api/v1/workers/bind）。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../providers.dart';
import '../../services/account.dart';
import '../widgets.dart';

class AccountPage extends ConsumerStatefulWidget {
  const AccountPage({super.key});

  @override
  ConsumerState<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends ConsumerState<AccountPage> {
  bool _binding = false;

  Future<void> _bind() async {
    if (_binding) return;
    setState(() => _binding = true);
    try {
      await ref.read(accountServiceProvider).bindThisWorker();
      ref.invalidate(accountSnapshotProvider);
      if (mounted) showFeedback(context, ok: '已绑定，手机端可立即看到这台电脑');
    } catch (e) {
      if (mounted) showFeedback(context, error: e);
    } finally {
      if (mounted) setState(() => _binding = false);
    }
  }

  Future<void> _signOut() async {
    try {
      await ref.read(accountServiceProvider).signOut();
      ref.invalidate(accountSnapshotProvider);
      if (mounted) showFeedback(context, ok: '已退出登录');
    } catch (e) {
      if (mounted) showFeedback(context, error: e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final snapshotAsync = ref.watch(accountSnapshotProvider);
    return snapshotAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => ListView(children: [
        ShadAlert.destructive(
          icon: const Icon(Icons.error_outline),
          title: const Text('账号状态获取失败'),
          description: Text('$e'),
        ),
      ]),
      data: (snapshot) => snapshot == null
          ? const _BrowserLoginCard()
          : _AccountCard(
              snapshot: snapshot,
              binding: _binding,
              onBind: _bind,
              onSignOut: _signOut,
            ),
    );
  }
}

// ---------- 浏览器登录卡片 ----------

class _BrowserLoginCard extends ConsumerStatefulWidget {
  const _BrowserLoginCard();

  @override
  ConsumerState<_BrowserLoginCard> createState() => _BrowserLoginCardState();
}

class _BrowserLoginCardState extends ConsumerState<_BrowserLoginCard> {
  bool _waiting = false;

  Future<void> _start() async {
    if (_waiting) return;
    setState(() => _waiting = true);
    try {
      final svc = ref.read(accountServiceProvider);
      final session = await svc.loginViaBrowser();
      try {
        await svc.bindThisWorker();
      } catch (_) {}
      ref.invalidate(accountSnapshotProvider);
      if (mounted) {
        showFeedback(context, ok: session.email.isEmpty ? '登录成功' : '登录成功（${session.email}）');
      }
    } on AccountException catch (e) {
      if (e.toString().contains('已取消登录')) return;
      if (mounted) showFeedback(context, error: e);
    } catch (e) {
      if (mounted) showFeedback(context, error: e);
    } finally {
      if (mounted) setState(() => _waiting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return ListView(
      children: [
        SectionCard(
          title: '登录掌鲸账号',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '点击下方按钮将打开浏览器，在掌鲸认证网页完成登录后自动返回本应用。\n'
                '登录同一账号后，手机 App 即可直接看到这台电脑，无需扫码。',
                style: theme.textTheme.muted.copyWith(fontSize: 12),
              ),
              const SizedBox(height: 16),
              _waiting
                  ? Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                            const SizedBox(width: 10),
                            Text('已打开浏览器，等待登录完成…', style: theme.textTheme.p),
                          ],
                        ),
                        const SizedBox(height: 14),
                        ShadButton.outline(
                          onPressed: () =>
                              ref.read(accountServiceProvider).cancelBrowserLogin(),
                          child: const Text('取消'),
                        ),
                      ],
                    )
                  : ShadButton(
                      onPressed: _start,
                      leading: const Icon(Icons.open_in_new, size: 15),
                      child: const Text('在浏览器中登录'),
                    ),
              const SizedBox(height: 6),
              Center(
                child: Text(
                  '没有账号？先在手机 App 注册',
                  style: theme.textTheme.muted.copyWith(fontSize: 11),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ---------- 已登录卡片 ----------

class _AccountCard extends ConsumerWidget {
  const _AccountCard({
    required this.snapshot,
    required this.binding,
    required this.onBind,
    required this.onSignOut,
  });

  final AccountSnapshot snapshot;
  final bool binding;
  final VoidCallback onBind;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ShadTheme.of(context);
    final session = snapshot.session;
    final updated = DateTime.fromMillisecondsSinceEpoch(session.updatedAt);

    return ListView(
      children: [
        SectionCard(
          title: '账号',
          trailing: ShadBadge(
            backgroundColor: snapshot.bound ? const Color(0xFF34C759) : theme.colorScheme.secondary,
            foregroundColor: snapshot.bound ? Colors.white : theme.colorScheme.secondaryForeground,
            child: Text(snapshot.bound ? '已绑定' : '未绑定'),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InfoRow('邮箱', session.email, copyable: true),
              if (session.userId.isNotEmpty) InfoRow('用户 ID', session.userId, copyable: true),
              InfoRow('登录时间', _fmt(updated)),
              const SizedBox(height: 10),
              Text(
                snapshot.bound
                    ? '这台电脑已关联到你的账号，手机 App 打开即可看到它。'
                    : '这台电脑还没有关联到当前账号，点「绑定这台电脑」后手机端即可直接看到它。',
                style: theme.textTheme.muted.copyWith(fontSize: 12),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: ShadButton(
                      onPressed: binding ? null : onBind,
                      enabled: !binding,
                      leading: binding
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.link, size: 15),
                      child: Text(snapshot.bound ? '重新绑定' : '绑定这台电脑'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ShadButton.outline(
                      onPressed: onSignOut,
                      leading: const Icon(Icons.logout, size: 15),
                      child: const Text('退出登录'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SectionCard(
          title: '关于登录',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Bullet('同一账号登录后自动互联：电脑端登录，手机端即可见，无需任何扫码'),
              _Bullet('登录在系统浏览器完成，应用内不收集账号密码'),
              _Bullet('手机端解绑后，电脑端重新登录或点「绑定这台电脑」可恢复'),
            ],
          ),
        ),
      ],
    );
  }

  static String _fmt(DateTime t) =>
      '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')} '
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

class _Bullet extends StatelessWidget {
  const _Bullet(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 7),
            child: Icon(Icons.circle, size: 5),
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: theme.textTheme.muted.copyWith(fontSize: 12))),
        ],
      ),
    );
  }
}
