/// 扫码登录「活体」集成测试：直接打真实运行的 gateway。
///
/// 默认跳过（避免 CI 依赖外部服务）；本地验证方式：
///   1. 起 gateway：cd gateway && pnpm dev（或 tsx server.ts，.env 指向本地 PG）
///   2. 跑本测试：
///      DSH_TEST_GATEWAY=http://127.0.0.1:3781 \
///      DSH_TEST_WORKER_HOSTKEY=hk_xxx \
///      flutter test test/device_link_live_test.dart
///
/// 覆盖：gatewayBase 从 ws(s):// 的推导、start/poll/revoke 的真实往返与错误映射、
/// 以及「手机 approve（dev 放行）→ 桌面端拿到设备凭据」的完整链路。
library;

import 'dart:convert';
import 'dart:io';

import 'package:desktop/models.dart';
import 'package:desktop/services/device_link.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final base = Platform.environment['DSH_TEST_GATEWAY'] ?? '';
  final hostKey = Platform.environment['DSH_TEST_WORKER_HOSTKEY'] ?? '';
  final skipReason = base.isEmpty
      ? '未设置 DSH_TEST_GATEWAY，跳过活体测试'
      : (hostKey.isEmpty ? '未设置 DSH_TEST_WORKER_HOSTKEY（需已在 gateway 注册的电脑）' : null);

  group('device link 活体流程', () {
    test('start → pending → approve → approved（含设备凭据）→ revoke', () async {
      // ws:// 形式的 gateway 地址应推导出 http:// REST 基地址
      final settings = AppSettings.defaults()
        ..gatewayUrl = '${base.replaceFirst(RegExp(r'^http'), 'ws')}/gw/worker';
      final svc = DeviceLinkService(() => settings);
      expect(svc.gatewayBase, base);

      final identity = WorkerIdentity(hostKey: hostKey, fingerprint: 'fp_live_test');
      final pending = await svc.start(identity: identity, name: 'flutter-live-test');
      expect(pending.code.length, 8);
      expect(pending.secret.length, 64);
      expect(pending.expired, isFalse);

      expect(await svc.poll(pending), isA<DeviceLinkPending>());

      // 模拟手机：拿自己的会话 token 调 approve（本地 gateway NODE_ENV=development，
      // dev:<userId> 走开发放行；生产由 auth JWT 承担）
      final approve = await _post('$base/api/v1/devices/link/approve', {
        'code': pending.code,
        'email': 'live@example.com',
      }, bearer: 'dev:user_live_test');
      expect(approve.statusCode, 200, reason: approve.body);

      final result = await svc.poll(pending);
      expect(result, isA<DeviceLinkApproved>());
      final link = (result as DeviceLinkApproved).link;
      expect(link.userId, 'user_live_test');
      expect(link.email, 'live@example.com');
      expect(link.credential, startsWith('dshl_${pending.code}.'));

      await svc.revoke();
      // 吊销后凭据不可再用
      final after = await _get('$base/api/v1/workers', bearer: link.credential);
      expect(after.statusCode, 401);
    }, skip: skipReason);

    test('未知 hostKey：approve 被拒（电脑未注册）', () async {
      final settings = AppSettings.defaults()
        ..gatewayUrl = '${base.replaceFirst(RegExp(r'^http'), 'ws')}/gw/worker';
      final svc = DeviceLinkService(() => settings);
      final pending = await svc.start(
        identity: const WorkerIdentity(hostKey: 'hk_never_registered', fingerprint: 'x'),
      );
      final approve = await _post('$base/api/v1/devices/link/approve', {
        'code': pending.code,
      }, bearer: 'dev:user_live_test');
      expect(approve.statusCode, 422);
      expect(approve.body, contains('Worker 不存在'));
    }, skip: skipReason);
  });
}

Future<({int statusCode, String body})> _post(
  String url,
  Map<String, dynamic> body, {
  String? bearer,
}) async {
  final client = HttpClient();
  try {
    final request = await client.postUrl(Uri.parse(url));
    request.headers.set('content-type', 'application/json');
    if (bearer != null) request.headers.set('authorization', 'Bearer $bearer');
    request.write(jsonEncode(body));
    final response = await request.close();
    final text = await response.transform(utf8.decoder).join();
    return (statusCode: response.statusCode, body: text);
  } finally {
    client.close(force: true);
  }
}

Future<({int statusCode, String body})> _get(String url, {String? bearer}) async {
  final client = HttpClient();
  try {
    final request = await client.getUrl(Uri.parse(url));
    if (bearer != null) request.headers.set('authorization', 'Bearer $bearer');
    final response = await request.close();
    final text = await response.transform(utf8.decoder).join();
    return (statusCode: response.statusCode, body: text);
  } finally {
    client.close(force: true);
  }
}