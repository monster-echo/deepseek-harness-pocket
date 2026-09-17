/// 扫码登录的桌面端单元测试：二维码文本与设置持久化的跨语言契约。
///
/// 二维码格式的「真源」在 packages/bridge-protocol/src/device-link.ts（手机端解析），
/// 这里是 Dart 侧的镜像实现，用同一组 golden 字符串锁住两侧一致——
/// 一旦有人在 TS 侧改了格式（键名/编码），这些断言会立刻失败。
library;

import 'dart:convert';

import 'package:desktop/models.dart';
import 'package:desktop/services/device_link.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('二维码文本格式（与 bridge-protocol buildDeviceLinkQr 对齐）', () {
    test('全字段', () {
      final pending = PendingDeviceLink(
        code: 'ABCD2345',
        secret: 'x' * 64,
        expiresAt: DateTime.now().millisecondsSinceEpoch + 60000,
        intervalMs: 2000,
      );
      expect(
        pending.qrText(
          name: 'Mac mini',
          platform: 'darwin',
          gateway: 'https://dsh-pocket.zhongbei.tech',
        ),
        'dshp://link?v=1&c=ABCD2345&h=Mac%20mini&p=darwin'
        '&gw=https%3A%2F%2Fdsh-pocket.zhongbei.tech',
      );
    });

    test('只有 code 时省略可选字段', () {
      final pending = PendingDeviceLink(
        code: 'ABCD2345',
        secret: 'x' * 64,
        expiresAt: DateTime.now().millisecondsSinceEpoch + 60000,
        intervalMs: 2000,
      );
      expect(pending.qrText(), 'dshp://link?v=1&c=ABCD2345');
    });

    test('二维码里不能出现 secret（只带一次性 code）', () {
      final pending = PendingDeviceLink(
        code: 'ABCD2345',
        secret: 'super-secret-value',
        expiresAt: DateTime.now().millisecondsSinceEpoch + 60000,
        intervalMs: 2000,
      );
      expect(pending.qrText(name: 'x'), isNot(contains('super-secret-value')));
    });

    test('有效期倒计时与过期判定', () {
      final fresh = PendingDeviceLink(
        code: 'ABCD2345',
        secret: 's',
        expiresAt: DateTime.now().millisecondsSinceEpoch + 5000,
        intervalMs: 2000,
      );
      expect(fresh.expired, isFalse);
      expect(fresh.remainingSeconds, inInclusiveRange(1, 5));

      final dead = PendingDeviceLink(
        code: 'ABCD2345',
        secret: 's',
        expiresAt: DateTime.now().millisecondsSinceEpoch - 1,
        intervalMs: 2000,
      );
      expect(dead.expired, isTrue);
      expect(dead.remainingSeconds, 0);
    });
  });

  group('设备凭据持久化', () {
    test('DeviceLink 往返 JSON 不丢字段', () {
      const link = DeviceLink(
        userId: 'u_1',
        email: 'me@example.com',
        credential: 'dshl_ABCD2345.deadbeef',
        code: 'ABCD2345',
        workerId: 'w_1',
        linkedAt: 1700000000000,
      );
      final back = DeviceLink.fromJson(jsonDecode(jsonEncode(link.toJson())) as Map<String, dynamic>);
      expect(back.userId, 'u_1');
      expect(back.email, 'me@example.com');
      expect(back.credential, 'dshl_ABCD2345.deadbeef');
      expect(back.code, 'ABCD2345');
      expect(back.workerId, 'w_1');
      expect(back.linkedAt, 1700000000000);
    });

    test('展示名：有邮箱用邮箱，没有则退到 userId 短号', () {
      const withEmail = DeviceLink(
        userId: 'u_1',
        email: 'me@example.com',
        credential: 'c',
        code: 'C',
        workerId: 'w',
        linkedAt: 0,
      );
      expect(withEmail.display, 'me@example.com');

      const noEmail = DeviceLink(
        userId: '2903b030-65b7-482b-af23-a47ea7c8da18',
        email: '',
        credential: 'c',
        code: 'C',
        workerId: 'w',
        linkedAt: 0,
      );
      expect(noEmail.display, '账号 2903b030');
    });
  });

  group('控制台侧栏设置持久化', () {
    test('默认宽度够用（不再是被挤扁的 128）', () {
      expect(AppSettings.defaults().consoleSidebarWidth, 176.0);
      expect(AppSettings.defaults().consoleSidebarCollapsed, isFalse);
    });

    test('宽度与折叠态往返 JSON', () {
      final settings = AppSettings.defaults().copyWith(
        consoleSidebarWidth: 240,
        consoleSidebarCollapsed: true,
      );
      final back = AppSettings.fromJson(
        jsonDecode(jsonEncode(settings.toJson())) as Map<String, dynamic>,
      );
      expect(back.consoleSidebarWidth, 240);
      expect(back.consoleSidebarCollapsed, isTrue);
    });

    test('越界/缺失的宽度回落到默认值（手改配置也不会把界面弄坏）', () {
      final tooSmall = AppSettings.fromJson({'consoleSidebarWidth': 20});
      expect(tooSmall.consoleSidebarWidth, AppSettings.defaultConsoleSidebarWidth);

      final tooLarge = AppSettings.fromJson({'consoleSidebarWidth': 9999});
      expect(tooLarge.consoleSidebarWidth, AppSettings.defaultConsoleSidebarWidth);

      final missing = AppSettings.fromJson({});
      expect(missing.consoleSidebarWidth, AppSettings.defaultConsoleSidebarWidth);

      final ok = AppSettings.fromJson({
        'consoleSidebarWidth': AppSettings.consoleSidebarMaxWidth,
      });
      expect(ok.consoleSidebarWidth, AppSettings.consoleSidebarMaxWidth);
    });

    test('旧配置（没有侧栏字段）仍可加载，且不丢原有字段', () {
      final legacy = AppSettings.fromJson({
        'gatewayUrl': 'wss://example.test/gw/worker',
        'port': 3780,
        'dshMode': 'managed',
        'managedVersion': '0.1.5-rc.1',
      });
      expect(legacy.gatewayUrl, 'wss://example.test/gw/worker');
      expect(legacy.managedVersion, '0.1.5-rc.1');
      expect(legacy.consoleSidebarWidth, AppSettings.defaultConsoleSidebarWidth);
      expect(legacy.consoleSidebarCollapsed, isFalse);
    });
  });

  group('会话可用性判定（「登录了却不显示」的根因）', () {
    test('只有过期 token、没有 refreshToken → 不可用', () {
      // 与本机实际残留的 account-session.json 同形：iat/exp 相差 30 分钟
      final jwt = _jwt(exp: DateTime.now().subtract(const Duration(hours: 1)));
      final session = AccountSession(
        userId: '',
        email: '',
        token: jwt,
        refreshToken: '',
        updatedAt: 0,
      );
      expect(session.isExpired, isTrue);
      expect(session.usable, isFalse);
    });

    test('过期但有 refreshToken → 仍可用（可续期）', () {
      final session = AccountSession(
        userId: 'u',
        email: 'me@example.com',
        token: _jwt(exp: DateTime.now().subtract(const Duration(minutes: 5))),
        refreshToken: 'rt',
        updatedAt: 0,
      );
      expect(session.isExpired, isTrue);
      expect(session.usable, isTrue);
    });

    test('未过期 → 可用；解析不出的 token 不武断判死', () {
      final valid = AccountSession(
        userId: 'u',
        email: 'me@example.com',
        token: _jwt(exp: DateTime.now().add(const Duration(minutes: 20))),
        refreshToken: '',
        updatedAt: 0,
      );
      expect(valid.usable, isTrue);

      const opaque = AccountSession(
        userId: 'u',
        email: 'me@example.com',
        token: 'not-a-jwt',
        refreshToken: '',
        updatedAt: 0,
      );
      expect(opaque.isExpired, isFalse);
      expect(opaque.usable, isTrue);
    });
  });
}

/// 造一个只带 exp 的假 JWT（签名段无意义，解析端不验签）。
String _jwt({required DateTime exp}) {
  String seg(Map<String, dynamic> json) =>
      base64Url.encode(utf8.encode(jsonEncode(json))).replaceAll('=', '');
  return '${seg({'alg': 'RS256'})}.${seg({'exp': exp.millisecondsSinceEpoch ~/ 1000})}.sig';
}