/**
 * Curated vivid palettes for Cenar roles.
 *
 * The assignments are intentionally persistent: they feel varied like a random
 * palette while keeping role hierarchy recognisable after every bot restart.
 */
export const HOLOGRAPHIC_ROLE_COLORS = Object.freeze({
  primaryColor: '#A9C9FF',
  secondaryColor: '#FFBBEC',
  tertiaryColor: '#FFC3A0',
});

export const ROLE_COLOR_PALETTES = Object.freeze({
  '1348638945793019945': Object.freeze({ primaryColor: '#FF2D55', secondaryColor: '#FFCC00' }),
  '1282650552110678069': Object.freeze({ primaryColor: '#00F0FF', secondaryColor: '#5B2CFF' }),
  '1348638944740376680': Object.freeze({ primaryColor: '#00FFB2', secondaryColor: '#00A3FF' }),
  '1513388521862336683': HOLOGRAPHIC_ROLE_COLORS,
  '1489653862699897064': Object.freeze({ primaryColor: '#FF006E', secondaryColor: '#FFBE0B' }),
  '1406921057646018663': Object.freeze({ primaryColor: '#FF00CC', secondaryColor: '#7A00FF' }),
  '1483690185115046039': Object.freeze({ primaryColor: '#B000FF', secondaryColor: '#FF4FD8' }),
  '1282637901565399051': Object.freeze({ primaryColor: '#FF1744', secondaryColor: '#FF6D00' }),
  '1522844528237740066': Object.freeze({ primaryColor: '#6A00FF', secondaryColor: '#00FFD1' }),
  '1522844530242748446': Object.freeze({ primaryColor: '#FF3D00', secondaryColor: '#FFE600' }),
  '1513388523590385714': Object.freeze({ primaryColor: '#00B8FF', secondaryColor: '#8A2BE2' }),
  '1282637775291551776': Object.freeze({ primaryColor: '#FF003C', secondaryColor: '#FF00A8' }),
  '1282637814571466808': Object.freeze({ primaryColor: '#00E5FF', secondaryColor: '#5C6CFF' }),
  '1282637470139420694': Object.freeze({ primaryColor: '#7A00FF', secondaryColor: '#FF006E' }),
  '1282637168149532724': Object.freeze({ primaryColor: '#FFB300', secondaryColor: '#FFFF00' }),
  '1513388525121437736': Object.freeze({ primaryColor: '#00FF7F', secondaryColor: '#00C8FF' }),
  '1282637103045279820': Object.freeze({ primaryColor: '#00E676', secondaryColor: '#76FF03' }),
  '1282638730812854345': Object.freeze({ primaryColor: '#2979FF', secondaryColor: '#00E5FF' }),
  '1451978651162771596': Object.freeze({ primaryColor: '#FFD600', secondaryColor: '#FF3D00' }),
  '1513388526312362108': Object.freeze({ primaryColor: '#7C3AED', secondaryColor: '#00E5FF' }),
  '1282638601066123325': Object.freeze({ primaryColor: '#3D5AFE', secondaryColor: '#E040FB' }),
  '1468389308426616895': Object.freeze({ primaryColor: '#FF0033', secondaryColor: '#FF7A00' }),
});

export function roleColorsFor(roleId, { enhanced = true } = {}) {
  const palette = ROLE_COLOR_PALETTES[roleId];
  if (!palette) return null;
  return enhanced
    ? { ...palette }
    : { primaryColor: palette.primaryColor };
}
