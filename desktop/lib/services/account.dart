/// 账号登录：与手机 App 同一账号体系（auth.zhongbei.tech）。
///
/// 登录成功后把 session 写入 ~/.deepseek-harness-pocket/account-session.json：
/// - bridge 插件 uplink 每次连接 gateway 时读取 token 随 worker-register 上送，
///   gateway 验签后自动绑定账号（同账号手机端免扫码）；
/// - 本服务也可通过 REST `POST /api/v1/workers/bind` 主动绑定（hostKey 定位本机）。
///
/// token 过期由 refresh 处理（桌面端定时 / 打开控制台账号页时触发）。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart' show debugPrint;

import '../models.dart';
import 'paths.dart';

class AccountException implements Exception {
  const AccountException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// 账号绑定/登录态快照（账号页展示用）。
class AccountSnapshot {
  const AccountSnapshot({
    required this.session,
    required this.bound,
    required this.workerKnown,
  });

  final AccountSession session;

  /// 本机 Worker 是否已绑定到该账号（presence 中能按指纹匹配到）。
  final bool bound;

  /// gateway 侧是否注册过本机（hostKey 未注册时无法绑定）。
  final bool workerKnown;
}

class AccountService {
  AccountService(this._settings);

  final AppSettings Function() _settings;

  HttpClient? _client;
  HttpClient get _http {
    _client ??= HttpClient()..connectionTimeout = const Duration(seconds: 12);
    return _client!;
  }

  // ---------- 会话文件 ----------

  AccountSession? readSession() {
    try {
      final file = File(AppPaths.accountSessionFile);
      if (!file.existsSync()) return null;
      final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
      final session = AccountSession.fromJson(json);
      return session.token.isEmpty ? null : session;
    } catch (_) {
      return null;
    }
  }

  Future<void> _saveSession(AccountSession session) async {
    final file = File(AppPaths.accountSessionFile);
    await file.parent.create(recursive: true);
    await file.writeAsString(
      '${const JsonEncoder.withIndent('  ').convert(session.toJson())}\n',
      mode: FileMode.write,
      flush: true,
    );
    await _restrictPermissions(file);
  }

  /// POSIX 上收紧为 0600（Windows 无此语义，忽略失败）。
  Future<void> _restrictPermissions(File file) async {
    try {
      if (Platform.isMacOS || Platform.isLinux) {
        await Process.run('chmod', <String>['600', file.path]);
      }
    } catch (_) {}
  }

  Future<void> _clearSession() async {
    try {
      final file = File(AppPaths.accountSessionFile);
      if (file.existsSync()) await file.delete();
    } catch (_) {}
  }

  WorkerIdentity? readWorkerIdentity() {
    try {
      final file = File(AppPaths.bridgeStateFile);
      if (!file.existsSync()) return null;
      final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
      final identity = WorkerIdentity.fromJson(json);
      return identity.hostKey.isEmpty ? null : identity;
    } catch (_) {
      return null;
    }
  }

  // ---------- 登录 / 刷新 / 登出 ----------

  /// 邮箱（或用户名）+ 密码登录；成功即持久化会话。
  Future<AccountSession> signIn({required String identifier, required String password}) async {
    final data = await _authRequest(
      '/api/v1/auth/sign-in',
      body: {
        'identifier': identifier.trim(),
        'password': password,
        'deviceName': '${Platform.operatingSystem} · DSH Pocket Worker',
      },
    );
    final token = data['token'] as String?;
    final refresh = data['refreshToken'] as String?;
    if (token == null || token.isEmpty || refresh == null || refresh.isEmpty) {
      throw const AccountException('登录响应缺少凭证（服务端异常）');
    }
    final user = data['user'];
    final session = AccountSession(
      userId: user is Map<String, dynamic> ? (user['id'] as String? ?? '') : '',
      email: user is Map<String, dynamic>
          ? ((user['email'] as String?) ?? identifier.trim())
          : identifier.trim(),
      token: token,
      refreshToken: refresh,
      updatedAt: DateTime.now().millisecondsSinceEpoch,
    );
    await _saveSession(session);
    return session;
  }

  /// 用 refresh token 换新会话；会话失效返回 null（调用方决定是否清除 UI 态）。
  Future<AccountSession?> refresh() async {
    final current = readSession();
    if (current == null || current.refreshToken.isEmpty) return null;
    try {
      final data = await _authRequest(
        '/api/v1/auth/refresh',
        body: {'refreshToken': current.refreshToken},
      );
      final token = data['token'] as String?;
      final refresh = data['refreshToken'] as String?;
      if (token == null || token.isEmpty || refresh == null || refresh.isEmpty) return null;
      final next = AccountSession(
        userId: current.userId,
        email: current.email,
        token: token,
        refreshToken: refresh,
        updatedAt: DateTime.now().millisecondsSinceEpoch,
      );
      await _saveSession(next);
      return next;
    } on AccountException {
      return null;
    } catch (_) {
      return null;
    }
  }

  /// 登出：清本地会话（服务器端会话尽力撤销，失败不打断）。
  Future<void> signOut() async {
    try {
      await _authRequest('/api/v1/auth/sign-out', body: {}, auth: true, method: 'POST');
    } catch (_) {
      // 撤销失败不阻断本地登出
    }
    await _clearSession();
  }

  // ---------- 绑定 ----------

  /// 把本机 Worker 绑定到当前登录账号（免扫码）。
  /// 返回 gateway 的绑定结果信息；失败抛 [AccountException]。
  Future<String> bindThisWorker() async {
    final session = readSession();
    if (session == null) throw const AccountException('尚未登录');
    final identity = readWorkerIdentity();
    if (identity == null) {
      throw const AccountException('本机 Worker 标识不可用（请先启动一次 Worker）');
    }
    final data = await _authRequest(
      '/api/v1/workers/bind',
      body: {'hostKey': identity.hostKey},
      auth: true,
    );
    if (data['ok'] != true) {
      throw AccountException((data['reason'] as String?) ?? '绑定失败');
    }
    return (data['workerId'] as String?) ?? '';
  }

  /// 查询账号下 Worker 列表并按指纹判断本机绑定状态。
  Future<AccountSnapshot> snapshot() async {
    final session = readSession();
    if (session == null) {
      throw const AccountException('尚未登录');
    }
    final identity = readWorkerIdentity();
    var bound = false;
    var workerKnown = false;
    try {
      final data = await _authRequest('/api/v1/workers', auth: true, method: 'GET');
      final workers = (data['workers'] as List?) ?? const [];
      for (final w in workers) {
        if (w is Map<String, dynamic> && identity != null && w['hostFingerprint'] == identity.fingerprint) {
          // presence 只包含已绑定到本账号的 Worker：匹配到即视为已绑定
          bound = true;
          workerKnown = true;
        }
      }
    } on AccountException {
      rethrow;
    } catch (e) {
      // 连接中断等非预期异常：统一转成可读文案
      throw AccountException('网络异常：$e');
    }
    return AccountSnapshot(session: session, bound: bound, workerKnown: workerKnown);
  }

  // ---------- HTTP ----------

  Map<String, String> _headers({bool auth = false}) {
    final settings = _settings();
    return {
      'content-type': 'application/json',
      'X-App-Id': settings.authAppId,
      'X-App-Environment': settings.authAppEnvironment,
      'X-Platform': Platform.operatingSystem,
      'Accept-Language': 'zh-CN',
      if (auth)
        'Authorization': 'Bearer ${readSession()?.token ?? ''}',
    };
  }

  Future<Map<String, dynamic>> _authRequest(
    String path, {
    Map<String, dynamic> body = const {},
    bool auth = false,
    String method = 'POST',
  }) async {
    final base = _settings().authApiUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$base$path');
    debugPrint('[account] $method $path');
    HttpClientRequest request;
    try {
      request = await _http.openUrl(method, uri);
    } catch (_) {
      throw const AccountException('无法连接认证服务，请检查网络');
    }
    _headers(auth: auth).forEach(request.headers.set);
    if (method != 'GET') request.write(jsonEncode(body));
    final HttpClientResponse response;
    try {
      response = await request.close().timeout(const Duration(seconds: 12));
    } on TimeoutException {
      throw const AccountException('认证服务响应超时');
    }
    final text = await response.transform(utf8.decoder).join();
    Map<String, dynamic> decoded;
    try {
      decoded = jsonDecode(text) as Map<String, dynamic>;
    } catch (_) {
      throw AccountException('服务响应异常 (HTTP ${response.statusCode})');
    }
    if (response.statusCode >= 400 || decoded.containsKey('error')) {
      final err = decoded['error'];
      final message = err is Map<String, dynamic>
          ? ((err['message'] as String?) ?? '请求失败 (HTTP ${response.statusCode})')
          : '请求失败 (HTTP ${response.statusCode})';
      throw AccountException(message);
    }
    final data = decoded['data'];
    return data is Map<String, dynamic> ? data : decoded;
  }
}
