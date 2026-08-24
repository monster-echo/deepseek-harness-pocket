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
    required this.autoStartWorker,
    required this.stopWorkerOnExit,
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

  bool autoStartWorker;
  bool stopWorkerOnExit;

  factory AppSettings.defaults() => AppSettings(
        gatewayUrl: defaultGatewayUrl,
        workerName: '',
        host: '0.0.0.0',
        port: 3780,
        caps: 'm2',
        registry: defaultRegistry,
        dshMode: 'system',
        managedVersion: '',
        customDshPath: '',
        autoStartWorker: true,
        stopWorkerOnExit: false,
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
      autoStartWorker: (json['autoStartWorker'] as bool?) ?? d.autoStartWorker,
      stopWorkerOnExit: (json['stopWorkerOnExit'] as bool?) ?? d.stopWorkerOnExit,
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
        'autoStartWorker': autoStartWorker,
        'stopWorkerOnExit': stopWorkerOnExit,
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
    bool? autoStartWorker,
    bool? stopWorkerOnExit,
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
        autoStartWorker: autoStartWorker ?? this.autoStartWorker,
        stopWorkerOnExit: stopWorkerOnExit ?? this.stopWorkerOnExit,
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
  });

  final String dshBin;
  final String dshVersion;
  final String gatewayUrl;
  final int port;
  final String host;
  final String name;
  final int pid;
  final int startedAt; // epoch ms

  factory RunInfo.fromJson(Map<String, dynamic> json) => RunInfo(
        dshBin: (json['dshBin'] as String?) ?? '',
        dshVersion: (json['dshVersion'] as String?) ?? '',
        gatewayUrl: (json['gatewayUrl'] as String?) ?? '',
        port: (json['port'] as num?)?.toInt() ?? 0,
        host: (json['host'] as String?) ?? '',
        name: (json['name'] as String?) ?? '',
        pid: (json['pid'] as num?)?.toInt() ?? 0,
        startedAt: (json['startedAt'] as num?)?.toInt() ?? 0,
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
