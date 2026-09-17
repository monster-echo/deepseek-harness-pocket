/// 账号页组件测试：未登录 → 二维码卡片 → 手机确认 → 切换为账号卡片。
///
/// 用假的 DeviceLinkService 顶掉真实 HTTP，专门验证「界面接线」：
/// 进入即申请链接码、渲染二维码、轮询到 approved 后刷新登录态并换卡片。
/// 真实 HTTP 往返另见 test/device_link_live_test.dart。
library;

import 'package:desktop/models.dart';
import 'package:desktop/providers.dart';
import 'package:desktop/services/account.dart';
import 'package:desktop/services/device_link.dart';
import 'package:desktop/ui/pages/account_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

/// 假服务：记录调用，按脚本返回 pending → approved。
class _FakeDeviceLinkService extends DeviceLinkService {
  _FakeDeviceLinkService() : super(AppSettings.defaults);

  int startCalls = 0;
  int pollCalls = 0;
  DeviceLink? stored;

  @override
  String get gatewayBase => 'https://gateway.test';

  @override
  Future<PendingDeviceLink> start({
    required WorkerIdentity identity,
    String name = '',
  }) async {
    startCalls += 1;
    expect(identity.hostKey, 'hk_widget_test');
    return PendingDeviceLink(
      code: 'WIDGET23',
      secret: 's' * 64,
      expiresAt: DateTime.now().millisecondsSinceEpoch + 60000,
      // 轮询间隔压到最小，测试里很快能跑到 approved
      intervalMs: 1,
    );
  }

  @override
  Future<DeviceLinkPollResult> poll(PendingDeviceLink pending) async {
    pollCalls += 1;
    if (pollCalls < 2) return const DeviceLinkPending();
    final link = DeviceLink(
      userId: 'u_widget',
      email: 'widget@example.com',
      credential: 'dshl_WIDGET23.${'s' * 64}',
      code: pending.code,
      workerId: 'w_widget',
      linkedAt: DateTime.now().millisecondsSinceEpoch,
    );
    stored = link;
    return DeviceLinkApproved(link);
  }

  @override
  DeviceLink? read() => stored;

  @override
  Future<void> revoke() async {
    stored = null;
  }
}

/// 假账号服务：本机身份可用，且查询绑定状态返回「已绑定」。
class _FakeAccountService extends AccountService {
  _FakeAccountService(DeviceLinkService links)
      : super(AppSettings.defaults, () => links.read()?.credential, () => links.read());

  @override
  WorkerIdentity? readWorkerIdentity() =>
      const WorkerIdentity(hostKey: 'hk_widget_test', fingerprint: 'fp_widget_test');

  @override
  AccountSession? readSession() => null;

  @override
  Future<AccountSnapshot> snapshot() async {
    final link = _links.read()!;
    return AccountSnapshot(
      userId: link.userId,
      email: link.email,
      bound: true,
      workerKnown: true,
      viaDeviceLink: true,
      signedInAt: link.linkedAt,
    );
  }

  DeviceLinkService get _links => _injected!;

  static DeviceLinkService? _injected;
}

void main() {
  late _FakeDeviceLinkService links;

  setUp(() {
    links = _FakeDeviceLinkService();
    _FakeAccountService._injected = links;
  });

  Future<void> pumpAccountPage(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          deviceLinkServiceProvider.overrideWithValue(links),
          accountServiceProvider.overrideWithValue(_FakeAccountService(links)),
          // 镜像真实 accountSnapshotProvider 的逻辑（假服务下）：无链接 → null
          accountSnapshotProvider.overrideWith((ref) async {
            final link = ref.watch(deviceLinkProvider);
            if (link == null) return null;
            return AccountSnapshot(
              userId: link.userId,
              email: link.email,
              bound: true,
              workerKnown: true,
              viaDeviceLink: true,
              signedInAt: link.linkedAt,
            );
          }),
          settingsProvider.overrideWith(() => _FixedSettings()),
          appInfoProvider.overrideWith(
            (ref) async => PackageInfo(
              appName: 'DSH Pocket',
              packageName: 'top.rwecho.test',
              version: '0.1.8',
              buildNumber: '1',
            ),
          ),
        ],
        child: const ShadApp(home: Scaffold(body: AccountPage())),
      ),
    );
    // 首帧 + postFrameCallback（发起 start）
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }

  testWidgets('未登录：显示二维码卡片并申请链接码', (tester) async {
    await pumpAccountPage(tester);

    expect(links.startCalls, 1);
    expect(find.text('手机扫码登录'), findsOneWidget);
    expect(find.byType(QrImageView), findsOneWidget);
    // 链接码上屏（便于手输/核对）。二维码内容本身由 test/device_link_test.dart
    // 的 golden 断言锁住（QrImageView 不暴露 data，故不在此重复断言）。
    expect(find.textContaining('WIDGET23'), findsOneWidget);
    expect(find.textContaining('重新生成二维码'), findsOneWidget);
  });

  testWidgets('手机确认后：轮询拿到凭据并切换为账号卡片', (tester) async {
    await pumpAccountPage(tester);
    expect(find.byType(QrImageView), findsOneWidget);

    // 让轮询跑两拍：轮询最小间隔 800ms（防抖），第 2 拍返回 approved
    await tester.pump(const Duration(milliseconds: 900));
    await tester.pump(const Duration(milliseconds: 900));
    await tester.pump(const Duration(milliseconds: 100));

    expect(links.pollCalls, greaterThanOrEqualTo(2));
    expect(links.stored, isNotNull);
    expect(find.byType(QrImageView), findsNothing);
    expect(find.text('手机扫码授权'), findsOneWidget);
    expect(find.text('widget@example.com'), findsOneWidget);
    expect(find.text('已绑定'), findsOneWidget);
  });

  testWidgets('本机身份不可用：给出可操作提示且不发请求', (tester) async {
    final saved = _FakeAccountService._injected;
    addTearDown(() => _FakeAccountService._injected = saved);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          deviceLinkServiceProvider.overrideWithValue(links),
          accountServiceProvider.overrideWithValue(_NoIdentityAccountService(links)),
          accountSnapshotProvider.overrideWith((ref) async => null),
          settingsProvider.overrideWith(() => _FixedSettings()),
          appInfoProvider.overrideWith(
            (ref) async => PackageInfo(
              appName: 'DSH Pocket',
              packageName: 'top.rwecho.test',
              version: '0.1.8',
              buildNumber: '1',
            ),
          ),
        ],
        child: const ShadApp(home: Scaffold(body: AccountPage())),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(links.startCalls, 0);
    expect(find.textContaining('本机服务标识不可用'), findsOneWidget);
  });
}

/// 固定设置（避免测试读写真实 HOME 下的 desktop-settings.json）。
class _FixedSettings extends SettingsNotifier {
  @override
  AppSettings build() => AppSettings.defaults()..workerName = 'UI 测试机';
}

/// 身份缺失场景。
class _NoIdentityAccountService extends AccountService {
  _NoIdentityAccountService(DeviceLinkService links)
      : super(AppSettings.defaults, () => null, () => links.read());

  @override
  WorkerIdentity? readWorkerIdentity() => null;

  @override
  AccountSession? readSession() => null;
}