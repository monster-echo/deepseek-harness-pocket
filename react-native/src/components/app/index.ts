/**
 * 设计稿原语组件层（`components/app/*`）。
 *
 * 这一层是「新设计稿的视觉语言」落地处：RNR 的 `components/ui/*` 是 registry 生成物，
 * 保持原样不手改；页面只从本 barrel 取 iOS 化的组合原语。
 */
export { ListGroup, ListRow, ListSeparator, SectionHeader } from './list';
export { IconBadge, type IconBadgeHue } from './icon-badge';
export { SegmentedControl, type SegmentedItem } from './segmented-control';
export { StatBar, type StatBarTone } from './stat-bar';
export {
  ActionSheetContent,
  DeviceRow,
  type ActionSheetItem,
  type ActionSheetSection,
} from './action-sheet';
