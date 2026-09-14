/// 数据模型：设置 / worker 状态 / 配对 payload。
library;

import 'dart:io';

import 'services/paths.dart';

// ---------- 设置 ----------

class AppSettings {
  AppSettings({
    required this.gatewayUrl,
    required this.workerName,
    required this.host,
    required this.port,
    required this.caps,
    required this.registry,
    required this.dshMode,
    required this.managedVersion,
    required this.customDshPath,
    required this.authApiUrl,
    required this.authAppId,
    required this.authAppEnvironment,
  });

  static const defaultGatewayUrl = 'wss://dsh-pocket.zhongbei.tech/gw/worker';
  static const defaultRegistry = 'https://registry.npmmirror.com';

  String gatewayUrl;
  String workerName; // 空 → dshc 用 hostname
  String host;
  int port;
  String caps; // m1 | m2 | m3
  String registry;

  /// system（PATH 上的 dsh）| managed（应用托管版本）| custom（指定路径）
  String dshMode;
  String managedVersion;
  String customDshPath;

  /// 统一认证 API 基地址（登录 / 刷新 / 绑定走这里；与手机端同一账号体系）
  String authApiUrl;
  /// 认证租户 id（必须与手机 App 的 EXPO_PUBLIC_APP_ID 一致，userId 才相同）
  String authAppId;
  /// 认证环境（development / staging / production）
  String authAppEnvironment;

  factory AppSettings.defaults() => AppSettings(
        gatewayUrl: defaultGatewayUrl,
        workerName: '',
        host: '0.0.0.0',
        port: 3780,
        caps: 'm3', // 手机端创建会话/作品预览需要 m3（artifacts）
        registry: defaultRegistry,
        dshMode: 'system',
        managedVersion: '',
        customDshPath: '',
        authApiUrl: 'https://auth.zhongbei.tech',
        authAppId: 'dshcompanion',
        authAppEnvironment: 'production',
      );

  factory AppSettings.fromJson(Map<String, dynamic> json) {
    final d = AppSettings.defaults();
    return AppSettings(
      gatewayUrl: (json['gatewayUrl'] as String?) ?? d.gatewayUrl,
      workerName: (json['workerName'] as String?) ?? d.workerName,
      host: (json['host'] as String?) ?? d.host,
      port: (json['port'] as num?)?.toInt() ?? d.port,
      caps: (json['caps'] as String?) ?? d.caps,
      registry: (json['registry'] as String?) ?? d.registry,
      dshMode: (json['dshMode'] as String?) ?? d.dshMode,
      managedVersion: (json['managedVersion'] as String?) ?? d.managedVersion,
      customDshPath: (json['customDshPath'] as String?) ?? d.customDshPath,
      authApiUrl: (json['authApiUrl'] as String?) ?? d.authApiUrl,
      authAppId: (json['authAppId'] as String?) ?? d.authAppId,
      authAppEnvironment: (json['authAppEnvironment'] as String?) ?? d.authAppEnvironment,
    );
  }

  Map<String, dynamic> toJson() => {
        'version': 1,
        'gatewayUrl': gatewayUrl,
        'workerName': workerName,
        'host': host,
        'port': port,
        'caps': caps,
        'registry': registry,
        'dshMode': dshMode,
        'managedVersion': managedVersion,
        'customDshPath': customDshPath,
        'authApiUrl': authApiUrl,
        'authAppId': authAppId,
        'authAppEnvironment': authAppEnvironment,
      };

  AppSettings copyWith({
    String? gatewayUrl,
    String? workerName,
    String? host,
    int? port,
    String? caps,
    String? registry,
    String? dshMode,
    String? managedVersion,
    String? customDshPath,
    String? authApiUrl,
    String? authAppId,
    String? authAppEnvironment,
  }) =>
      AppSettings(
        gatewayUrl: gatewayUrl ?? this.gatewayUrl,
        workerName: workerName ?? this.workerName,
        host: host ?? this.host,
        port: port ?? this.port,
        caps: caps ?? this.caps,
        registry: registry ?? this.registry,
        dshMode: dshMode ?? this.dshMode,
        managedVersion: managedVersion ?? this.managedVersion,
        customDshPath: customDshPath ?? this.customDshPath,
        authApiUrl: authApiUrl ?? this.authApiUrl,
        authAppId: authAppId ?? this.authAppId,
        authAppEnvironment: authAppEnvironment ?? this.authAppEnvironment,
      );

  /// 解析当前选择的 dsh 可执行路径；null = 交给 dshc 从 PATH 解析。
  String? get effectiveDshBin {
    switch (dshMode) {
      case 'managed':
        if (managedVersion.isEmpty) return null;
        final bin = AppPaths.managedDshBin(managedVersion);
        return File(bin).existsSync() ? bin : null;
      case 'custom':
        return customDshPath.trim().isNotEmpty && File(customDshPath.trim()).existsSync()
            ? customDshPath.trim()
            : null;
      default:
        return null;
    }
  }

  bool get usesManagedDsh => dshMode == 'managed';
}

// ---------- worker 状态（dshc status --json） ----------

class RunInfo {
  const RunInfo({
    required this.dshBin,
    required this.dshVersion,
    required this.gatewayUrl,
    required this.port,
    required this.host,
    required this.name,
    required this.pid,
    required this.startedAt,
    this.webUrl = '',
  });

  final String dshBin;
  final String dshVersion;
  final String gatewayUrl;
  final int port;
  final String host;
  final String name;
  final int pid;
  final int startedAt; // epoch ms

  /// 本轮 dsh 进程的 Web 控制台地址（0.1.5+ 带 ?token=，随重启刷新；
  /// supervisor 从 `dsh web:` 行捕获，旧版 runtime 为空）。
  final String webUrl;

  factory RunInfo.fromJson(Map<String, dynamic> json) => RunInfo(
        dshBin: (json['dshBin'] as String?) ?? '',
        dshVersion: (json['dshVersion'] as String?) ?? '',
        gatewayUrl: (json['gatewayUrl'] as String?) ?? '',
        port: (json['port'] as num?)?.toInt() ?? 0,
        host: (json['host'] as String?) ?? '',
        name: (json['name'] as String?) ?? '',
        pid: (json['pid'] as num?)?.toInt() ?? 0,
        startedAt: (json['startedAt'] as num?)?.toInt() ?? 0,
        webUrl: (json['webUrl'] as String?) ?? '',
      );

  String get uptimeLabel {
    if (startedAt <= 0) return '—';
    final dur = DateTime.now().millisecondsSinceEpoch - startedAt;
    if (dur < 0) return '—';
    final h = dur ~/ 3600000;
    final m = (dur % 3600000) ~/ 60000;
    final s = (dur % 60000) ~/ 1000;
    return h > 0 ? '$h 小时 $m 分' : (m > 0 ? '$m 分 $s 秒' : '$s 秒');
  }
}

class WorkerStatus {
  const WorkerStatus({
    required this.running,
    required this.pid,
    required this.run,
    required this.stateFile,
    required this.logFile,
    required this.reachable,
  });

  final bool running;
  final int? pid;
  final RunInfo? run;
  final String stateFile;
  final String logFile;

  /// false = dshc 调用本身失败（sidecar 缺失等），区别于「未运行」。
  final bool reachable;

  const WorkerStatus.unknown()
      : running = false,
        pid = null,
        run = null,
        stateFile = '',
        logFile = '',
        reachable = false;

  factory WorkerStatus.fromJson(Map<String, dynamic> json) => WorkerStatus(
        running: json['running'] == true,
        pid: (json['pid'] as num?)?.toInt(),
        run: json['run'] is Map<String, dynamic>
            ? RunInfo.fromJson(json['run'] as Map<String, dynamic>)
            : null,
        stateFile: (json['stateFile'] as String?) ?? '',
        logFile: (json['logFile'] as String?) ?? '',
        reachable: true,
      );
}

// ---------- 配对（dshc qr --json） ----------

class PairingPayload {
  const PairingPayload({
    required this.v,
    required this.gatewayUrl,
    required this.lanUrl,
    required this.hostKey,
    required this.token,
    required this.fingerprint,
    required this.code,
  });

  final int v;
  final String gatewayUrl;
  final String? lanUrl;
  final String hostKey;
  final String token;
  final String fingerprint;
  final String code;

  factory PairingPayload.fromJson(Map<String, dynamic> json) => PairingPayload(
        v: (json['v'] as num?)?.toInt() ?? 1,
        gatewayUrl: (json['gatewayUrl'] as String?) ?? '',
        lanUrl: json['lanUrl'] as String?,
        hostKey: (json['hostKey'] as String?) ?? '',
        token: (json['token'] as String?) ?? '',
        fingerprint: (json['fingerprint'] as String?) ?? '',
        code: (json['code'] as String?) ?? '',
      );

  /// 与手机端扫码协议一致：payload 的 JSON 即二维码内容。
  Map<String, dynamic> toJson() => {
        'v': v,
        'gatewayUrl': gatewayUrl,
        if (lanUrl != null) 'lanUrl': lanUrl,
        'hostKey': hostKey,
        'token': token,
        'fingerprint': fingerprint,
        'code': code,
      };
}

// ---------- 托管的 dsh 版本 ----------

class InstalledDsh {
  const InstalledDsh({required this.version, required this.binPath, required this.installedAt});

  final String version;
  final String binPath;
  final DateTime installedAt;
}

// ---------- 账号会话（登录后持久化，插件 uplink 与 gateway 共用该文件） ----------

class AccountSession {
  const AccountSession({
    required this.userId,
    required this.email,
    required this.token,
    required this.refreshToken,
    required this.updatedAt,
  });

  static const version = 1;

  final String userId;
  final String email;

  /// 掌鲸 DSH Pocket session token（RS256 JWT；gateway 经 JWKS 离线验签）
  final String token;
  final String refreshToken;

  /// epoch ms（本地写入时间，展示用）
  final int updatedAt;

  factory AccountSession.fromJson(Map<String, dynamic> json) => AccountSession(
        userId: (json['userId'] as String?) ?? '',
        email: (json['email'] as String?) ?? '',
        token: (json['token'] as String?) ?? '',
        refreshToken: (json['refreshToken'] as String?) ?? '',
        updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
      );

  Map<String, dynamic> toJson() => {
        'version': version,
        'userId': userId,
        'email': email,
        'token': token,
        'refreshToken': refreshToken,
        'updatedAt': updatedAt,
      };
}

/// 本机 Worker 标识（bridge-state.json 的最小投影，账号绑定/登录态判断用）。
class WorkerIdentity {
  const WorkerIdentity({required this.hostKey, required this.fingerprint});

  final String hostKey;
  final String fingerprint;

  factory WorkerIdentity.fromJson(Map<String, dynamic> json) => WorkerIdentity(
        hostKey: (json['hostKey'] as String?) ?? '',
        fingerprint: (json['fingerprint'] as String?) ?? '',
      );
}
