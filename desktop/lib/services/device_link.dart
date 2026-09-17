/// 扫码登录（手机授权）：桌面端「未登录 → 二维码 → 手机确认 → 已登录」的全过程。
///
/// 为什么不是「桌面端登录」：auth 服务（auth.zhongbei.tech）不签发跨设备会话，
/// 桌面端也拿不到账号密码。所以这里走 gateway 的设备授权：
/// 桌面端申请一次性链接码 → 二维码 → 手机 App（已登录该账号）扫码确认 →
/// gateway 把这台电脑绑定到手机账号，并给桌面端一枚**设备凭据**
/// （`dshl_<code>.<secret>`，180 天）。手机会话不会被共享，桌面端凭据也可随时吊销。
///
/// 凭据写入 ~/.deepseek-harness-pocket/device-link.json（0600），
/// 供控制台展示登录态、调 gateway 查绑定/解绑；不进 account-session.json
/// （那份是 auth 会话，bridge uplink 会读它的 token）。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart' show debugPrint;

import '../models.dart';
import 'paths.dart';

/// 扫码登录过程中的错误（文案直接可展示）。
class DeviceLinkException implements Exception {
  const DeviceLinkException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// 一次待确认的链接（二维码内容 + 轮询所需信息）。
class PendingDeviceLink {
  const PendingDeviceLink({
    required this.code,
    required this.secret,
    required this.expiresAt,
    required this.intervalMs,
  });

  final String code;
  final String secret;

  /// epoch ms。
  final int expiresAt;
  final int intervalMs;

  /// 二维码文本：与 packages/bridge-protocol/src/device-link.ts 的
  /// buildDeviceLinkQr 同一格式（改动需同步两侧）。
  String qrText({String? name, String? platform, String? gateway}) {
    final parts = <String>['v=1', 'c=${Uri.encodeComponent(code)}'];
    if (name != null && name.isNotEmpty) parts.add('h=${Uri.encodeComponent(name)}');
    if (platform != null && platform.isNotEmpty) parts.add('p=${Uri.encodeComponent(platform)}');
    if (gateway != null && gateway.isNotEmpty) parts.add('gw=${Uri.encodeComponent(gateway)}');
    return 'dshp://link?${parts.join('&')}';
  }

  int get remainingSeconds {
    final left = expiresAt - DateTime.now().millisecondsSinceEpoch;
    return left <= 0 ? 0 : (left / 1000).ceil();
  }

  bool get expired => remainingSeconds == 0;
}

/// 已完成的扫码登录（持久化在 device-link.json）。
class DeviceLink {
  const DeviceLink({
    required this.userId,
    required this.email,
    required this.credential,
    required this.code,
    required this.workerId,
    required this.linkedAt,
  });

  final String userId;
  final String email;

  /// gateway 设备凭据，作为 Bearer 调用 /api/v1/*（见 gateway authUser）。
  final String credential;

  /// 链接码（吊销时定位记录）。
  final String code;
  final String workerId;

  /// epoch ms。
  final int linkedAt;

  factory DeviceLink.fromJson(Map<String, dynamic> json) => DeviceLink(
        userId: (json['userId'] as String?) ?? '',
        email: (json['email'] as String?) ?? '',
        credential: (json['credential'] as String?) ?? '',
        code: (json['code'] as String?) ?? '',
        workerId: (json['workerId'] as String?) ?? '',
        linkedAt: (json['linkedAt'] as num?)?.toInt() ?? 0,
      );

  Map<String, dynamic> toJson() => {
        'version': 1,
        'userId': userId,
        'email': email,
        'credential': credential,
        'code': code,
        'workerId': workerId,
        'linkedAt': linkedAt,
      };

  /// 用于展示的账号标识（邮箱缺失时退到 userId 短号）。
  String get display => email.isNotEmpty
      ? email
      : (userId.isEmpty ? '已登录' : '账号 ${userId.substring(0, userId.length >= 8 ? 8 : userId.length)}');
}

/// 轮询结果。
sealed class DeviceLinkPollResult {
  const DeviceLinkPollResult();
}

class DeviceLinkPending extends DeviceLinkPollResult {
  const DeviceLinkPending();
}

class DeviceLinkExpired extends DeviceLinkPollResult {
  const DeviceLinkExpired();
}

class DeviceLinkApproved extends DeviceLinkPollResult {
  const DeviceLinkApproved(this.link);
  final DeviceLink link;
}

class DeviceLinkService {
  DeviceLinkService(this._settings);

  final AppSettings Function() _settings;

  HttpClient? _client;
  HttpClient get _http {
    _client ??= HttpClient()..connectionTimeout = const Duration(seconds: 12);
    return _client!;
  }

  /// gateway REST 基地址：settings.gatewayUrl 是 `wss://host/gw/worker`，
  /// REST 同源（`https://host/api/v1/...`）。
  String get gatewayBase {
    var url = _settings().gatewayUrl.trim();
    if (url.isEmpty) return '';
    url = url.replaceFirst(RegExp(r'^ws://'), 'http://').replaceFirst(RegExp(r'^wss://'), 'https://');
    final uri = Uri.tryParse(url);
    if (uri == null || uri.host.isEmpty) return '';
    return '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}';
  }

  // ---------- 本地凭据 ----------

  DeviceLink? read() {
    try {
      final file = File(AppPaths.deviceLinkFile);
      if (!file.existsSync()) return null;
      final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
      final link = DeviceLink.fromJson(json);
      return link.credential.isEmpty ? null : link;
    } catch (_) {
      return null;
    }
  }

  Future<void> _save(DeviceLink link) async {
    final file = File(AppPaths.deviceLinkFile);
    await file.parent.create(recursive: true);
    await file.writeAsString(
      '${const JsonEncoder.withIndent('  ').convert(link.toJson())}\n',
      mode: FileMode.write,
      flush: true,
    );
    try {
      if (Platform.isMacOS || Platform.isLinux) {
        await Process.run('chmod', <String>['600', file.path]);
      }
    } catch (_) {}
  }

  Future<void> _clear() async {
    try {
      final file = File(AppPaths.deviceLinkFile);
      if (file.existsSync()) await file.delete();
    } catch (_) {}
  }

  // ---------- 流程 ----------

  /// 步骤 1：向 gateway 申请一次性链接码（二维码内容来源）。
  Future<PendingDeviceLink> start({required WorkerIdentity identity, String name = ''}) async {
    final base = gatewayBase;
    if (base.isEmpty) throw const DeviceLinkException('gateway 地址不可用，无法发起扫码登录');
    final data = await _request(
      '$base/api/v1/devices/link/start',
      body: {
        'hostKey': identity.hostKey,
        'name': name,
        'platform': Platform.operatingSystem,
      },
    );
    final code = (data['code'] as String?) ?? '';
    final secret = (data['secret'] as String?) ?? '';
    if (code.isEmpty || secret.isEmpty) {
      throw const DeviceLinkException('服务返回的链接码无效，请重试');
    }
    return PendingDeviceLink(
      code: code,
      secret: secret,
      expiresAt: (data['expiresAt'] as num?)?.toInt() ??
          DateTime.now().millisecondsSinceEpoch + 5 * 60 * 1000,
      intervalMs: (data['intervalMs'] as num?)?.toInt() ?? 2000,
    );
  }

  /// 步骤 3：轮询是否已被手机确认；确认后落盘并返回。
  Future<DeviceLinkPollResult> poll(PendingDeviceLink pending) async {
    final base = gatewayBase;
    if (base.isEmpty) throw const DeviceLinkException('gateway 地址不可用');
    if (pending.expired) return const DeviceLinkExpired();
    final data = await _request(
      '$base/api/v1/devices/link/poll',
      body: {'code': pending.code, 'secret': pending.secret},
    );
    switch ((data['status'] as String?) ?? 'pending') {
      case 'approved':
        final account = (data['account'] as Map?)?.cast<String, dynamic>() ?? const {};
        final link = DeviceLink(
          userId: (account['userId'] as String?) ?? '',
          email: (account['email'] as String?) ?? '',
          credential: (data['credential'] as String?) ?? '',
          code: pending.code,
          workerId: (data['workerId'] as String?) ?? '',
          linkedAt: DateTime.now().millisecondsSinceEpoch,
        );
        if (link.credential.isEmpty) {
          throw const DeviceLinkException('服务未返回设备凭据，请重新扫码');
        }
        await _save(link);
        return DeviceLinkApproved(link);
      case 'expired':
        return const DeviceLinkExpired();
      default:
        return const DeviceLinkPending();
    }
  }

  /// 退出登录：解绑这台电脑并作废设备凭据（服务端失败也让本地登出）。
  Future<void> revoke() async {
    final link = read();
    final base = gatewayBase;
    if (link != null && base.isNotEmpty) {
      final dot = link.credential.indexOf('.');
      if (dot > 0) {
        try {
          await _request(
            '$base/api/v1/devices/link/revoke',
            body: {'code': link.code, 'secret': link.credential.substring(dot + 1)},
          );
        } catch (e) {
          debugPrint('[device-link] revoke failed: $e');
        }
      }
    }
    await _clear();
  }

  // ---------- HTTP ----------

  Future<Map<String, dynamic>> _request(
    String url, {
    required Map<String, dynamic> body,
  }) async {
    HttpClientRequest request;
    try {
      request = await _http.postUrl(Uri.parse(url));
    } catch (_) {
      throw const DeviceLinkException('无法连接服务，请检查网络');
    }
    request.headers.set('content-type', 'application/json');
    request.headers.set('X-App-Id', _settings().authAppId);
    request.headers.set('X-App-Environment', _settings().authAppEnvironment);
    request.headers.set('X-Platform', Platform.operatingSystem);
    request.write(jsonEncode(body));
    final HttpClientResponse response;
    try {
      response = await request.close().timeout(const Duration(seconds: 12));
    } on TimeoutException {
      throw const DeviceLinkException('服务响应超时，请重试');
    }
    final text = await response.transform(utf8.decoder).join();
    Map<String, dynamic> decoded;
    try {
      decoded = jsonDecode(text) as Map<String, dynamic>;
    } catch (_) {
      throw DeviceLinkException('服务响应异常 (HTTP ${response.statusCode})');
    }
    if (response.statusCode >= 400) {
      throw DeviceLinkException(
        (decoded['error'] as String?) ??
            (decoded['reason'] as String?) ??
            '请求失败 (HTTP ${response.statusCode})',
      );
    }
    return decoded;
  }
}