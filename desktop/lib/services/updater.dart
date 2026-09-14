/// 应用自更新（auto_updater：macOS Sparkle / Windows WinSparkle）。
///
/// feed 指向 GitHub Releases 的 appcast（作为 release asset，
/// `releases/latest/download/<file>` 是稳定跳转；要求 repo 为 public，
/// 若改 private 需换成 gateway 托管或镜像）。
/// macOS 与 Windows 各一份 feed：WinSparkle 不识别 sparkle:os 过滤，
/// 混排会误下载对方平台的包。
///
/// 自动发现：启动时后台检查一次 + 每日定时；发现新版本通过
/// [onVersionFound] 回调（桌面通知层消费）。注意：应用未做 Developer ID
/// 代码签名前，Sparkle 只能「发现 + 下载」，静默安装会被
/// 「新旧版本代码签名不一致」策略拒绝——签名体系就位后，后台发现
/// 即可升级为静默安装，代码无需改动。
library;

import 'dart:io';

import 'package:auto_updater/auto_updater.dart';

class UpdaterService with UpdaterListener {
  static const _repo = 'monster-echo/deepseek-harness-pocket';
  static const _feedBase = 'https://github.com/$_repo/releases/latest/download';

  static String get feedUrl => Platform.isMacOS
      ? '$_feedBase/appcast-macos.xml'
      : '$_feedBase/appcast-windows.xml';

  /// 发现新版本回调（参数 = 新版本号），由通知层设置。
  void Function(String version)? onVersionFound;

  bool _inited = false;

  /// 应用启动时调用：设置 feed + 每日定时 + 立即后台发现一次。
  Future<void> init() async {
    if (_inited) return;
    _inited = true;
    await autoUpdater.setFeedURL(feedUrl);
    await autoUpdater.setScheduledCheckInterval(24 * 3600);
    autoUpdater.addListener(this);
    await checkInBackground();
  }

  /// 手动「检查更新」（Sparkle/WinSparkle 弹系统对话框）。
  Future<void> checkNow() async {
    await autoUpdater.setFeedURL(feedUrl);
    await autoUpdater.checkForUpdates();
  }

  /// 后台静默发现（不弹界面）；失败静默（网络异常等不打扰用户）。
  Future<void> checkInBackground() async {
    try {
      await autoUpdater.setFeedURL(feedUrl);
      await autoUpdater.checkForUpdates(inBackground: true);
    } catch (_) {
      // 发现失败静默；下一次启动/定时重试
    }
  }

  // ---------- UpdaterListener ----------

  @override
  void onUpdaterUpdateAvailable(AppcastItem? item) {
    final version = item?.versionString;
    if (version != null && version.isNotEmpty) {
      onVersionFound?.call(version);
    }
  }

  @override
  void onUpdaterError(UpdaterError? error) {
    // 未签名构建的后台安装会被 Sparkle 拒绝（签名不一致），属预期，静默
  }

  @override
  void onUpdaterCheckingForUpdate(Appcast? appcast) {}

  @override
  void onUpdaterUpdateNotAvailable(UpdaterError? error) {}

  @override
  void onUpdaterUpdateDownloaded(AppcastItem? item) {}

  @override
  void onUpdaterBeforeQuitForUpdate(AppcastItem? item) {}
}
