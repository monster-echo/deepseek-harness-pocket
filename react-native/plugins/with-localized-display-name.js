/**
 * 本地化主屏幕显示名：系统语言中文 → 掌鲸，英文/其他 → DSH Pocket。
 *
 * iOS：写 en.lproj / zh-Hans.lproj 的 InfoPlist.strings（CFBundleDisplayName），
 *      并把 variant group 注册进 project.pbxproj 的资源阶段。
 *      Info.plist 里的 CFBundleDisplayName（来自 expo.name）作为其他语言的兜底。
 * Android：base strings.xml 的 app_name 改为英文，values-zh/strings.xml 覆盖为中文。
 *
 * 商店展示名（ASC / Play 后台）不走这里，仍在各自后台单独配置。
 */
const { withDangerousMod, withStringsXml } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const IOS_NAMES = { en: 'DSH Pocket', 'zh-Hans': '掌鲸' };
const ANDROID_NAME_EN = 'DSH Pocket';
const ANDROID_NAME_ZH = '掌鲸';

// pbxproj 对象 ID（24 位十六进制）；固定值保证插件幂等可重入
const ID_BUILD_FILE = 'F0CA1E5E0000000000000001';
const ID_VARIANT_GROUP = 'F0CA1E5E0000000000000002';
const ID_FILE_REF_EN = 'F0CA1E5E0000000000000003';
const ID_FILE_REF_ZH = 'F0CA1E5E0000000000000004';

function withIosLocalizedName(config) {
  return withDangerousMod(config, ['ios', (cfg) => {
    const platformRoot = cfg.modRequest.platformProjectRoot; // .../ios
    const projectName = cfg.modRequest.projectName; // DSHCompanion

    // 1) 各语言 InfoPlist.strings
    for (const [locale, name] of Object.entries(IOS_NAMES)) {
      const dir = path.join(platformRoot, projectName, `${locale}.lproj`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'InfoPlist.strings'),
        `"CFBundleDisplayName" = "${name}";\n`,
        'utf8',
      );
    }

    // 2) 注册进 pbxproj：文件引用 ×2 + variant group + build file + 挂载点
    const pbxprojPath = path.join(platformRoot, `${projectName}.xcodeproj`, 'project.pbxproj');
    let s = fs.readFileSync(pbxprojPath, 'utf8');
    if (!s.includes(ID_VARIANT_GROUP)) {
      // PBXBuildFile
      s = s.replace(
        '/* Begin PBXBuildFile section */',
        `/* Begin PBXBuildFile section */\n\t\t${ID_BUILD_FILE} /* InfoPlist.strings in Resources */ = {isa = PBXBuildFile; fileRef = ${ID_VARIANT_GROUP} /* InfoPlist.strings */; };`,
      );
      // PBXFileReference（路径带 projectName 前缀，与 SplashScreen.storyboard 同一挂法）
      const fileRefs = [
        [ID_FILE_REF_EN, 'en.lproj'],
        [ID_FILE_REF_ZH, 'zh-Hans.lproj'],
      ]
        .map(
          ([id, lproj]) =>
            `\t\t${id} /* InfoPlist.strings */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = text.plist.strings; name = InfoPlist.strings; path = ${projectName}/${lproj}/InfoPlist.strings; sourceTree = "<group>"; };`,
        )
        .join('\n');
      s = s.replace(
        '/* Begin PBXFileReference section */',
        `/* Begin PBXFileReference section */\n${fileRefs}`,
      );
      // PBXVariantGroup（新 section，插在 PBXGroup 之前）
      s = s.replace(
        '/* Begin PBXGroup section */',
        `/* Begin PBXVariantGroup section */\n\t\t${ID_VARIANT_GROUP} /* InfoPlist.strings */ = {\n\t\t\tisa = PBXVariantGroup;\n\t\t\tchildren = (\n\t\t\t\t${ID_FILE_REF_EN} /* InfoPlist.strings */,\n\t\t\t\t${ID_FILE_REF_ZH} /* InfoPlist.strings */,\n\t\t\t);\n\t\t\tname = InfoPlist.strings;\n\t\t\tsourceTree = "<group>";\n\t\t};\n/* End PBXVariantGroup section */\n\n/* Begin PBXGroup section */`,
      );
      // 主 group children：挂在 SplashScreen.storyboard 同级（4 缩进 + 行尾逗号的只有 children 一处）
      s = s.replace(
        /(\n\t\t\t\t[A-F0-9]{24} \/\* SplashScreen\.storyboard \*\/,)/,
        `$1\n\t\t\t\t${ID_VARIANT_GROUP} /* InfoPlist.strings */,`,
      );
      // Resources build phase：挂在 SplashScreen.storyboard in Resources 同级
      s = s.replace(
        /(\n\t\t\t\t[A-F0-9]{24} \/\* SplashScreen\.storyboard in Resources \*\/,)/,
        `$1\n\t\t\t\t${ID_BUILD_FILE} /* InfoPlist.strings in Resources */,`,
      );
      // knownRegions 补充 zh-Hans
      s = s.replace(
        /knownRegions = \(([\s\S]*?)\);/,
        (m, inner) => (inner.includes('zh-Hans') ? m : `knownRegions = (${inner}\t\t\t\t"zh-Hans",\n\t\t\t);`),
      );
      fs.writeFileSync(pbxprojPath, s, 'utf8');
    }
    return cfg;
    },
  ]);
}

function withAndroidLocalizedName(config) {
  // base app_name → 英文（覆盖 expo.name 生成的值）
  config = withStringsXml(config, (cfg) => {
    cfg.modResults.resources = cfg.modResults.resources.filter((r) => r.$.name !== 'app_name');
    cfg.modResults.resources.push({ $: { name: 'app_name' }, _: ANDROID_NAME_EN });
    return cfg;
  });
  // values-zh → 中文
  return withDangerousMod(config, ['android', (cfg) => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'values-zh');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'strings.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">${ANDROID_NAME_ZH}</string>\n</resources>\n`,
      'utf8',
    );
    return cfg;
  }]);
}

module.exports = function withLocalizedName(config) {
  return withAndroidLocalizedName(withIosLocalizedName(config));
};
