/**
 * Curated vivid palettes for Cenar roles.
 *
 * The assignments are intentionally persistent: they feel varied like a random
 * palette while keeping role hierarchy recognisable after every bot restart.
 */
export const ROLE_COLOR_PALETTES = Object.freeze({
  '1348638945793019945': Object.freeze({ primaryColor: '#FF8A00', secondaryColor: '#FFD166' }),
  '1282650552110678069': Object.freeze({ primaryColor: '#00C6FF', secondaryColor: '#7AE7FF' }),
  '1348638944740376680': Object.freeze({ primaryColor: '#00D2A8', secondaryColor: '#7CF7E2' }),
  '1513388521862336683': Object.freeze({ primaryColor: '#9D4EDD', secondaryColor: '#FF4D9D' }),
  '1489653862699897064': Object.freeze({ primaryColor: '#FF3D81', secondaryColor: '#FF9AC1' }),
  '1406921057646018663': Object.freeze({ primaryColor: '#FF6EC7', secondaryColor: '#B76DFF' }),
  '1483690185115046039': Object.freeze({ primaryColor: '#A855F7', secondaryColor: '#F0ABFC' }),
  '1282637901565399051': Object.freeze({ primaryColor: '#FF416C', secondaryColor: '#FF9A8B' }),
  '1522844528237740066': Object.freeze({ primaryColor: '#6C5CE7', secondaryColor: '#00CEC9' }),
  '1522844530242748446': Object.freeze({ primaryColor: '#FF7A18', secondaryColor: '#FFD166' }),
  '1513388523590385714': Object.freeze({ primaryColor: '#4F46E5', secondaryColor: '#38BDF8' }),
  '1282637775291551776': Object.freeze({ primaryColor: '#FF1744', secondaryColor: '#FF6B8A' }),
  '1282637814571466808': Object.freeze({ primaryColor: '#00B4D8', secondaryColor: '#90E0EF' }),
  '1282637470139420694': Object.freeze({ primaryColor: '#6D28D9', secondaryColor: '#DB2777' }),
  '1282637168149532724': Object.freeze({ primaryColor: '#F59E0B', secondaryColor: '#FFF07A' }),
  '1513388525121437736': Object.freeze({ primaryColor: '#10B981', secondaryColor: '#67E8F9' }),
  '1282637103045279820': Object.freeze({ primaryColor: '#00B894', secondaryColor: '#55EFC4' }),
  '1282638730812854345': Object.freeze({ primaryColor: '#4F8CFF', secondaryColor: '#A5B4FC' }),
  '1451978651162771596': Object.freeze({ primaryColor: '#FFB703', secondaryColor: '#FB8500' }),
  '1513388526312362108': Object.freeze({ primaryColor: '#64748B', secondaryColor: '#C084FC' }),
  '1282638601066123325': Object.freeze({ primaryColor: '#5865F2', secondaryColor: '#9B8AFB' }),
  '1468389308426616895': Object.freeze({ primaryColor: '#E11D48', secondaryColor: '#FF6B6B' }),
});

export function roleColorsFor(roleId, { enhanced = true } = {}) {
  const palette = ROLE_COLOR_PALETTES[roleId];
  if (!palette) return null;
  return enhanced
    ? { primaryColor: palette.primaryColor, secondaryColor: palette.secondaryColor }
    : { primaryColor: palette.primaryColor };
}
