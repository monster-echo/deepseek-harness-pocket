// Expo config plugin：在 iOS Podfile 中注入 use_modular_headers!
// Firebase Swift pods（FirebaseCoreInternal / FirebaseCrashlytics / FirebaseSessions）
// 以静态库集成时，其 ObjC 依赖（GoogleUtilities / GoogleDataTransport / nanopb）
// 未定义 module，pod install 会报 "cannot be integrated as static libraries"。
// 该插件在 prebuild 生成 Podfile 后插入 use_modular_headers!，使这些依赖生成 module map。
// 用 withDangerousMod 而非手工改 ios/Podfile，是因为后者会被后续 prebuild 覆盖。
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');

const PODFILE_ANCHOR = "platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'";
const INJECT = `use_modular_headers!`;

module.exports = function withModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const filePath = config.modRequest.platformProjectRoot + '/Podfile';
      const contents = fs.readFileSync(filePath, 'utf8');
      if (!contents.includes(INJECT)) {
        const updated = contents.replace(
          PODFILE_ANCHOR,
          `${PODFILE_ANCHOR}\n\n# Firebase Swift pods 静态库集成需 modular headers 生成 module map\n${INJECT}`,
        );
        fs.writeFileSync(filePath, updated);
      }
      return config;
    },
  ]);
};
