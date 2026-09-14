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
final accountServiceProvider =
    Provider<AccountService>((ref) => AccountService(() => ref.read(settingsProvider)));
final consoleWindowServiceProvider = Provider<ConsoleWindowService>((ref) => ConsoleWindowService());

/// sidecar 就绪状态（缺失时控制台顶部提示；主窗口引导面亦有入口）。
final sidecarReadyProvider = Provider<bool>((ref) {
  ref.watch(workerStatusProvider);
  return AppPaths.sidecarReady;
});

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
/// 未登录时 data 为 null。
final accountSnapshotProvider = FutureProvider<AccountSnapshot?>((ref) async {
  final svc = ref.watch(accountServiceProvider);
  if (svc.readSession() == null) return null;
  try {
    return await svc.snapshot();
  } on AccountException {
    // 已登录但查询失败（网络等）：退回仅本地会话的快照
    final session = svc.readSession();
    if (session == null) return null;
    return AccountSnapshot(session: session, bound: false, workerKnown: false);
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

  Future<void> set(bool value) async {
    try {
      final svc = ref.read(autostartServiceProvider);
      await (value ? svc.enable() : svc.disable());
      await _load();
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }
}

final autostartEnabledProvider =
    NotifierProvider<AutostartEnabledNotifier, AsyncValue<bool>>(AutostartEnabledNotifier.new);

