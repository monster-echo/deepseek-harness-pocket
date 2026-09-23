import React from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';

export function PromoIllustration() {
  const [primary, primaryForeground, card, border, muted] = useCSSVariable([
    '--color-primary',
    '--color-primary-foreground',
    '--color-card',
    '--color-border',
    '--color-muted',
  ]) as [string, string, string, string, string];
  return (
    <Svg width="100%" height={220} viewBox="0 0 320 220">
      <Defs>
        <LinearGradient id="promo" x1="0" y1="0" x2="1" y2="1">
          <Stop stopColor={muted} />
          <Stop offset="1" stopColor={card} />
        </LinearGradient>
      </Defs>
      <Rect width="320" height="220" rx="28" fill="url(#promo)" />
      <Circle cx="160" cy="108" r="68" fill={primary} opacity=".12" />
      <Rect
        x="98"
        y="53"
        width="124"
        height="110"
        rx="22"
        fill={card}
        stroke={border}
        strokeWidth="3"
      />
      <Path d="M123 88h74M123 110h48M123 132h62" stroke={primary} strokeWidth="8" strokeLinecap="round" />
      <Circle cx="220" cy="55" r="25" fill={primary} />
      <Path d="m209 55 8 8 15-17" fill="none" stroke={primaryForeground} strokeWidth="5" strokeLinecap="round" />
    </Svg>
  );
}
