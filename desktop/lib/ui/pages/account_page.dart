/// 账号页：登录 / 绑定状态 / 登出（登录机制取代同账号配对）。
///
/// 与手机 App 同一账号体系：登录成功后会话写入 account-session.json，
/// bridge 插件 uplink 上送 gateway 自动绑定；本页也可手动「绑定这台电脑」
/// （REST /api/v1/workers/bind，hostKey 定位，免扫码）。
/// 同账号手机端无需扫码即可看到这台电脑；「配对」页仅用于共享给其他账号。
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
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _signingIn = false;
  bool _binding = false;
  String? _formError;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    if (_signingIn) return;
    final identifier = _identifier.text.trim();
    if (identifier.isEmpty || _password.text.isEmpty) {
      setState(() => _formError = '请输入账号和密码');
      return;
    }
    setState(() {
      _signingIn = true;
      _formError = null;
    });
    try {
      final svc = ref.read(accountServiceProvider);
      await svc.signIn(identifier: identifier, password: _password.text);
      // 登录后立即尝试绑定本机（幂等；失败不阻断登录）
      try {
        await svc.bindThisWorker();
      } catch (_) {}
      ref.invalidate(accountSnapshotProvider);
      if (mounted) showFeedback(context, ok: '登录成功，手机端将自动看到这台电脑');
    } catch (e) {
      setState(() => _formError = e.toString());
    } finally {
      if (mounted) {
        setState(() => _signingIn = false);
        _password.clear();
      }
    }
  }

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
          ? _LoginForm(
              this,
            )
          : _AccountCard(
              snapshot: snapshot,
              binding: _binding,
              onBind: _bind,
              onSignOut: _signOut,
            ),
    );
  }
}

// ---------- 登录表单 ----------

class _LoginForm extends StatelessWidget {
  const _LoginForm(this.state);

  final _AccountPageState state;

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    return ListView(
      children: [
        SectionCard(
          title: '登录掌鲸账号',
          trailing: ShadButton.ghost(
            height: 26,
            onPressed: () => state.ref.invalidate(accountSnapshotProvider),
            leading: const Icon(Icons.refresh, size: 15),
            child: const Text('刷新', style: TextStyle(fontSize: 12)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '登录与手机 App 相同的账号，手机端即可直接看到这台电脑，无需扫码配对',
                style: theme.textTheme.muted.copyWith(fontSize: 12),
              ),
              const SizedBox(height: 14),
              ShadInput(
                controller: state._identifier,
                placeholder: const Text('邮箱'),
                enabled: !state._signingIn,
                onSubmitted: (_) => state._signIn(),
              ),
              const SizedBox(height: 8),
              ShadInput(
                controller: state._password,
                placeholder: const Text('密码'),
                obscureText: true,
                enabled: !state._signingIn,
                onSubmitted: (_) => state._signIn(),
              ),
              if (state._formError != null) ...[
                const SizedBox(height: 8),
                ShadAlert.destructive(
                  icon: const Icon(Icons.error_outline),
                  title: const Text('登录失败'),
                  description: Text(state._formError!),
                ),
              ],
              const SizedBox(height: 14),
              ShadButton(
                onPressed: state._signingIn ? null : state._signIn,
                enabled: !state._signingIn,
                leading: state._signingIn
                    ? const SizedBox(
                        width: 14, height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.login, size: 15),
                child: Text(state._signingIn ? '登录中…' : '登录'),
              ),
              const SizedBox(height: 4),
              Center(
                child: Text(
                  '需要先在手机 App 注册账号',
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
                    ? '这台电脑已关联到你的账号，手机 App 打开即可看到它，无需扫码配对。'
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
                              width: 14, height: 14,
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
          title: '关于登录与配对',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Bullet('同一账号登录后自动互联：电脑端登录，手机端即可见，双向都不需要扫码'),
              _Bullet('「配对」入口保留：用于把这台电脑共享给其他掌鲸账号（扫二维码）'),
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
