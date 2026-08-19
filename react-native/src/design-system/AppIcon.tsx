import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * 图标库（24x24 stroke 风格，路径取自 lucide icons）。
 * 纯 path 的图标放 paths；需要圆/矩形基形的放 circles/rects（数据驱动，避免分支堆积）。
 */

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

type IconProps = Readonly<{
  name: IconName;
  color?: string;
  size?: number;
}>;

const paths: Record<Exclude<IconName, 'user'>, string[]> = {
  alert: [
    'M10.3 3.8 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.8a2 2 0 0 0-3.4 0Z',
    'M12 9v4',
    'M12 17h.01',
  ],
  'alert-circle': ['M12 8v4', 'M12 16h.01'],
  'arrow-left': ['m15 18-6-6 6-6'],
  'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
  'arrow-up': ['M12 19V5', 'm5 12 7-7 7 7'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  calendar: ['M16 2v4', 'M8 2v4', 'M3 10h18'],
  check: ['m20 6-11 11-5-5'],
  'check-circle': ['m9 12 2 2 4-4'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  'chevron-up': ['m18 15-6-6-6 6'],
  clock: ['M12 6v6l4 2'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  command: [
    'M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0 3-3Z',
  ],
  copy: ['M8 8h12v12H8Z', 'M4 16V4h12'],
  crown: ['m3 6 4 5 5-7 5 7 4-5-2 13H5L3 6Z', 'M5 19h14'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  edit: ['M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'],
  'external-link': ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  eye: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z'],
  'file-text': ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8'],
  filter: ['M22 3H2l8 9.46V19l4 2v-8.54Z'],
  folder: ['M4 5a2 2 0 0 1 2-2h4l2 2h7a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z'],
  gift: [
    'M5 8h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z',
    'M12 8v13',
    'M3 12h18',
    'M7.5 8C5 8 4 6.8 4 5.5S5 3 6.5 3C9 3 12 8 12 8',
    'M16.5 8C19 8 20 6.8 20 5.5S19 3 17.5 3C15 3 12 8 12 8',
  ],
  globe: ['M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  'help-circle': ['M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
  history: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'],
  home: ['m3 11 9-8 9 8', 'M5 10v10h14V10', 'M9 20v-6h6v6'],
  image: ['M4 4h16v16H4Z', 'm4 17 4-4 3 3 3-4 6 6', 'M15 8h.01'],
  info: ['M12 8h.01', 'M12 11v5'],
  lock: ['M8 10V7a4 4 0 0 1 8 0v3'],
  'log-out': ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  minus: ['M5 12h14'],
  'message-circle': [
    'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8Z',
  ],
  monitor: ['M8 21h8', 'M12 17v4'],
  'more-horizontal': ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  paperclip: [
    'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
  ],
  palette: ['M12 3a9 9 0 0 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h2a7 7 0 0 0 0-14h-2Z'],
  pin: [
    'M12 17v5',
    'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1Z',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  power: ['M18.36 6.64a9 9 0 1 1-12.73 0', 'M12 2v10'],
  refresh: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  search: ['m21 21-4.35-4.35'],
  send: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
  settings: [
    'M19 15a2 2 0 0 0 .4 2.2l.1.1-2.8 2.8-.1-.1a2 2 0 0 0-3.4 1.4v.6H9.6v-.6A2 2 0 0 0 6.2 20l-.1.1-2.8-2.8.1-.1A2 2 0 0 0 2 13.8V10h.6A2 2 0 0 0 4 6.6l-.1-.1 2.8-2.8.1.1A2 2 0 0 0 10.2 2h3.6A2 2 0 0 0 17.2 3.8l.1-.1 2.8 2.8-.1.1A2 2 0 0 0 22 10v3.8A2 2 0 0 0 19 15Z',
  ],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z'],
  slash: ['m22 2-20 20'],
  sparkles: [
    'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
    'M20 3v4',
    'M22 5h-4',
  ],
  star: ['m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z'],
  stop: [],
  terminal: ['m4 17 6-6-6-6', 'M12 19h8'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 15H6L5 6', 'M10 11v5', 'M14 11v5'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  wifi: ['M5 12.55a11 11 0 0 1 14.08 0', 'M1.42 9a16 16 0 0 1 21.16 0', 'M8.53 16.11a6 6 0 0 1 6.95 0', 'M12 20h.01'],
  zap: ['M13 2 3 14h9l-1 8 10-12h-9l1-8Z'],
};

/** 圆形基形：[cx, cy, r] */
const circles: Partial<Record<Exclude<IconName, 'user'>, ReadonlyArray<[number, number, number]>>> = {
  globe: [[12, 12, 9]],
  info: [[12, 12, 9]],
  search: [[11, 11, 8]],
  clock: [[12, 12, 9]],
  eye: [[12, 12, 3]],
  'alert-circle': [[12, 12, 9]],
  'check-circle': [[12, 12, 9]],
  'help-circle': [[12, 12, 9]],
  settings: [[12, 12, 3]],
};

/** 矩形基形：[x, y, w, h, rx] */
const rects: Partial<Record<Exclude<IconName, 'user'>, ReadonlyArray<[number, number, number, number, number]>>> = {
  lock: [[4, 10, 16, 11, 2]],
  monitor: [[2, 3, 20, 14, 2]],
  calendar: [[3, 4, 18, 18, 2]],
  stop: [[5, 5, 14, 14, 2]],
};

// clock 的指针（走 paths 之外的补充，保持 circles 纯基形）
paths.clock = ['M12 6v6l4 2'];

export function AppIcon({ name, color = 'currentColor', size = 24 }: IconProps) {
  if (name === 'user') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth="2" />
        <Path d="M4 21a8 8 0 0 1 16 0" stroke={color} strokeWidth="2" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {(rects[name] ?? []).map(([x, y, w, h, rx]) => (
        <Rect key={`r${x}${y}`} x={x} y={y} width={w} height={h} rx={rx} stroke={color} strokeWidth="2" />
      ))}
      {(circles[name] ?? []).map(([cx, cy, r]) => (
        <Circle key={`c${cx}${cy}`} cx={cx} cy={cy} r={r} stroke={color} strokeWidth="2" />
      ))}
      {paths[name].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
