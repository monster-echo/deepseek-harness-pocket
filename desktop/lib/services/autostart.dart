/// 开机自启（launch_at_startup 包装）+ 应用自身路径解析。
library;

import 'dart:io';

import 'package:launch_at_startup/launch_at_startup.dart';
import 'package:package_info_plus/package_info_plus.dart';

class AutostartService {
  /// macOS 上 SMAppService 要指向 .app；Windows 指向 exe。
  static String get appPath {
    final exe = Platform.resolvedExecutable;
    if (Platform.isMacOS) {
      // .../DSH Pocket Worker.app/Contents/MacOS/<binary>
      var dir = File(exe).parent; // MacOS
      dir = dir.parent; // Contents
      return dir.parent.path; // .app
    }
    return exe;
  }

  Future<void> setup() async {
    final info = await PackageInfo.fromPlatform();
    LaunchAtStartup.instance.setup(
      appName: info.appName.isEmpty ? 'DSH Pocket Worker' : info.appName,
      appPath: appPath,
    );
  }

  Future<bool> isEnabled() => LaunchAtStartup.instance.isEnabled();

  Future<void> enable() => LaunchAtStartup.instance.enable();

  Future<void> disable() => LaunchAtStartup.instance.disable();
}
