import type { ThemeTokens } from '../../shared/types';

export function mixColor(from: string, to: string, amount: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const a = parseInt(from.slice(offset, offset + 2), 16);
    const b = parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * amount).toString(16).padStart(2, '0');
  });
  return '#' + channels.join('');
}

function readableText(color: string): string {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

export function generateThemeTokens(background: string, text: string, accent: string, scheme: 'dark' | 'light'): ThemeTokens {
  const lift = scheme === 'dark' ? '#ffffff' : '#000000';
  return {
    '--bg': background,
    '--surface': mixColor(background, lift, 0.03),
    '--surface-raised': mixColor(background, lift, 0.06),
    '--surface-hover': mixColor(background, lift, 0.09),
    '--surface-active': mixColor(background, lift, 0.12),
    '--border': mixColor(background, text, 0.14),
    '--border-strong': mixColor(background, text, 0.24),
    '--text': text,
    '--text-secondary': mixColor(background, text, 0.78),
    '--muted': mixColor(background, text, 0.6),
    '--faint': mixColor(background, text, 0.45),
    '--accent': accent,
    '--accent-hover': mixColor(accent, text, 0.18),
    '--accent-soft': accent + '14',
    '--accent-line': accent + '38',
    '--on-accent': readableText(accent),
    '--success': scheme === 'dark' ? '#8fd0ab' : '#237a48',
    '--warning': scheme === 'dark' ? '#e8c37a' : '#936600',
    '--danger': scheme === 'dark' ? '#f09a9a' : '#bf3535',
  };
}
