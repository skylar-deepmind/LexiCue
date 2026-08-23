import { describe, expect, it } from 'vitest';
import { STAGE_COLOR_KEYS, STAGE_THEME_COLORS } from '../stageColors';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('learning stage theme colors', () => {
  it('defines six distinct, visible indicators in every theme', () => {
    for (const [theme, palette] of Object.entries(STAGE_THEME_COLORS)) {
      const colors = STAGE_COLOR_KEYS.map((stage) => palette[stage]);
      const surface = theme === 'midnight' ? '#1d222c' : '#ffffff';

      expect(new Set(colors).size, theme).toBe(STAGE_COLOR_KEYS.length);
      for (const color of colors) {
        expect(color, `${theme} color`).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(contrast(color, surface), `${theme} ${color}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
