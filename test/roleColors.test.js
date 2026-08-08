import { describe, expect, it } from 'vitest';
import {
  HOLOGRAPHIC_ROLE_COLORS,
  ROLE_COLOR_PALETTES,
  roleColorsFor,
} from '../src/config/roleColors.js';

const HEX_COLOR = /^#[0-9A-F]{6}$/;

describe('Cenar vivid role palettes', () => {
  it('defines a unique enhanced-color style for every designed role', () => {
    const palettes = Object.values(ROLE_COLOR_PALETTES);
    expect(palettes).toHaveLength(22);

    const pairs = new Set();
    for (const palette of palettes) {
      expect(palette.primaryColor).toMatch(HEX_COLOR);
      expect(palette.secondaryColor).toMatch(HEX_COLOR);
      expect(palette.primaryColor).not.toBe(palette.secondaryColor);
      if (palette.tertiaryColor) expect(palette).toEqual(HOLOGRAPHIC_ROLE_COLORS);
      pairs.add(`${palette.primaryColor}:${palette.secondaryColor}`);
    }

    expect(pairs.size).toBe(palettes.length);
    expect(palettes.filter((palette) => palette.tertiaryColor)).toHaveLength(1);
  });

  it('falls back to a solid primary color for guilds without enhanced role colors', () => {
    expect(roleColorsFor('1522844528237740066', { enhanced: false })).toEqual({
      primaryColor: '#6A00FF',
    });
  });

  it('uses the Discord holographic triplet for the signature role', () => {
    expect(roleColorsFor('1513388521862336683')).toEqual(HOLOGRAPHIC_ROLE_COLORS);
  });

  it('returns null for an unknown role', () => {
    expect(roleColorsFor('unknown')).toBeNull();
  });
});
