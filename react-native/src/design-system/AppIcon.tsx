import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'alert'
  | 'arrow-left'
  | 'bell'
  | 'check'
  | 'chevron-right'
  | 'close'
  | 'crown'
  | 'gift'
  | 'globe'
  | 'home'
  | 'image'
  | 'info'
  | 'lock'
  | 'menu'
  | 'palette'
  | 'minus'
  | 'plus'
  | 'settings'
  | 'trash'
  | 'user';

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
  'arrow-left': ['m15 18-6-6 6-6'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  check: ['m20 6-11 11-5-5'],
  'chevron-right': ['m9 18 6-6-6-6'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  crown: ['m3 6 4 5 5-7 5 7 4-5-2 13H5L3 6Z', 'M5 19h14'],
  gift: [
    'M5 8h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z',
    'M12 8v13',
    'M3 12h18',
    'M7.5 8C5 8 4 6.8 4 5.5S5 3 6.5 3C9 3 12 8 12 8',
    'M16.5 8C19 8 20 6.8 20 5.5S19 3 17.5 3C15 3 12 8 12 8',
  ],
  globe: ['M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  home: ['m3 11 9-8 9 8', 'M5 10v10h14V10', 'M9 20v-6h6v6'],
  image: ['M4 4h16v16H4Z', 'm4 17 4-4 3 3 3-4 6 6', 'M15 8h.01'],
  info: ['M12 8h.01', 'M12 11v5'],
  lock: ['M8 10V7a4 4 0 0 1 8 0v3'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  minus: ['M5 12h14'],
  palette: ['M12 3a9 9 0 0 0 0 18h1.5a1.5 1.5 0 0 0 0-3H12a2 2 0 0 1 0-4h2a7 7 0 0 0 0-14h-2Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  settings: [
    'M19 15a2 2 0 0 0 .4 2.2l.1.1-2.8 2.8-.1-.1a2 2 0 0 0-3.4 1.4v.6H9.6v-.6A2 2 0 0 0 6.2 20l-.1.1-2.8-2.8.1-.1A2 2 0 0 0 2 13.8V10h.6A2 2 0 0 0 4 6.6l-.1-.1 2.8-2.8.1.1A2 2 0 0 0 10.2 2h3.6A2 2 0 0 0 17.2 3.8l.1-.1 2.8 2.8-.1.1A2 2 0 0 0 22 10v3.8A2 2 0 0 0 19 15Z',
  ],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 15H6L5 6', 'M10 11v5', 'M14 11v5'],
};

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
      {name === 'globe' ? <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" /> : null}
      {name === 'info' ? <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" /> : null}
      {name === 'lock' ? <Rect x="4" y="10" width="16" height="11" rx="2" stroke={color} strokeWidth="2" /> : null}
      {name === 'settings' ? <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="2" /> : null}
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
