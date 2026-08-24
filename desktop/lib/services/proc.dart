/// 进程执行：内置 node / npm / dshc 的统一 spawn 入口。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'paths.dart';

/// sidecar 未随包就绪（开发态未运行 tool/build-sidecar.sh）。
class SidecarMissingException implements Exception {
  SidecarMissingException(this.message);
  final String message;

  @override
  String toString() => message;
}

class ProcResult {
  const ProcResult({
    required this.exitCode,
    required this.stdout,
    required this.stderr,
    required this.timedOut,
  });

  final int exitCode;
  final String stdout;
  final String stderr;
  final bool timedOut;

  bool get ok => exitCode == 0 && !timedOut;

  String get output {
    final buf = StringBuffer();
    if (stdout.trim().isNotEmpty) buf.writeln(stdout.trim());
    if (stderr.trim().isNotEmpty) buf.writeln(stderr.trim());
    return buf.toString().trim();
  }
}

class Proc {
  Proc._();

  static void ensureSidecar() {
    if (!AppPaths.sidecarReady) {
      throw SidecarMissingException(
        '内置 node sidecar 缺失：${AppPaths.sidecarRoot}\n'
        '开发态请先运行 desktop/tool/build-sidecar.sh <target>',
      );
    }
  }

  /// 组装子进程环境：sidecar node bin 前置到 PATH（dshc/dsh 的 pnpm 依赖此解析）。
  static Map<String, String> sidecarEnv({String? registry}) {
    final env = {...Platform.environment};
    final sep = Platform.isWindows ? ';' : ':';
    env['PATH'] = '${AppPaths.nodeBinDir}$sep${env['PATH'] ?? ''}';
    // node 以 shebang 方式执行 .bin shim 时也走 sidecar node
    if (Platform.isWindows) {
      // .cmd shim 通过 where node 解析，PATH 前置即可
    }
    if (registry != null && registry.trim().isNotEmpty) {
      env['COREPACK_NPM_REGISTRY'] = registry.trim();
      env['npm_config_registry'] = registry.trim();
    }
    return env;
  }

  static Future<ProcResult> run(
    String executable,
    List<String> args, {
    String? workingDirectory,
    Map<String, String>? env,
    Duration timeout = const Duration(minutes: 2),
  }) async {
    final proc = await Process.start(
      executable,
      args,
      workingDirectory: workingDirectory,
      environment: env,
    );
    var timedOut = false;
    final timer = Timer(timeout, () {
      timedOut = true;
      proc.kill(ProcessSignal.sigkill);
    });
    final out = <int>[];
    final err = <int>[];
    await Future.wait([
      proc.stdout.listen(out.addAll).asFuture<void>(),
      proc.stderr.listen(err.addAll).asFuture<void>(),
      proc.exitCode.then((_) {}),
    ]);
    timer.cancel();
    return ProcResult(
      exitCode: await proc.exitCode,
      stdout: utf8.decode(out, allowMalformed: true),
      stderr: utf8.decode(err, allowMalformed: true),
      timedOut: timedOut,
    );
  }

  /// 用内置 node 跑 dshc CLI。
  static Future<ProcResult> dshc(
    List<String> args, {
    Duration timeout = const Duration(minutes: 8),
  }) {
    ensureSidecar();
    return run(
      AppPaths.nodeBin,
      [AppPaths.dshcCli, ...args],
      env: sidecarEnv(),
      timeout: timeout,
    );
  }

  /// 用内置 npm（node npm-cli.js）。
  static Future<ProcResult> npm(
    List<String> args, {
    String? workingDirectory,
    String? registry,
    Duration timeout = const Duration(minutes: 10),
  }) {
    ensureSidecar();
    return run(
      AppPaths.nodeBin,
      [AppPaths.npmCli, ...args, if (registry != null) ...['--registry', registry]],
      workingDirectory: workingDirectory,
      env: sidecarEnv(registry: registry),
      timeout: timeout,
    );
  }

  /// 运行某个 dsh 可执行（探测版本等）。
  static Future<ProcResult> runDsh(String bin, List<String> args) {
    ensureSidecar();
    return run(bin, args, env: sidecarEnv(), timeout: const Duration(seconds: 30));
  }
}

/// 跨平台「在资源管理器/Finder 中显示」。
Future<void> revealInFileBrowser(String path) async {
  if (Platform.isMacOS) {
    await Process.run('open', ['-R', path]);
  } else if (Platform.isWindows) {
    await Process.run('explorer', ['/select,', path]);
  } else {
    await Process.run('xdg-open', [p.dirname(path)]);
  }
}
