// Metro 配置：继承 Expo 默认配置，并接入 Uniwind（Tailwind v4 → RN className）。
//
// useWatchman=false：本机 watchman 守护进程无法正常启动（socket 缺失），
// 禁用后 Metro 回退到 Node 文件监听，避免启动卡在等待 watchman。
// 若环境安装并运行了 watchman，可删除本行恢复。
//
// 顺序约束（见 Uniwind 文档）：withUniwindConfig 必须是最外层包装。
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);
config.resolver.useWatchman = false;

module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
});
