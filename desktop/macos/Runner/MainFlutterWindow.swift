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

  /// 红色关闭按钮（与 Cmd+W）→ 收进托盘；真正退出走托盘菜单（window_manager
  /// destroy() 调 close()，不经过这里）。window_manager 的 preventClose 依赖
  /// delegate 挂接时机，引擎早期注册竞态下不可靠，故在原生层直接拦截。
  override func performClose(_ sender: Any?) {
    self.orderOut(sender)
  }
}
