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
import 'dart:math';

import 'package:flutter/foundation.dart' show debugPrint;

import '../models.dart';
import 'device_link.dart';
import 'paths.dart';
import 'proc.dart';

class AccountException implements Exception {
  const AccountException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// 账号绑定/登录态快照（账号页展示用）。
class AccountSnapshot {
  const AccountSnapshot({
    required this.userId,
    required this.email,
    required this.bound,
    required this.workerKnown,
    this.viaDeviceLink = false,
    this.signedInAt = 0,
  });

  final String userId;
  final String email;

  /// 本机 Worker 是否已绑定到该账号（presence 中能按指纹匹配到）。
  final bool bound;

  /// gateway 侧是否注册过本机（hostKey 未注册时无法绑定）。
  final bool workerKnown;

  /// true = 手机扫码授权登录（gateway 设备凭据）；
  /// false = 浏览器登录（auth 会话，见 account-session.json）。
  final bool viaDeviceLink;

  /// 登录/授权时间（epoch ms，展示用）。
  final int signedInAt;

  /// 展示用账号标识（邮箱缺失时退到 userId 短号）。
  String get display => email.isNotEmpty
      ? email
      : (userId.isEmpty
          ? '已登录'
          : '账号 ${userId.substring(0, userId.length >= 8 ? 8 : userId.length)}');
}

/// 读 auth 会话文件（静态版）：给「凭据解析」这类无需服务实例的场景用，
/// 避免 provider 自引用（见 providers.dart accountServiceProvider）。
AccountSession? readAccountSession() {
  try {
    final file = File(AppPaths.accountSessionFile);
    if (!file.existsSync()) return null;
    final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    final session = AccountSession.fromJson(json);
    if (session.token.isEmpty) return null;
    // 过期且无法续期的会话文件（历史遗留：只有 token、没有 refreshToken）
    // 视为未登录：否则界面会显示一个没有邮箱、绑定态也查不动的「假登录」，
    // 用户看到的就是「登录了却不显示」。
    if (!session.usable) {
      debugPrint('[account] 本地会话已失效且无法续期，按未登录处理');
      try {
        if (file.existsSync()) file.deleteSync();
      } catch (_) {}
      return null;
    }
    return session;
  } catch (_) {
    return null;
  }
}

/// 账号会话服务：auth 会话（浏览器登录）+ gateway 设备凭据（扫码登录）。
///
/// [credential] 给出当前用于 REST 的 Bearer：优先 auth 会话 token，
/// 没有会话时回落到扫码登录的设备凭据（两者 gateway 侧都认，见 api.ts authUser）。
class AccountService {
  AccountService(this._settings, this._credential, this._deviceLink);

  final AppSettings Function() _settings;
  final String? Function() _credential;
  final DeviceLink? Function() _deviceLink;

  HttpClient? _client;
  HttpClient get _http {
    _client ??= HttpClient()..connectionTimeout = const Duration(seconds: 12);
    return _client!;
  }

  // ---------- 会话文件 ----------

  AccountSession? readSession() => readAccountSession();

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

  static const _loginPreferredPort = 37900;
  static const _loginTimeout = Duration(minutes: 5);

  HttpServer? _loginServer;
  Completer<AccountSession>? _loginCompleter;

  /// 是否有浏览器登录流程进行中。
  bool get loginInProgress =>
      _loginCompleter != null && !_loginCompleter!.isCompleted;

  /// 浏览器登录（loopback 回调，不在应用内收集账号密码）：
  ///
  /// 1. 本地起一次性回调服务 `http://127.0.0.1:<port>/callback`
  ///    （优先 37900，被占用则自动换随机端口）；
  /// 2. 打开系统浏览器到 `{authApiUrl}/login?redirect_uri=…&state=…`；
  /// 3. 用户在网页完成登录后，auth 服务重定向到
  ///    `redirect_uri?state=…&token=…&refresh_token=…`（可选 user_id/email）；
  /// 4. 校验 state、保存会话、回调页提示成功，登录完成。
  ///
  /// auth 服务需支持的契约（见 desktop/README.md「浏览器登录」）：
  /// 登录页识别 `redirect_uri`（仅放行 http://127.0.0.1:*），
  /// 登录成功后 302 回该地址并携带会话参数。
  Future<AccountSession> loginViaBrowser() async {
    if (loginInProgress) throw const AccountException('已有登录流程进行中，请先取消');
    final completer = Completer<AccountSession>();
    _loginCompleter = completer;
    HttpServer? server;
    try {
      try {
        server = await HttpServer.bind(InternetAddress.loopbackIPv4, _loginPreferredPort);
      } on SocketException {
        server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      }
      _loginServer = server;
      final state = _randomState();
      final redirectUri = 'http://127.0.0.1:${server.port}/callback';
      final base = _settings().authApiUrl.replaceAll(RegExp(r'/+$'), '');
      final loginUrl =
          '$base/login?redirect_uri=${Uri.encodeComponent(redirectUri)}&state=$state';

      server.listen((HttpRequest request) async {
        try {
          if (request.uri.path != '/callback') {
            request.response.statusCode = 404;
            await request.response.close();
            return;
          }
          final q = request.uri.queryParameters;
          if (q['state'] != state) {
            request.response.statusCode = 400;
            await request.response.close();
            _failLogin(const AccountException('登录回调校验失败（state 不匹配），请重试'));
            return;
          }
          final token = q['token'] ?? '';
          final refreshToken = q['refresh_token'] ?? q['refreshToken'] ?? '';
          if (token.isEmpty || refreshToken.isEmpty) {
            request.response.statusCode = 400;
            await request.response.close();
            _failLogin(const AccountException('登录回调缺少凭证（token / refresh_token），请确认认证服务已支持桌面登录跳转'));
            return;
          }
          final session = AccountSession(
            userId: q['user_id'] ?? q['userId'] ?? '',
            email: q['email'] ?? '',
            token: token,
            refreshToken: refreshToken,
            updatedAt: DateTime.now().millisecondsSinceEpoch,
          );
          await _saveSession(session);
          request.response.headers.contentType = ContentType.html;
          request.response.write(_loginCallbackHtml);
          await request.response.close();
          if (!completer.isCompleted) completer.complete(session);
        } catch (e) {
          _failLogin(AccountException('登录回调处理失败：$e'));
        } finally {
          _shutdownLoginServer();
        }
      }, onError: (Object _) {
        _failLogin(const AccountException('本地回调服务异常，请重试'));
      });

      await openInBrowser(loginUrl);
      return await completer.future.timeout(
        _loginTimeout,
        onTimeout: () {
          _shutdownLoginServer();
          throw const AccountException('登录超时（5 分钟），请重试');
        },
      );
    } on AccountException {
      _shutdownLoginServer();
      rethrow;
    } catch (e) {
      _shutdownLoginServer();
      throw AccountException('无法发起浏览器登录：$e');
    } finally {
      if (!loginInProgress) _loginCompleter = null;
    }
  }

  /// 取消进行中的浏览器登录。
  void cancelBrowserLogin() {
    _failLogin(const AccountException('已取消登录'));
    _shutdownLoginServer();
  }

  void _failLogin(AccountException error) {
    final completer = _loginCompleter;
    if (completer != null && !completer.isCompleted) {
      completer.completeError(error);
    }
  }

  void _shutdownLoginServer() {
    _loginServer?.close(force: true);
    _loginServer = null;
  }

  String _randomState() {
    final random = Random.secure();
    return List.generate(16, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }

  static const _loginCallbackHtml = '''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DSH Pocket 登录成功</title>
<style>body{font-family:-apple-system,'PingFang SC',sans-serif;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#09090b;color:#fafafa}
div{text-align:center}h1{font-size:20px}p{color:#a1a1aa;font-size:14px}</style></head>
<body><div><h1>✓ 登录成功</h1><p>请回到 DSH Pocket 应用继续使用，本页面可以关闭。</p></div></body></html>''';

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
  /// 扫码登录的设备凭据由 DeviceLinkService.revoke 处理（见控制台账号页）。
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
    if (_credential() == null || _credential()!.isEmpty) {
      throw const AccountException('尚未登录');
    }
    final identity = readWorkerIdentity();
    if (identity == null) {
      throw const AccountException('本机服务标识不可用（请先启动一次服务）');
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
  /// 会话过期但有 refreshToken 时先续期（否则查询必然 401）。
  Future<AccountSnapshot> snapshot() async {
    var session = readSession();
    final link = _deviceLink();
    if (session == null && link == null) {
      throw const AccountException('尚未登录');
    }
    if (session != null && session.isExpired && session.refreshToken.isNotEmpty) {
      session = await refresh() ?? session;
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
    if (session == null && link != null) {
      return AccountSnapshot(
        userId: link.userId,
        email: link.email,
        bound: bound,
        workerKnown: workerKnown,
        viaDeviceLink: true,
        signedInAt: link.linkedAt,
      );
    }
    final active = session!;
    return AccountSnapshot(
      userId: active.userId,
      email: active.email,
      bound: bound,
      workerKnown: workerKnown,
      signedInAt: active.updatedAt,
    );
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
      if (auth) 'Authorization': 'Bearer ${_credential() ?? ''}',
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
