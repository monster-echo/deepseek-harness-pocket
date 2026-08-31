/// Worker 控制：通过内置 dshc CLI 的 start/stop/status/qr/token。
library;

import 'dart:convert';

import 'dart:io';

import '../models.dart';
import 'paths.dart';
import 'proc.dart';

class WorkerService {
  /// dshc start 参数组装（settings → CLI flags）。
  static List<String> startArgs(AppSettings s, {bool quiet = true}) {
    final args = <String>[
      'start',
      '--detached',
      if (quiet) '--quiet',
      if (s.gatewayUrl.trim().isNotEmpty) ...['--gateway', s.gatewayUrl.trim()],
      '--port', '${s.port}',
      '--host', s.host,
      '--caps', s.caps,
      if (s.workerName.trim().isNotEmpty) ...['--name', s.workerName.trim()],
    ];
    final dsh = s.effectiveDshBin;
    if (dsh != null) args.addAll(['--dsh', dsh]);
    return args;
  }

  Future<WorkerStatus> status({int? fallbackPort}) async {
    try {
      final res = await Proc.dshc(['status', '--json'], timeout: const Duration(seconds: 20));
      if (!res.ok) return const WorkerStatus.unknown();
      try {
        return WorkerStatus.fromJson(jsonDecode(res.stdout) as Map<String, dynamic>);
      } catch (_) {
        return const WorkerStatus.unknown();
      }
    } on SidecarMissingException {
      // 查询工具不可用 ≠ worker 停了：降级用 run.json + 本地健康检查，
      // 避免把「活着的服务」误报成「dsh 未加载」吓到用户。
      return _fallbackStatus(fallbackPort);
    }
  }

  /// 降级探测：读 run.json（dshc status 的文件版），再用 /mobile/health 确认真活着。
  Future<WorkerStatus> _fallbackStatus(int? port) async {
    RunInfo? run;
    try {
      final file = File(AppPaths.runFile);
      if (file.existsSync()) {
        run = RunInfo.fromJson(jsonDecode(file.readAsStringSync()) as Map<String, dynamic>);
      }
    } catch (_) {}
    // run.json 可能是残留（daemon 已崩），健康检查过了才算运行中
    if (port == null || !await _healthOk(port)) return const WorkerStatus.unknown();
    return WorkerStatus(
      running: true,
      pid: (run?.pid ?? 0) > 0 ? run!.pid : null,
      run: run,
      stateFile: '',
      logFile: AppPaths.workerLogFile,
      reachable: true,
    );
  }

  Future<bool> _healthOk(int port) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    try {
      final req = await client.getUrl(Uri.parse('http://127.0.0.1:$port/mobile/health'));
      final res = await req.close();
      await res.drain<void>();
      return res.statusCode == 200;
    } catch (_) {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  /// 启动 worker；返回给人看的输出（成功/已在运行/失败原因）。
  Future<String> start(AppSettings s) async {
    final res = await Proc.dshc(startArgs(s));
    if (res.ok) {
      return res.output.isEmpty ? '已启动' : res.output;
    }
    final msg = res.output;
    if (msg.contains('已在运行')) return msg;
    throw WorkerActionException(msg.isEmpty ? '启动失败 (exit ${res.exitCode})' : msg);
  }

  Future<void> stop() async {
    final res = await Proc.dshc(['stop', '--json'], timeout: const Duration(seconds: 20));
    if (!res.ok && !res.output.contains('未在运行')) {
      throw WorkerActionException(res.output.isEmpty ? '停止失败' : res.output);
    }
    // 等优雅退出（dshc 给 dsh 5s 宽限）
    for (var i = 0; i < 16; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      final st = await status();
      if (!st.running) return;
    }
    throw const WorkerActionException('停止超时：supervisor 未在 8 秒内退出');
  }

  Future<void> restart(AppSettings s) async {
    final st = await status();
    if (st.running) await stop();
    await start(s);
  }

  Future<PairingPayload> pairing(AppSettings s) async {
    final args = <String>['qr', '--json', '--port', '${s.port}'];
    if (s.gatewayUrl.trim().isNotEmpty) args.addAll(['--gateway', s.gatewayUrl.trim()]);
    final res = await Proc.dshc(args, timeout: const Duration(seconds: 30));
    if (!res.ok) throw WorkerActionException(res.output.isEmpty ? '读取配对信息失败' : res.output);
    try {
      return PairingPayload.fromJson(jsonDecode(res.stdout) as Map<String, dynamic>);
    } catch (_) {
      throw const WorkerActionException('配对信息解析失败（状态文件不可用？）');
    }
  }

  /// rotate 配对 token；返回新配对码。
  Future<String> rotateToken() async {
    final res = await Proc.dshc(['token'], timeout: const Duration(seconds: 20));
    if (!res.ok) throw WorkerActionException(res.output.isEmpty ? 'rotate 失败' : res.output);
    final match = RegExp(r'新配对码 (\d{6})').firstMatch(res.output);
    return match?.group(1) ?? res.output;
  }

  /// 判断 sidecar 是否就绪（供 UI 提示）。
  bool get sidecarReady => AppPaths.sidecarReady;
}

class WorkerActionException implements Exception {
  const WorkerActionException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// 供 UI 显示的日志尾部。
Future<List<String>> tailWorkerLog({int maxLines = 300}) async {
  final file = File(AppPaths.workerLogFile);
  if (!await file.exists()) return const [];
  final bytes = await file.readAsBytes();
  // 只取尾部 256KB，避免日志膨胀后整读
  final slice = bytes.length > 256 * 1024 ? bytes.sublist(bytes.length - 256 * 1024) : bytes;
  final lines = const Utf8Decoder(allowMalformed: true)
      .convert(slice)
      .split('\n');
  var out = lines.where((l) => l.isNotEmpty).toList();
  if (out.length > maxLines) out = out.sublist(out.length - maxLines);
  return out;
}
