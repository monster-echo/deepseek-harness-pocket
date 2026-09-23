/**
 * 图标库：保留既有 `IconName` 语义，底层改为 lucide-react-native。
 *
 * 旧实现是手写 24x24 stroke SVG；迁移到 RNR 后统一走 lucide，
 * 这样图标与 RNR 组件的 `size-*` / `text-*` className 体系一致。
 */
import React from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUp, Bell, Calendar, Check, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, CircleAlert, CircleCheck, CircleQuestionMark, Clock,
  ClockArrowDown, Code, Command, Copy, Crown, Download, Ellipsis, ExternalLink, Eye,
  FileText, Folder, Funnel, Gift, Globe, House, Image as ImageIcon, Info, Lock, LogOut,
  Menu, MessageCircle, Minus, Monitor, Palette, Paperclip, Pencil, Pin, Plus, Power,
  RefreshCw, Search, Send, Settings, Shield, Slash, Sparkles, Square, Star, Terminal,
  TriangleAlert, Trash, Upload, User, Wifi, X, Zap,
  type LucideIcon,
} from 'lucide-react-native';

export type IconName =
  | 'alert'
  | 'alert-circle'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'bell'
  | 'calendar'
  | 'check'
  | 'check-circle'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'clock'
  | 'close'
  | 'code'
  | 'command'
  | 'copy'
  | 'crown'
  | 'download'
  | 'edit'
  | 'external-link'
  | 'eye'
  | 'file-text'
  | 'filter'
  | 'folder'
  | 'gift'
  | 'globe'
  | 'help-circle'
  | 'history'
  | 'home'
  | 'image'
  | 'info'
  | 'lock'
  | 'log-out'
  | 'menu'
  | 'message-circle'
  | 'minus'
  | 'monitor'
  | 'more-horizontal'
  | 'paperclip'
  | 'palette'
  | 'pin'
  | 'plus'
  | 'power'
  | 'refresh'
  | 'search'
  | 'send'
  | 'settings'
  | 'shield'
  | 'slash'
  | 'sparkles'
  | 'star'
  | 'stop'
  | 'terminal'
  | 'trash'
  | 'upload'
  | 'user'
  | 'wifi'
  | 'zap';

const ICONS: Record<IconName, LucideIcon> = {
  alert: TriangleAlert,
  'alert-circle': CircleAlert,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  bell: Bell,
  calendar: Calendar,
  check: Check,
  'check-circle': CircleCheck,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  clock: Clock,
  close: X,
  code: Code,
  command: Command,
  copy: Copy,
  crown: Crown,
  download: Download,
  edit: Pencil,
  'external-link': ExternalLink,
  eye: Eye,
  'file-text': FileText,
  filter: Funnel,
  folder: Folder,
  gift: Gift,
  globe: Globe,
  'help-circle': CircleQuestionMark,
  history: ClockArrowDown,
  home: House,
  image: ImageIcon,
  info: Info,
  lock: Lock,
  'log-out': LogOut,
  menu: Menu,
  'message-circle': MessageCircle,
  minus: Minus,
  monitor: Monitor,
  'more-horizontal': Ellipsis,
  paperclip: Paperclip,
  palette: Palette,
  pin: Pin,
  plus: Plus,
  power: Power,
  refresh: RefreshCw,
  search: Search,
  send: Send,
  settings: Settings,
  shield: Shield,
  slash: Slash,
  sparkles: Sparkles,
  star: Star,
  stop: Square,
  terminal: Terminal,
  trash: Trash,
  upload: Upload,
  user: User,
  wifi: Wifi,
  zap: Zap,
};

type IconProps = Readonly<{
  name: IconName;
  color?: string;
  size?: number;
}>;

/** 兼容层：旧调用点继续用 `<AppIcon name="..." />`，内部换成 lucide。 */
export function AppIcon({ name, color, size = 24 }: IconProps) {
  const Component = ICONS[name];
  return <Component color={color} size={size} />;
}
