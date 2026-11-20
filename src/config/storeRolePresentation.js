// Role IDs identify existing access and membership. This table is presentation only.
const styles = {
  '1282643170076786769': ['Cenar · Quản trị cấp cao', '#FFD6A2', '#FFACE4', '7187-key.png'],
  '1452895134021845022': ['Cenar · Điều hành', '#F4C9FF', '#86C6FF', '4817-staff.png'],
  '1282638119497109524': ['Cenar Founder · Sáng lập', '#FFE3AD', '#FFABD8', '807617-yellowcrown.png'],
  '1348638945793019945': ['Cenar Executive · Quản trị', '#FF968B', '#FFC48F', '94919-admin.png'],
  '1282650552110678069': ['Cenar Care · Hỗ trợ', '#79E2FF', '#A393FF', '586619-phonecall.png'],
  '1348638944740376680': ['Cenar Concierge · Ticket', '#8CECD5', '#75BBFF', '51198-ticketsupportroleicon.png'],
  '1489653862699897064': ['Cenar Blossom', '#FFA9DC', '#FFCE9F', '463819-giveaway.png'],
  '1406921057646018663': ['Cenar Sugar · Quản trị', '#D8A8FF', '#FF9BC8', 'PurpleHeart.png'],
  '1483690185115046039': ['Cenar Chị Guột', '#FFC09B', '#FF96B3', '770098-heart.png'],
  '1282637901565399051': ['Cenar Rosé', '#FFA1BC', '#DFB4FF', '958995-designpalette.png'],
  '1522844530242748446': ['Cenar CTV', '#FFD58A', '#FF99A2', '481598-members.png'],
  '1522844528237740066': ['Cenar Partner', '#98E8C3', '#80B7FF', '69896-partner.png'],
  '1513388523590385714': ['Cenar Circle · Huy hiệu', '#B4BBFF', '#82E4F6', '27687-bookmark.png'],
  '1282637775291551776': ['Cenar Sovereign · 8M+', '#FFE19C', '#FFB384', '15394-trophy.png'],
  '1282637814571466808': ['Cenar Prestige · 5M+', '#86E5FF', '#C1AAFF', '597339-diamond.png'],
  '1282637470139420694': ['Cenar Signature · 3M+', '#C3AAFF', '#FFB6E0', '715705-medal.png'],
  '1282637168149532724': ['Cenar Select · 1M+', '#A5C5FF', '#86E8DE', '510611-star.png'],
  '1282637103045279820': ['Cenar Patron', '#98ECCB', '#E1F69C', '435031-shoppingcart.png'],
  '1282638730812854345': ['Cenar Explorer', '#BDD8FF', '#9BE0EC', '77710-compass.png'],
  '1451978651162771596': ['Cenar · Chờ đánh giá', '#FFD36D', '#FDA286', '521557-textmessage.png'],
  '1282638601066123325': ['Cenar · Tự động hóa', '#83B8FF', '#9E9AFF', '677035-robot.png'],
  '1468389308426616895': ['Cenar · Hạn chế', '#FF8F9D', '#BD9BDB', '414779-lock.png'],
};

export const STORE_ROLE_PRESENTATION = Object.freeze(Object.fromEntries(
  Object.entries(styles).map(([id, [name, primaryColor, secondaryColor, icon]]) =>
    [id, Object.freeze({ name, primaryColor, secondaryColor, icon })]),
));

export function storeRoleIconUrl(roleId) {
  const style = STORE_ROLE_PRESENTATION[roleId];
  return style ? new URL(`../../assets/emojis/ui27/${style.icon}`, import.meta.url) : null;
}
