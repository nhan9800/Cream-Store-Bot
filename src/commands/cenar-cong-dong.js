import { ContainerBuilder, MessageFlags, SeparatorBuilder, SlashCommandBuilder, TextDisplayBuilder } from 'discord.js';
import { bookingCommunity, isBookingCommunityGuild } from '../events/bookingCommunityEvents.js';
import { bookingPortal } from '../services/bookingStoreSetupService.js';
import { COMMUNITY_GAMES, communityWordPuzzle, playCommunityGame } from '../services/bookingCommunityGames.js';
import { COMMUNITY_SHOP, MAX_CONNECTIONS } from '../services/bookingCommunityService.js';

export const bookingOnly = true;

const socialActions = [
  ['Mời kết nối', 'request'], ['Chấp nhận lời mời', 'accept'], ['Hủy kết nối hoặc lời mời', 'remove'],
  ['Cầu hôn', 'propose'], ['Tặng lời động viên', 'interact'], ['Cho thú cưng ăn', 'feedPet'],
];
const socialStatus = {
  self: 'Hãy chọn một thành viên khác.',
  'opt-in': 'Cả hai cần tự bật kết nối trước bằng `/cenar-cong-dong ket-noi`.',
  'already-exists': 'Đã có lời mời hoặc kết nối giữa hai bạn.',
  capacity: `Một trong hai đã có ${MAX_CONNECTIONS} lời mời hoặc kết nối.`,
  cooldown: 'Vui lòng chờ ít nhất một phút trước khi tương tác tiếp.',
  requested: 'Đã tạo lời mời trong 24 giờ. Thành viên kia có thể mở `/cenar-cong-dong ban-be` để xem và chấp nhận.',
  proposed: 'Đã đặt lời cầu hôn trong 24 giờ. Thành viên kia có thể mở `/cenar-cong-dong ban-be` để xem và chấp nhận.',
  'missing-link': 'Hai bạn cần chấp nhận kết nối trước.',
  'already-married': 'Mỗi thành viên chỉ có thể tham gia một cặp kết hôn.',
  'missing-ring': 'Cần một nhẫn kỷ niệm từ cửa hàng cộng đồng.',
  'no-request': 'Bạn chưa có lời mời hợp lệ từ thành viên này.',
  linked: 'Hai bạn đã kết nối.',
  married: 'Đã xác nhận kết hôn. Hai bạn có thể cùng chăm thú cưng.',
  removed: 'Đã hủy kết nối hoặc lời mời.',
  'requires-marriage': 'Chỉ hai người đã cùng xác nhận kết hôn mới nuôi thú cưng chung.',
  'missing-food': 'Hãy lấy thức ăn từ cửa hàng hoặc quà hằng ngày.',
};

const sections = [
  ['bat-dau', 'Xem cách tham gia cộng đồng'],
  ['ho-so', 'Xem cấp, điểm và túi đồ của bạn'],
  ['diem-danh', 'Điểm danh và nhận điểm theo chuỗi ngày'],
  ['nhiem-vu', 'Xem tiến độ và nhận thưởng sau khi hoàn thành'],
  ['xep-hang', 'Xem 10 thành viên có nhiều XP nhất'],
  ['cua-hang', 'Xem và mua vật phẩm cộng đồng bằng điểm'],
  ['mo-qua', 'Nhận một phần quà miễn phí mỗi ngày'],
  ['choi', 'Chơi một trong sáu trò miễn phí'],
  ['tro-tu', 'Chơi Nối từ hoặc Đoán từ hằng ngày'],
  ['ket-noi', 'Chọn tham gia hoặc rời khu kết nối'],
  ['ban-be', 'Xem lời mời và các kết nối của riêng bạn'],
  ['tuong-tac', 'Mời, chấp nhận, tương tác hoặc chăm thú cưng'],
];

export const data = new SlashCommandBuilder().setName('cenar-cong-dong')
  .setDescription('Điểm danh, nhiệm vụ, trò chơi và kết nối trong Cenar Booking');
for (const [name, description] of sections) {
  data.addSubcommand(subcommand => {
    subcommand.setName(name).setDescription(description);
    if (name === 'cua-hang') subcommand.addStringOption(option => option.setName('mua').setDescription('Chọn vật phẩm để mua')
      .addChoices(...Object.entries(COMMUNITY_SHOP).map(([value, item]) => ({ name: `${item.label} · ${item.cost} điểm`, value }))));
    if (name === 'choi') subcommand.addStringOption(option => option.setName('tro').setDescription('Chọn trò chơi')
      .addChoices(...Object.entries(COMMUNITY_GAMES).map(([value, game]) => ({ name: game.label, value }))).setRequired(true))
      .addStringOption(option => option.setName('lua-chon').setDescription('Chọn một đáp án nếu trò đó yêu cầu')
        .addChoices(...[
          ['Cao', 'cao'], ['Thấp', 'thap'], ['Cửa Cát', 'cat'], ['Cửa Biển', 'bien'], ['Sấp', 'sap'],
          ['Ngửa', 'ngua'], ['Rút bài', 'rut'], ['Dừng', 'dung'],
        ].map(([name, value]) => ({ name, value }))));
    if (name === 'tro-tu') subcommand.addStringOption(option => option.setName('tro').setDescription('Chọn trò chơi chữ')
      .addChoices({ name: 'Nối từ', value: 'noi-tu' }, { name: 'Đoán từ', value: 'doan-tu' }).setRequired(true))
      .addStringOption(option => option.setName('dap-an').setDescription('Để trống để xem đề').setMaxLength(40));
    if (name === 'ket-noi') subcommand.addBooleanOption(option => option.setName('bat').setDescription('Cho phép lời mời kết nối').setRequired(true));
    if (name === 'tuong-tac') subcommand.addStringOption(option => option.setName('hanh-dong').setDescription('Chọn hành động')
      .addChoices(...socialActions.map(([name, value]) => ({ name, value }))).setRequired(true))
      .addUserOption(option => option.setName('thanh-vien').setDescription('Chọn thành viên Cenar Booking').setRequired(true));
    return subcommand;
  });
}

function card(interaction, title, lines) {
  const icon = bookingPortal(interaction.client)?.emoji?.reviews;
  const titleIcon = icon ? `<${icon.animated ? 'a' : ''}:${icon.name}:${icon.id}> ` : '';
  const section = new ContainerBuilder().setAccentColor(0x675acb)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${titleIcon}${title}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return interaction.reply({ components: [section], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

const playNotice = '-# Trò chơi miễn phí. Điểm chỉ dùng cho vật phẩm cộng đồng và không có giá trị quy đổi.';
const cooldownNotice = 'Bạn vừa chơi xong. Hãy đợi 10 giây giữa các lượt.';

export async function execute(interaction) {
  if (!isBookingCommunityGuild(interaction.client, interaction.guildId)) {
    return interaction.reply({ content: 'Tính năng này dùng trong Cenar Booking.', flags: MessageFlags.Ephemeral });
  }
  const options = interaction.options;
  const id = interaction.user.id;
  const community = bookingCommunity();
  const show = (title, ...lines) => card(interaction, title, lines);
  switch (options.getSubcommand()) {
    case 'bat-dau':
      return show('Sinh hoạt Cenar Booking',
        '**Nhận XP** · Trò chuyện tại `#tro-chuyen` hoặc ở phòng voice cộng đồng với một thành viên khác.',
        '**Điểm danh và nhiệm vụ** · Dùng `diem-danh` và `nhiem-vu` trong `/cenar-cong-dong`. Ngày mới bắt đầu lúc 00:00 giờ Việt Nam.',
        '**Trò chơi và vật phẩm** · `choi`, `tro-tu`, `cua-hang`, `mo-qua`.',
        '**Bạn bè** · Dùng `ket-noi` để tham gia, `ban-be` để xem lời mời và `tuong-tac` để trả lời.', playNotice);
    case 'ho-so': {
      const profile = community.profile(id);
      const items = Object.entries(COMMUNITY_SHOP).filter(([sku]) => profile.inventory[sku] > 0)
        .map(([sku, item]) => `• ${item.label} × ${profile.inventory[sku]}`);
      return show('Hồ sơ của bạn', `**Cấp ${profile.level}** · ${profile.xp} XP · ${profile.points} điểm · Chuỗi ${profile.streak} ngày`,
        '', '### Túi đồ', ...(items.length ? items : ['Chưa có vật phẩm.']));
    }
    case 'diem-danh': {
      const result = community.checkIn(id);
      return show('Điểm danh', result.status === 'claimed' ? 'Bạn đã điểm danh hôm nay.' : `Đã cộng **${result.points} điểm**.`,
        `Chuỗi hiện tại **${result.streak} ngày**.`);
    }
    case 'nhiem-vu': {
      const result = community.claimDaily(id);
      const tasks = community.profile(id).daily.map(({ label, count, goal }) => `• ${label} · **${Math.min(count, goal)}/${goal}**`);
      const bonus = result.status === 'awarded' ? 'Đã nhận **25 điểm**.'
        : result.status === 'claimed' ? 'Bạn đã nhận thưởng hôm nay.' : 'Khi đủ bốn nhiệm vụ, mở lại để nhận 25 điểm.';
      return show('Nhiệm vụ hôm nay', ...tasks, '', bonus);
    }
    case 'xep-hang': {
      const board = community.rank();
      return show('Bảng xếp hạng XP', ...(board.length ? board.map((entry, index) => `${index + 1}. <@${entry.user_id}> · **${entry.xp} XP**`)
        : ['Bảng xếp hạng chưa có kết quả.']));
    }
    case 'cua-hang': {
      const sku = options.getString('mua');
      if (!sku) return show('Cửa hàng cộng đồng', ...Object.values(COMMUNITY_SHOP).map(item => `• ${item.label} · **${item.cost} điểm**`), playNotice);
      const result = community.buy(id, sku);
      return show('Cửa hàng cộng đồng', result.status === 'bought' ? `Đã mua **${result.label}**. Bạn còn **${result.points} điểm**.`
        : result.status === 'already-owned' ? 'Bạn đã có huy hiệu này.' : 'Bạn chưa đủ điểm hoặc vật phẩm không còn khả dụng.');
    }
    case 'mo-qua': {
      const result = community.openBox(id);
      return show('Quà mỗi ngày', result.status === 'claimed' ? 'Bạn đã mở quà hôm nay.' : 'Đã thêm **1 thức ăn cho thú cưng** vào túi đồ.');
    }
    case 'choi': {
      const game = options.getString('tro', true);
      const rules = Object.hasOwn(COMMUNITY_GAMES, game) ? COMMUNITY_GAMES[game] : null;
      const choice = options.getString('lua-chon');
      if (!rules) return show('Trò chơi', 'Hãy chọn trò từ danh sách.');
      if (rules.choices.length && !rules.choices.includes(choice)) return show(rules.label, 'Hãy chọn một giá trị trong mục `lua-chon` phù hợp với trò.', playNotice);
      const result = community.play(id, () => playCommunityGame(game, choice));
      return show(rules.label, result.status === 'played' ? `${result.description}\n\nĐiểm thưởng **+${result.points}**.` : cooldownNotice, playNotice);
    }
    case 'tro-tu': {
      const game = options.getString('tro', true);
      if (!['noi-tu', 'doan-tu'].includes(game)) return show('Trò chơi chữ', 'Hãy chọn Nối từ hoặc Đoán từ.');
      const label = game === 'noi-tu' ? 'Nối từ' : 'Đoán từ';
      const answer = options.getString('dap-an')?.trim();
      if (!answer) return show(label, communityWordPuzzle(game).prompt, '-# Mỗi trò có một lượt trả lời mỗi ngày.');
      const result = community.play(id, now => communityWordPuzzle(game, answer, now), game);
      const notice = result.status === 'played' ? `${result.description}\n\nĐiểm thưởng **+${result.points}**.`
        : result.status === 'already-played' ? 'Bạn đã trả lời bài này hôm nay.' : cooldownNotice;
      return show(label, notice, playNotice);
    }
    case 'ket-noi': {
      const enabled = options.getBoolean('bat', true);
      community.setConnections(id, enabled);
      return show('Kết nối', enabled ? 'Đã bật nhận lời mời. Bạn có thể xem lời mời riêng tại `ban-be`.'
        : 'Đã tắt nhận lời mời và gỡ các lời mời, kết nối đang có.');
    }
    case 'ban-be': {
      const connections = community.connections(id);
      const states = { pending: 'Lời mời kết nối', linked: 'Bạn bè', proposal: 'Lời cầu hôn', married: 'Đã kết hôn' };
      return show('Lời mời và bạn bè', ...(connections.length ? connections.map(record => {
        const pending = ['pending', 'proposal'].includes(record.state);
        const label = pending ? `${states[record.state]} ${record.incoming ? 'đã nhận' : 'đã gửi'}`
          : `${states[record.state]} · ${record.affinity} thân thiết${record.state === 'married' ? ` · Pet cấp ${record.pet + 1}` : ''}`;
        return `• <@${record.peer}> · ${label}`;
      }) : ['Bạn chưa có lời mời hoặc kết nối.']));
    }
    case 'tuong-tac': {
      const target = options.getUser('thanh-vien', true);
      const member = options.getMember('thanh-vien');
      if (target.bot || !member) return show('Kết nối', 'Hãy chọn một thành viên của máy chủ.');
      const action = options.getString('hanh-dong', true);
      if (!socialActions.some(([, value]) => value === action)) return show('Kết nối', 'Hành động không hợp lệ.');
      const result = community[action](id, target.id);
      if (result.status === 'interacted') return show('Kết nối', `Đã gửi lời động viên. Mức thân thiết **${result.affinity}**.`);
      if (result.status === 'fed') return show('Thú cưng chung', `Thú cưng đã lên **cấp ${result.pet + 1}**.`);
      return show('Kết nối', socialStatus[result.status]);
    }
    default:
      return show('Sinh hoạt Cenar Booking', 'Dùng `bat-dau` để xem hướng dẫn.');
  }
}
