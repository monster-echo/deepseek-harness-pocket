/// Riverpod 装配：settings 持久化 + worker 状态轮询 + 版本列表 + 账号会话。
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import 'models.dart';
import 'services/account.dart';
import 'services/autostart.dart';
import 'services/console_window.dart';
import 'services/device_link.dart';
import 'services/paths.dart';
import 'services/runtime.dart';
import 'services/updater.dart';
import 'services/worker.dart';

// ---------- 设置 ----------

class SettingsNotifier extends Notifier<AppSettings> {
  @override
  AppSettings build() => _load();

  AppSettings _load() {
    try {
      final file = File(AppPaths.settingsFile);
      if (!file.existsSync()) return AppSettings.defaults();
      return AppSettings.fromJson(jsonDecode(file.readAsStringSync()) as Map<String, dynamic>);
    } catch (_) {
      return AppSettings.defaults();
    }
  }

  void update(AppSettings next) {
    state = next;
    _save(next);
  }

  void _save(AppSettings s) {
    try {
      final file = File(AppPaths.settingsFile);
      file.parent.createSync(recursive: true);
      file.writeAsStringSync('${const JsonEncoder.withIndent('  ').convert(s.toJson())}\n');
    } catch (_) {
      // 写失败不打断 UI（只读盘运行）
    }
  }
}

final settingsProvider = NotifierProvider<SettingsNotifier, AppSettings>(SettingsNotifier.new);

// ---------- 服务 ----------

final workerServiceProvider = Provider<WorkerService>((ref) => WorkerService());
final runtimeServiceProvider = Provider<DshRuntimeService>((ref) => DshRuntimeService());
final autostartServiceProvider = Provider<AutostartService>((ref) => AutostartService());
final updaterServiceProvider = Provider<UpdaterService>((ref) => UpdaterService());
final accountServiceProvider = Provider<AccountService>(
  (ref) => AccountService(
    () => ref.read(settingsProvider),
    // REST 凭据：优先 auth 会话（浏览器登录），否则扫码登录的设备凭据。
    // 用静态读取器而非本 provider，避免顶层自引用循环。
    () => readAccountSession()?.token ?? ref.read(deviceLinkServiceProvider).read()?.credential,
    () => ref.read(deviceLinkServiceProvider).read(),
  ),
);

/// 扫码登录（手机授权）服务：申请链接码 / 轮询 / 吊销。
final deviceLinkServiceProvider =
    Provider<DeviceLinkService>((ref) => DeviceLinkService(() => ref.read(settingsProvider)));

/// 当前扫码登录态（device-link.json）；登录/登出后 refresh。
class DeviceLinkNotifier extends Notifier<DeviceLink?> {
  @override
  DeviceLink? build() => ref.read(deviceLinkServiceProvider).read();

  void refresh() => state = ref.read(deviceLinkServiceProvider).read();

  /// 退出登录：解绑这台电脑并清本地凭据。
  Future<void> signOut() async {
    await ref.read(deviceLinkServiceProvider).revoke();
    state = null;
  }
}

final deviceLinkProvider =
    NotifierProvider<DeviceLinkNotifier, DeviceLink?>(DeviceLinkNotifier.new);
final consoleWindowServiceProvider = Provider<ConsoleWindowService>((ref) => ConsoleWindowService());

/// sidecar 就绪状态（缺失时控制台顶部提示；主窗口引导面亦有入口）。
final sidecarReadyProvider = Provider<bool>((ref) {
  ref.watch(workerStatusProvider);
  return AppPaths.sidecarReady;
});

/// 最近一次拉起 worker 失败的原因（null = 无）。
/// 状态轮询只反映 running 与否，起不来的根因（pnpm 路径/凭证/端口…）在这里
/// 给主窗口引导面展示；下次启动尝试（自动或手动）成功即清除。
class WorkerBootErrorNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? message) {
    state = message;
  }
}

final workerBootErrorProvider =
    NotifierProvider<WorkerBootErrorNotifier, String?>(WorkerBootErrorNotifier.new);

// ---------- worker 状态轮询 ----------

final workerStatusProvider = StreamProvider<WorkerStatus>((ref) async* {
  final svc = ref.watch(workerServiceProvider);
  while (true) {
    try {
      yield await svc.status(fallbackPort: ref.read(settingsProvider).port);
    } catch (_) {
      yield const WorkerStatus.unknown();
    }
    await Future<void>.delayed(const Duration(seconds: 2));
  }
});

// ---------- 账号 ----------

/// 账号快照（登录态 + 本机绑定态）；登录/登出/绑定后 invalidate。
/// 两种登录都算：浏览器登录（auth 会话）与手机扫码授权（设备凭据）。
/// 都没登录时 data 为 null（账号页显示二维码）。
final accountSnapshotProvider = FutureProvider<AccountSnapshot?>((ref) async {
  final svc = ref.watch(accountServiceProvider);
  final link = ref.watch(deviceLinkProvider);
  if (svc.readSession() == null && link == null) return null;
  try {
    return await svc.snapshot();
  } on AccountException {
    // 已登录但查询失败（网络等）：退回仅本地的快照
    final session = svc.readSession();
    if (session != null) {
      return AccountSnapshot(
        userId: session.userId,
        email: session.email,
        bound: false,
        workerKnown: false,
        signedInAt: session.updatedAt,
      );
    }
    if (link != null) {
      return AccountSnapshot(
        userId: link.userId,
        email: link.email,
        bound: false,
        workerKnown: false,
        viaDeviceLink: true,
        signedInAt: link.linkedAt,
      );
    }
    return null;
  }
});

// ---------- dsh 托管版本 ----------

final installedDshProvider = FutureProvider<List<InstalledDsh>>((ref) async {
  return ref.watch(runtimeServiceProvider).installed();
});

final availableDshProvider = FutureProvider<List<String>>((ref) async {
  final s = ref.watch(settingsProvider);
  return ref.watch(runtimeServiceProvider).available(s.registry);
});

// ---------- 其他 ----------

final appInfoProvider = FutureProvider<PackageInfo>((ref) => PackageInfo.fromPlatform());

// ---------- 开机自启状态 ----------

class AutostartEnabledNotifier extends Notifier<AsyncValue<bool>> {
  @override
  AsyncValue<bool> build() {
    _load();
    return const AsyncValue.loading();
  }

  Future<void> _load() async {
    try {
      await ref.read(autostartServiceProvider).setup();
      final enabled = await ref.read(autostartServiceProvider).isEnabled();
      state = AsyncValue.data(enabled);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// 重新问系统要一次真实状态（托盘每次弹出菜单前调用：
  /// 用户可能在「系统设置 → 登录项」里改过，控制台窗口也可能改过）。
  Future<void> refresh() => _load();

  Future<void> set(bool value) async {
    try {
      final svc = ref.read(autostartServiceProvider);
      await (value ? svc.enable() : svc.disable());
      await _load();
    } catch (e, st) {
      state = AsyncValue.error(e, st);
      // 交给调用方提示：托盘发系统通知、控制台弹 toast。
      // 这里若静默，用户看到的就是「点了没反应、勾也没了」。
      rethrow;
    }
  }
}

final autostartEnabledProvider =
    NotifierProvider<AutostartEnabledNotifier, AsyncValue<bool>>(AutostartEnabledNotifier.new);

