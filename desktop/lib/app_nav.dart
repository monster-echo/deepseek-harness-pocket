/// 管理面板注册表：托盘菜单、控制台侧栏与调试路由（DSH_DEBUG_ROUTE）共用。
///
/// 双窗口架构下面板全部显示在控制台窗口（独立引擎），主窗口保持纯 Harness 壳；
/// 托盘经 ConsoleWindowService 打开/唤起控制台并导航到对应面板。
library;

import 'package:flutter/material.dart';

import 'ui/pages/account_page.dart';
import 'ui/pages/logs_page.dart';
import 'ui/pages/status_page.dart';
import 'ui/pages/versions_page.dart';

/// 面板键（托盘菜单 key 与控制台导航共用）。
const kPanelKeys = <String>['status', 'account', 'versions', 'logs'];

/// 面板中文标签。
const kPanelLabels = <String, String>{
  'status': '状态',
  'account': '账号',
  'versions': 'dsh 版本',
  'logs': '日志',
};

/// 面板图标（控制台侧栏用）。
IconData panelIcon(String key) => switch (key) {
      'status' => Icons.monitor_heart_outlined,
      'account' => Icons.person_outline,
      'versions' => Icons.layers_outlined,
      'logs' => Icons.article_outlined,
      _ => Icons.help_outline,
    };

/// 面板页构建器（控制台窗口内使用）。
Widget buildPanel(String key) => switch (key) {
      'status' => const StatusPage(),
      'account' => const AccountPage(),
      'versions' => const VersionsPage(),
      'logs' => const LogsPage(),
      _ => throw ArgumentError.value(key, 'key', '未知面板'),
    };

/// 调试用路由名归一（未知键回退 status）。
String normalizePanel(String? key) =>
    key == null || !kPanelKeys.contains(key) ? 'status' : key;
