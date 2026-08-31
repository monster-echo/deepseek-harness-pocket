/**
 * 原生 splash 看门狗：启动 10 秒后若 splash 加载视图仍在（= React 首帧从未
 * 出现，通常意味着 JS 启动失败），强制移除加载视图，用户不再被 logo 永久
 * 锁死（表现为白屏，方便识别为「JS 未执行」）。
 *
 * 实现说明：
 * - ObjC 文件用 __attribute__((constructor)) 自注册，不改 AppDelegate；
 * - SDK 57 的 expo-splash-screen（SplashScreenManager.swift）把 storyboard
 *   加载视图挂到 RCTSurfaceHostingProxyRootView.loadingView 并关闭了 RN 自带
 *   indicator 自动隐藏；原生 hide() 由 RCTContentDidAppearNotification 驱动，
 *   JS 死掉时永不触发。这里在公开 React 属性上做与 hide() 相同的清理。
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const WATCHDOG_M = `#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>

// 兜底隐藏 splash 加载视图（与 SplashScreenManager.hide() 等价的清理动作）
static void DSHSplashWatchdogForceHide(void) {
  for (UIWindow *window in [UIApplication sharedApplication].windows) {
    NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithObject:window];
    while ([queue count] > 0) {
      UIView *view = [queue firstObject];
      [queue removeObjectAtIndex:0];
      [queue addObjectsFromArray:[view subviews]];
      if ([NSStringFromClass([view class]) hasPrefix:@"RCTSurfaceHosting"]) {
        UIView *loading = [view valueForKey:@"loadingView"];
        if ([loading isKindOfClass:[UIView class]] && !loading.isHidden) {
          [(id)view disableActivityIndicatorAutoHide:YES];
          [loading setHidden:YES];
          [loading removeFromSuperview];
        }
      }
    }
  }
}

__attribute__((constructor)) static void DSHSplashWatchdogInstall(void) {
  // 主队列串行安装，等 UIApplication 起来后再排 10s 定时器
  dispatch_async(dispatch_get_main_queue(), ^{
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(10.0 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
                      DSHSplashWatchdogForceHide();
                   });
  });
}
`;

const FILE_REF_ID = 'F0CA1E5E0000000000000011';
const BUILD_FILE_ID = 'F0CA1E5E0000000000000012';

function withSplashWatchdog(config) {
  return withDangerousMod(config, ['ios', (cfg) => {
    const platformRoot = cfg.modRequest.platformProjectRoot;
    const projectName = cfg.modRequest.projectName;

    // 1) 写入 ObjC 源文件
    fs.writeFileSync(path.join(platformRoot, projectName, 'SplashWatchdog.m'), WATCHDOG_M, 'utf8');

    // 2) 注册进 pbxproj（file ref + build file + Sources phase）
    const pbxprojPath = path.join(platformRoot, `${projectName}.xcodeproj`, 'project.pbxproj');
    let s = fs.readFileSync(pbxprojPath, 'utf8');
    if (!s.includes(FILE_REF_ID)) {
      s = s.replace(
        '/* Begin PBXBuildFile section */',
        `/* Begin PBXBuildFile section */\n\t\t${BUILD_FILE_ID} /* SplashWatchdog.m in Sources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF_ID} /* SplashWatchdog.m */; };`,
      );
      s = s.replace(
        '/* Begin PBXFileReference section */',
        `/* Begin PBXFileReference section */\n\t\t${FILE_REF_ID} /* SplashWatchdog.m */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.objc; path = SplashWatchdog.m; sourceTree = "<group>"; };`,
      );
      // 挂进主 group（SplashScreen.storyboard 同级）
      s = s.replace(
        /(\n\t\t\t\t[A-F0-9]{24} \/\* SplashScreen\.storyboard \*\/,)/,
        `$1\n\t\t\t\t${FILE_REF_ID} /* SplashWatchdog.m */,`,
      );
      // Sources build phase：挂在任一现有 in Sources 行后
      s = s.replace(
        /(\n\t\t\t\t[A-F0-9]{24} \/\* [^*]+ in Sources \*\/,)/,
        `$1\n\t\t\t\t${BUILD_FILE_ID} /* SplashWatchdog.m in Sources */,`,
      );
      fs.writeFileSync(pbxprojPath, s, 'utf8');
    }
    return cfg;
    },
  ]);
}

module.exports = withSplashWatchdog;
