/// 全局导航 + 管理面板注册：托盘菜单没有 BuildContext，
/// 经由静态 navigatorKey 打开页面；同一面板已在栈顶时不重复推。
library;

import 'package:flutter/material.dart';

import 'ui/logs_page.dart';
import 'ui/pairing_page.dart';
import 'ui/status_page.dart';
import 'ui/versions_page.dart';
import 'ui/widgets.dart';

/// 面板注册表：托盘菜单与调试路由（DSH_DEBUG_ROUTE）共用。
Widget buildPanel(String name) {
  switch (name) {
    case 'status':
      return const PanelPage(title: 'Worker 状态', child: StatusPage());
    case 'pairing':
      return const PanelPage(title: '配对', child: PairingPage());
    case 'versions':
      return const PanelPage(title: 'dsh 版本', child: VersionsPage());
    case 'logs':
      return const PanelPage(title: 'Worker 日志', child: LogsPage());
    default:
      throw ArgumentError.value(name, 'name', '未知面板');
  }
}

class AppNav {
  AppNav._();

  static final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  /// 当前栈顶面板路由名（null = 停在控制台本体）。
  static String? _topPanelRoute;

  static final NavigatorObserver observer = _AppNavObserver();

  /// 托盘入口：推入面板；已在该面板顶部时跳过（避免连点堆栈）。
  static void pushPanel(String name) {
    if (_topPanelRoute == name) return;
    final nav = navigatorKey.currentState;
    if (nav == null) return;
    nav.push(MaterialPageRoute<void>(
      builder: (_) => buildPanel(name),
      settings: RouteSettings(name: name),
    ));
  }
}

class _AppNavObserver extends NavigatorObserver {
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    AppNav._topPanelRoute = route.settings.name;
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (AppNav._topPanelRoute == route.settings.name) {
      AppNav._topPanelRoute = previousRoute?.settings.name;
    }
  }
}
