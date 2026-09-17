/// 账号页：手机扫码授权登录（主）/ 浏览器登录（辅）/ 绑定状态 / 退出登录。
///
/// 未登录时显示**二维码**：手机上的 DSH Pocket 扫码即可把这台电脑登录到同一账号
/// （手机已登录的会话不共享，gateway 给桌面端签发独立设备凭据，见
/// services/device_link.dart）。登录后本页展示账号与本机绑定状态。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../providers.dart';
import '../../services/account.dart';
import '../../services/device_link.dart';
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

  Future<void> _signOut(AccountSnapshot snapshot) async {
    try {
      if (snapshot.viaDeviceLink) {
        await ref.read(deviceLinkProvider.notifier).signOut();
      } else {
        await ref.read(accountServiceProvider).signOut();
      }
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
          ? const _QrLoginCard()
          : _AccountCard(
              snapshot: snapshot,
              binding: _binding,
              onBind: _bind,
              onSignOut: () => _signOut(snapshot),
            ),
    );
  }
}

// ---------- 扫码登录卡片（未登录） ----------

/// 未登录：显示二维码，等手机扫码授权。
///
/// 生命周期：进入即申请链接码 → 显示二维码 → 按 gateway 给的间隔轮询 →
/// 手机确认后拿到设备凭据（服务里落盘）→ 刷新快照换成本页的账号卡片。
class _QrLoginCard extends ConsumerStatefulWidget {
  const _QrLoginCard();

  @override
  ConsumerState<_QrLoginCard> createState() => _QrLoginCardState();
}

class _QrLoginCardState extends ConsumerState<_QrLoginCard> {
  PendingDeviceLink? _pending;
  String? _error;
  String? _hint;
  bool _starting = false;
  Timer? _poll;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    // 首帧后再发起：避免在 build 期间改 provider/发请求
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _start() async {
    if (_starting) return;
    setState(() {
      _starting = true;
      _error = null;
      _hint = null;
    });
    _poll?.cancel();
    _tick?.cancel();
    try {
      final svc = ref.read(deviceLinkServiceProvider);
      final identity = ref.read(accountServiceProvider).readWorkerIdentity();
      if (identity == null) {
        // hostKey 由 worker 首次启动写入；没有它 gateway 无法定位这台电脑
        setState(() {
          _error = '本机服务标识不可用：请先在「状态」页启动一次服务，然后点「重新生成二维码」';
          _starting = false;
        });
        return;
      }
      final settings = ref.read(settingsProvider);
      final pending = await svc.start(
        identity: identity,
        name: settings.workerName,
      );
      if (!mounted) return;
      setState(() {
        _pending = pending;
        _starting = false;
      });
      _schedulePoll(svc, pending);
      // 每秒刷新倒计时
      _tick = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        setState(() {});
        if (_pending?.expired ?? false) {
          _poll?.cancel();
          _tick?.cancel();
        }
      });
    } on DeviceLinkException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _starting = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _starting = false;
        });
      }
    }
  }

  /// 按 gateway 建议间隔轮询；手机确认后写入凭据并刷新界面。
  void _schedulePoll(DeviceLinkService svc, PendingDeviceLink pending) {
    _poll?.cancel();
    _poll = Timer.periodic(
      Duration(milliseconds: pending.intervalMs < 800 ? 800 : pending.intervalMs),
      (_) async {
        if (!mounted) return;
        if (pending.expired) {
          _poll?.cancel();
          return;
        }
        try {
          final result = await svc.poll(pending);
          switch (result) {
            case DeviceLinkApproved(:final link):
              _poll?.cancel();
              _tick?.cancel();
              ref.read(deviceLinkProvider.notifier).refresh();
              ref.invalidate(accountSnapshotProvider);
              if (mounted) {
                showFeedback(context, ok: '登录成功（${link.display}）');
              }
            case DeviceLinkExpired():
              _poll?.cancel();
              _tick?.cancel();
              if (mounted) {
                setState(() => _hint = '二维码已过期，请点「重新生成二维码」');
              }
            case DeviceLinkPending():
              break;
          }
        } catch (e) {
          // 轮询失败不打断：下一拍继续（网络抖动很常见）
          if (mounted) setState(() => _hint = '等待手机确认…（$e）');
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);
    final pending = _pending;
    final gateway = ref.read(deviceLinkServiceProvider).gatewayBase;
    final settings = ref.read(settingsProvider);

    return ListView(
      children: [
        SectionCard(
          title: '手机扫码登录',
          trailing: _starting
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : null,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '用手机上的 DSH Pocket 扫描下方二维码并确认，这台电脑就会登录到你的账号，'
                '手机端随即能看到它。',
                style: theme.textTheme.muted.copyWith(fontSize: 12),
              ),
              const SizedBox(height: 14),
              if (_error != null)
                ShadAlert.destructive(
                  icon: const Icon(Icons.error_outline),
                  title: const Text('无法发起扫码登录'),
                  description: Text(_error!),
                )
              else if (pending == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 28),
                    child: CircularProgressIndicator(),
                  ),
                )
              else
                Center(
                  child: Column(
                    children: [
                      // 二维码：白底黑码，深色主题下也能扫
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: QrImageView(
                          data: pending.qrText(
                            name: settings.workerName,
                            platform: Theme.of(context).platform.name,
                            gateway: gateway,
                          ),
                          version: QrVersions.auto,
                          size: 176,
                          backgroundColor: Colors.white,
                          eyeStyle: const QrEyeStyle(
                            eyeShape: QrEyeShape.square,
                            color: Colors.black,
                          ),
                          dataModuleStyle: const QrDataModuleStyle(
                            dataModuleShape: QrDataModuleShape.square,
                            color: Colors.black,
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        pending.expired
                            ? '二维码已过期'
                            : '有效期剩余 ${pending.remainingSeconds} 秒',
                        style: theme.textTheme.muted.copyWith(fontSize: 12),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '链接码 ${pending.code}',
                        style: theme.textTheme.muted.copyWith(fontSize: 11, letterSpacing: 2),
                      ),
                    ],
                  ),
                ),
              if (_hint != null) ...[
                const SizedBox(height: 10),
                Text(
                  _hint!,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.muted.copyWith(fontSize: 12),
                ),
              ],
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: ShadButton(
                      onPressed: _starting ? null : _start,
                      enabled: !_starting,
                      leading: const Icon(Icons.refresh, size: 15),
                      child: const Text('重新生成二维码'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _BrowserLoginButton(
                      onPressed: () async {
                        // 浏览器登录作为备选（同一账号体系），成功后刷新快照
                        await _browserLogin(context);
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '没有账号？先在手机 App 注册，再用手机扫码登录这台电脑。',
                textAlign: TextAlign.center,
                style: theme.textTheme.muted.copyWith(fontSize: 11),
              ),
            ],
          ),
        ),
        const SectionCard(
          title: '关于扫码登录',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Bullet('二维码只包含一次性链接码，5 分钟内有效、用后作废'),
              _Bullet('手机确认授权，账号密码不经过这台电脑'),
              _Bullet('手机端的登录态不会被复制到电脑，电脑拿到的是独立设备凭据，可随时退出'),
            ],
          ),
        ),
      ],
    );
  }

  /// 浏览器登录（备选路径）：跳系统浏览器完成登录后回调本机。
  Future<void> _browserLogin(BuildContext context) async {
    try {
      final svc = ref.read(accountServiceProvider);
      final session = await svc.loginViaBrowser();
      try {
        await svc.bindThisWorker();
      } catch (_) {}
      ref.invalidate(accountSnapshotProvider);
      if (context.mounted) {
        showFeedback(context, ok: session.email.isEmpty ? '登录成功' : '登录成功（${session.email}）');
      }
    } on AccountException catch (e) {
      if (e.toString().contains('已取消登录')) return;
      if (context.mounted) showFeedback(context, error: e);
    } catch (e) {
      if (context.mounted) showFeedback(context, error: e);
    }
  }
}

/// 浏览器登录按钮（备选入口，保持原有浏览器跳转登录能力）。
class _BrowserLoginButton extends ConsumerStatefulWidget {
  const _BrowserLoginButton({required this.onPressed});

  final Future<void> Function() onPressed;

  @override
  ConsumerState<_BrowserLoginButton> createState() => _BrowserLoginButtonState();
}

class _BrowserLoginButtonState extends ConsumerState<_BrowserLoginButton> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    return ShadButton.outline(
      enabled: !_busy,
      onPressed: _busy
          ? null
          : () async {
              setState(() => _busy = true);
              try {
                await widget.onPressed();
              } finally {
                if (mounted) setState(() => _busy = false);
              }
            },
      leading: _busy
          ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
          : const Icon(Icons.open_in_new, size: 15),
      child: Text(_busy ? '等待浏览器…' : '在浏览器中登录'),
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
    final updated = DateTime.fromMillisecondsSinceEpoch(snapshot.signedInAt);

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
              InfoRow('邮箱', snapshot.email, copyable: true),
              if (snapshot.userId.isNotEmpty) InfoRow('用户 ID', snapshot.userId, copyable: true),
              InfoRow(
                snapshot.viaDeviceLink ? '手机授权时间' : '登录时间',
                snapshot.signedInAt == 0 ? '' : _fmt(updated),
              ),
              InfoRow('登录方式', snapshot.viaDeviceLink ? '手机扫码授权' : '浏览器登录'),
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
              _Bullet('同一账号登录后自动互联：手机扫码授权，电脑端即出现在手机的工作电脑列表'),
              _Bullet('扫码登录不复制手机会话：电脑端持有独立的设备凭据，可单独退出'),
              _Bullet('手机端解绑后，电脑端重新扫码或点「绑定这台电脑」可恢复'),
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