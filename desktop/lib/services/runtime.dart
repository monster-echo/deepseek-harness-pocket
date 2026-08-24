/// deepseek harness（@deepseek-ai/dsh）版本管理：
/// 安装到 ~/.deepseek-harness-pocket/runtimes/dsh/<版本>/，不动全局 npm。
library;

import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import '../models.dart';
import 'paths.dart';
import 'proc.dart';

class DshRuntimeService {
  static const packageName = '@deepseek-ai/dsh';

  /// 扫描已安装的托管版本。
  List<InstalledDsh> installed() {
    final root = Directory(AppPaths.dshRuntimesDir);
    if (!root.existsSync()) return const [];
    final result = <InstalledDsh>[];
    for (final ent in root.listSync()) {
      if (ent is! Directory) continue;
      final bin = AppPaths.managedDshBin(p.basename(ent.path));
      if (!File(bin).existsSync()) continue;
      result.add(InstalledDsh(
        version: p.basename(ent.path),
        binPath: bin,
        installedAt: ent.statSync().modified,
      ));
    }
    result.sort((a, b) => b.version.compareTo(a.version));
    return result;
  }

  /// npm registry 上可用版本（新→旧）；prefer-online 避免缓存漏掉刚发布的版本。
  Future<List<String>> available(String registry) async {
    final res = await Proc.npm(
      ['view', packageName, 'versions', '--json', '--prefer-online'],
      registry: registry,
      timeout: const Duration(minutes: 2),
    );
    if (!res.ok) throw RuntimeActionException('获取版本列表失败：${res.output}');
    try {
      final list = (jsonDecode(res.stdout) as List).cast<String>();
      return list.reversed.toList();
    } catch (_) {
      throw const RuntimeActionException('版本列表解析失败');
    }
  }

  /// 安装指定版本到托管目录。
  Future<void> install(String version, String registry) async {
    final dir = Directory(p.join(AppPaths.dshRuntimesDir, version));
    dir.createSync(recursive: true);
    final manifest = File(p.join(dir.path, 'package.json'));
    if (!manifest.existsSync()) {
      manifest.writeAsStringSync(
        '{"name":"dsh-runtime","private":true}\n',
      );
    }
    // dsh 依赖树很大（~450 包），npmmirror 下可能要十几分钟
    const installTimeout = Duration(minutes: 30);
    var res = await Proc.npm(
      ['install', '$packageName@$version', '--no-fund', '--no-audit', '--loglevel=error'],
      workingDirectory: dir.path,
      registry: registry,
      timeout: installTimeout,
    );
    // npm 可能拿陈旧的 registry 元数据缓存报 ETARGET（新版本刚发布时常见），强刷重试一次
    if (!res.ok && (res.output.contains('ETARGET') || res.output.contains('notarget'))) {
      res = await Proc.npm(
        ['install', '$packageName@$version', '--no-fund', '--no-audit', '--loglevel=error', '--prefer-online'],
        workingDirectory: dir.path,
        registry: registry,
        timeout: installTimeout,
      );
    }
    if (!res.ok) {
      // 失败清掉半成品目录，避免 installed() 扫出坏版本
      try {
        dir.deleteSync(recursive: true);
      } catch (_) {}
      throw RuntimeActionException('安装 $version 失败：${res.output}');
    }
    if (!File(AppPaths.managedDshBin(version)).existsSync()) {
      throw RuntimeActionException('安装完成但未找到 dsh 可执行（npm 产物异常）');
    }
  }

  /// 删除托管版本（当前 settings 选中的由 UI 侧拦截）。
  Future<void> remove(String version) async {
    final dir = Directory(p.join(AppPaths.dshRuntimesDir, version));
    if (dir.existsSync()) {
      dir.deleteSync(recursive: true);
    }
  }

  /// 探测某 dsh 可执行的版本号（run.json 已带，一般无需单独调用）。
  Future<String> probeVersion(String bin) async {
    final res = await Proc.runDsh(bin, ['--version']);
    return res.ok ? res.stdout.trim().split('\n').first : '';
  }
}

class RuntimeActionException implements Exception {
  const RuntimeActionException(this.message);
  final String message;

  @override
  String toString() => message;
}
