export const colors = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F3F5',
  text: '#17191D',
  textSecondary: '#667085',
  border: '#E4E7EC',
  brand: '#B03C3C',
  brandPressed: '#973030',
  brandSoft: '#F6E9E9',
  success: '#2C9A5E',
  warning: '#D58B21',
  warningSoft: '#FFF7E8',
  error: '#D24B4B',
  info: '#3B82C4',
  membershipBronze: '#A85D2D',
  membershipSilver: '#667085',
  membershipGold: '#B7791F',
  scrim: 'rgba(13, 15, 18, 0.52)',
} as const;

export const darkColors = {
  ...colors,
  background: '#0F1115',
  surface: '#191C22',
  surfaceMuted: '#242832',
  text: '#F4F6F8',
  textSecondary: '#A8B0BF',
  border: '#343A46',
  brandSoft: '#3A2427',
} as const;

export type ThemeColors = Readonly<{
  [Key in keyof typeof colors]: string;
}>;

export const membershipAccents = [
  colors.membershipBronze,
  colors.membershipSilver,
  colors.membershipGold,
] as const;

export const spacing = {
  x1: 4,
  x2: 8,
  x3: 12,
  x4: 16,
  x5: 20,
  x6: 24,
  x8: 32,
} as const;

export const radii = {
  small: 10,
  control: 12,
  card: 16,
  sheet: 24,
  round: 999,
} as const;
