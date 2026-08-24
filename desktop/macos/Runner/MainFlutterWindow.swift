import Cocoa
import FlutterMacOS

class MainFlutterWindow: NSWindow {
  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = self.frame
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)

    RegisterGeneratedPlugins(registry: flutterViewController)

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
