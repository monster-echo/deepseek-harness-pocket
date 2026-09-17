import Cocoa
import FlutterMacOS
import ServiceManagement
import desktop_multi_window

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)
    AutostartChannel.register(with: flutterViewController)

    // 多窗口（desktop_multi_window）：控制台子窗口创建时同样注册全部插件，
    // 否则子引擎里 window_manager 等插件通道不可用。
    FlutterMultiWindowPlugin.setOnWindowCreatedCallback { controller in
      RegisterGeneratedPlugins(registry: controller)
      AutostartChannel.register(with: controller)
    }

    super.awakeFromNib()
  }

  /// 关闭语义：红叉 / Cmd+W / 任何窗口关闭路径 → 收进托盘（orderOut）。
  /// 真正退出走托盘菜单 → window_manager destroy() → NSApp.terminate()，
  /// 不经过窗口关闭，因此两条路径都无条件拦截（window_manager 的
  /// preventClose 在引擎早期注册竞态下挂不上 delegate，不可靠）。
  override func performClose(_ sender: Any?) {
    CloseLog.write("performClose")
    self.orderOut(sender)
  }

  override func close() {
    CloseLog.write("close")
    self.orderOut(nil)
  }
}

/// 窗口关闭路径日志（~/.deepseek-harness-pocket/window-close.log）：
/// 排查「红叉直接退出」类问题用，记录每次被拦截的关闭调用。
enum CloseLog {
  static var path: String { NSHomeDirectory() + "/.deepseek-harness-pocket/window-close.log" }

  static func write(_ what: String) {
    let line = "\(Date().timeIntervalSince1970) \(what)\n"
    if let handle = FileHandle(forWritingAtPath: path) {
      defer { handle.closeFile() }
      handle.seekToEndOfFile()
      if let data = line.data(using: .utf8) {
        handle.write(data)
      }
    } else {
      try? line.write(toFile: path, atomically: true, encoding: .utf8)
    }
  }
}

// MARK: - 开机自启（launch_at_startup 的 macOS 原生实现）

/// launch_at_startup 在 macOS 上没有任何原生实现：pub 包不含 macos/ 目录，
/// 其 README 要求宿主工程自行往 MainFlutterWindow.swift 接入 LaunchAtLogin
/// Swift Package。本项目此前缺这一步，Dart 侧调用直接抛 MissingPluginException，
/// 于是托盘「开机启动」勾选框永远不显示勾、点击也静默无效。
///
/// 这里用系统 API 直接补上同名 channel，Dart 侧 launch_at_startup 的 API 不变：
/// - macOS 13+：SMAppService.mainApp（与「系统设置 → 通用 → 登录项」一致）；
/// - SMAppService 不可用或注册失败（旧系统、ad-hoc 签名受限等）：回落到
///   ~/Library/LaunchAgents/<bundle-id>.plist（RunAtLoad）。
enum AutostartChannel {
  static let channelName = "launch_at_startup"

  static func register(with registry: FlutterPluginRegistry) {
    let registrar = registry.registrar(forPlugin: "AutostartChannel")
    let channel = FlutterMethodChannel(
      name: channelName,
      binaryMessenger: registrar.messenger
    )
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "launchAtStartupIsEnabled":
        result(isEnabled())
      case "launchAtStartupSetEnabled":
        let args = call.arguments as? [String: Any]
        let enabled = (args?["setEnabledValue"] as? Bool) ?? false
        do {
          try setEnabled(enabled)
          result(nil)
        } catch {
          result(
            FlutterError(
              code: "autostart_failed",
              message: error.localizedDescription,
              details: nil
            )
          )
        }
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  // MARK: 查询 / 开关

  static func isEnabled() -> Bool {
    if #available(macOS 13.0, *), SMAppService.mainApp.status == .enabled {
      return true
    }
    return LaunchAgent.exists(label: label)
  }

  static func setEnabled(_ enabled: Bool) throws {
    if enabled {
      var smFailure: Error?
      if #available(macOS 13.0, *) {
        let service = SMAppService.mainApp
        if service.status != .enabled {
          do {
            try service.register()
          } catch {
            smFailure = error
          }
        }
        if service.status == .enabled {
          // 系统登录项已生效：清掉可能残留的兜底 plist，避免双重自启
          LaunchAgent.remove(label: label)
          return
        }
        if service.status == .requiresApproval {
          // 用户曾在系统设置里关掉过：只能由用户在系统设置重新允许
          throw AutostartError.needsApproval
        }
      }
      do {
        try LaunchAgent.write(label: label)
        LaunchAgent.load(label: label)
      } catch {
        throw smFailure ?? error
      }
      return
    }

    if #available(macOS 13.0, *) {
      let service = SMAppService.mainApp
      if service.status == .enabled || service.status == .requiresApproval {
        try? service.unregister()
      }
    }
    LaunchAgent.unload(label: label)
    LaunchAgent.remove(label: label)
  }

  private static var label: String {
    Bundle.main.bundleIdentifier ?? "top.rwecho.deepseek-harness-pocket.desktop"
  }
}

enum AutostartError: LocalizedError {
  case needsApproval

  var errorDescription: String? {
    switch self {
    case .needsApproval:
      return "开机启动已在系统「登录项」中被关闭，请到 系统设置 → 通用 → 登录项 里允许 DSH Pocket"
    }
  }
}

/// 旧系统 / SMAppService 失能时的兜底：写一个 RunAtLoad 的用户 LaunchAgent。
/// 用 `/usr/bin/open -a <app>` 拉起，走 LaunchServices（GUI 应用正常出现在 Dock）。
enum LaunchAgent {
  static func url(label: String) -> URL {
    FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/LaunchAgents/\(label).plist")
  }

  static func exists(label: String) -> Bool {
    FileManager.default.fileExists(atPath: url(label: label).path)
  }

  static func write(label: String) throws {
    let appPath = Bundle.main.bundlePath
    let plist: [String: Any] = [
      "Label": label,
      "ProgramArguments": ["/usr/bin/open", "-a", appPath],
      "RunAtLoad": true,
      "LimitLoadToSessionType": "Aqua",
    ]
    let data = try PropertyListSerialization.data(
      fromPropertyList: plist,
      format: .xml,
      options: 0
    )
    let target = url(label: label)
    try FileManager.default.createDirectory(
      at: target.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try data.write(to: target, options: .atomic)
  }

  static func load(label: String) {
    runLaunchctl(["load", "-w", url(label: label).path])
  }

  static func unload(label: String) {
    guard exists(label: label) else { return }
    runLaunchctl(["unload", "-w", url(label: label).path])
  }

  static func remove(label: String) {
    try? FileManager.default.removeItem(at: url(label: label))
  }

  private static func runLaunchctl(_ args: [String]) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    process.arguments = args
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try? process.run()
    process.waitUntilExit()
  }
}
