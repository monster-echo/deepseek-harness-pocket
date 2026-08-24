/// 应用自更新（auto_updater：macOS Sparkle / Windows WinSparkle）。
///
/// feed 指向 GitHub Releases 的 appcast（作为 release asset，
/// `releases/latest/download/<file>` 是稳定跳转；要求 repo 为 public，
/// 若改 private 需换成 gateway 托管或镜像）。
/// macOS 与 Windows 各一份 feed：WinSparkle 不识别 sparkle:os 过滤，
/// 混排会误下载对方平台的包。
library;

import 'dart:io';

import 'package:auto_updater/auto_updater.dart';

class UpdaterService {
  static const _repo = 'monster-echo/deepseek-harness-pocket';
  static const _feedBase = 'https://github.com/$_repo/releases/latest/download';

  static String get feedUrl => Platform.isMacOS
      ? '$_feedBase/appcast-macos.xml'
      : '$_feedBase/appcast-windows.xml';

  /// 应用启动时调用：设置 feed + 每日定时检查。
  Future<void> init() async {
    await autoUpdater.setFeedURL(feedUrl);
    await autoUpdater.setScheduledCheckInterval(24 * 3600);
  }

  /// 手动「检查更新」（Sparkle/WinSparkle 弹系统对话框）。
  Future<void> checkNow() async {
    await autoUpdater.setFeedURL(feedUrl);
    await autoUpdater.checkForUpdates();
  }
}
