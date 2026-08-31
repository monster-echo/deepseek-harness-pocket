/// 路径解析：pocket 主目录（与 dshc CLI 共享）+ 应用内置 sidecar。
library;

import 'dart:io';

import 'package:path/path.dart' as p;

class AppPaths {
  AppPaths._();

  static String get home =>
      Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'] ?? '.';

  /// 与 dshc CLI 共享的主目录（supervisor.ts dshcDir 同源）。
  static String get pocketHome => p.join(home, '.deepseek-harness-pocket');

  static String get settingsFile => p.join(pocketHome, 'desktop-settings.json');

  static String get workerLogFile => p.join(pocketHome, 'dshc.log');

  /// supervisor 运行态文件（dshc status 的文件版，供降级探测）。
  static String get runFile => p.join(pocketHome, 'run.json');

  /// 托管的 dsh 运行时根目录（应用管理的多版本）。
  static String get dshRuntimesDir => p.join(pocketHome, 'runtimes', 'dsh');

  // ---------- sidecar（打进应用包的 node + bridge） ----------

  /// macOS: DSH Pocket Worker.app/Contents/Resources/node-sidecar
  /// Windows: dsh-pocket-worker.exe 旁的 node-sidecar/
  static String get sidecarRoot {
    final exeDir = p.dirname(Platform.resolvedExecutable);
    if (Platform.isMacOS) {
      return p.normalize(p.join(exeDir, '..', 'Resources', 'node-sidecar'));
    }
    return p.join(exeDir, 'node-sidecar');
  }

  static String get nodeBin => Platform.isMacOS
      ? p.join(sidecarRoot, 'node', 'bin', 'node')
      : p.join(sidecarRoot, 'node', 'node.exe');

  static String get nodeBinDir => Platform.isMacOS
      ? p.join(sidecarRoot, 'node', 'bin')
      : p.join(sidecarRoot, 'node');

  static String get npmCli => Platform.isMacOS
      ? p.join(sidecarRoot, 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : p.join(sidecarRoot, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js');

  static String get dshcCli => p.join(sidecarRoot, 'bridge', 'dist', 'cli', 'index.js');

  static bool get sidecarReady =>
      File(nodeBin).existsSync() && File(dshcCli).existsSync();

  /// 托管版本的 dsh 可执行路径（npm --prefix 安装产物）。
  static String managedDshBin(String version) => p.join(
        dshRuntimesDir,
        version,
        'node_modules',
        '.bin',
        Platform.isWindows ? 'dsh.cmd' : 'dsh',
      );
}
