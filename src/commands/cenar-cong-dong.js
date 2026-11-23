import { ActionRowBuilder, ButtonStyle, MessageFlags, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { bookingCommunity, isBookingCommunityGuild } from '../events/bookingCommunityEvents.js';
import { bookingPortal } from '../services/bookingStoreSetupService.js';
import { COMMUNITY_GAMES, communityWordPuzzle, playCommunityGame } from '../services/bookingCommunityGames.js';
import { COMMUNITY_SHOP, MAX_CONNECTIONS, communityDay } from '../services/bookingCommunityService.js';
import {
  communityButton, communityCard, communityCheckInCard, communityColors, communityConnectionsCard,
  communityMissionCard, communityNumber, communityPlayNote, communityProfileCard, communityResetTime, communityShopCard,
} from '../utils/bookingCommunityViews.js';

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

const choiceLabels = {
  cao: 'Cao', thap: 'Thấp', cat: 'Cửa Cát', bien: 'Cửa Biển', sap: 'Sấp', ngua: 'Ngửa', rut: 'Rút bài', dung: 'Dừng',
};
const gameRules = {
  'xuc-xac': 'Đoán tổng của ba viên xúc xắc. Từ 11 trở lên là Cao, dưới 11 là Thấp.',
  'hai-cua': 'Chọn Cát hoặc Biển. Mỗi cửa nhận một điểm ngẫu nhiên từ 1 đến 10.',
  'tung-xu': 'Đoán đồng xu sẽ rơi mặt sấp hay mặt ngửa.',
  'bai-21': 'Chọn rút thêm một lá hoặc dừng ở hai lá. Điểm cao hơn thắng nếu không vượt quá 21.',
  'cau-ca': 'Thả câu để xem bạn kéo lên được gì.',
  'ba-o': 'Mở ba ô. Bạn thắng nếu cả ba ô hiện cùng một biểu tượng.',
};
const wordGames = { 'noi-tu': 'Nối từ', 'doan-tu': 'Đoán từ' };
const latestShop = new Map();
const SHOP_VIEW_TTL_MS = 15 * 60_000;
const MAX_SHOP_VIEWS = 2000;

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

const cooldownNotice = 'Bạn vừa chơi xong. Chờ 10 giây giữa hai lượt.';
const validSnowflake = value => /^\d{17,20}$/u.test(value);
const privateReply = content => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const contextFor = interaction => ({ owner: interaction.user.id, version: interaction.id,
  emoji: bookingPortal(interaction.client)?.emoji });

function viewShop(context, community, notice) {
  latestShop.delete(context.owner);
  latestShop.set(context.owner, { version: context.version, expiresAt: Date.now() + SHOP_VIEW_TTL_MS });
  if (latestShop.size > MAX_SHOP_VIEWS) latestShop.delete(latestShop.keys().next().value);
  return communityShopCard(context, community.profile(context.owner), notice);
}

function feedbackFromPurchase(result) {
  if (result.status === 'bought') return `Đã thêm **${result.label}** vào túi đồ.`;
  if (result.status === 'already-owned') return 'Bạn đã sở hữu huy hiệu này.';
  if (result.status === 'insufficient') return 'Số dư hiện tại chưa đủ để mua vật phẩm.';
  return 'Không tìm thấy vật phẩm.';
}

function viewGift(context, community) {
  const { status } = community.openBox(context.owner);
  return communityCard(context, {
    title: 'Quà mỗi ngày', color: communityColors.copper,
    lead: status === 'claimed' ? 'Bạn đã nhận quà hôm nay.' : 'Đã thêm **1 thức ăn cho thú cưng** vào túi đồ.',
    footnote: `Lượt nhận tiếp theo <t:${communityResetTime()}:R>.`,
    buttons: [communityButton(context, 'profile', 'Xem túi đồ', { icon: 'profiles' })],
  });
}

function viewMissions(context, community) {
  const result = community.claimDaily(context.owner);
  return communityMissionCard(context, community.profile(context.owner).daily, result);
}

function gameControls(context, game) {
  const choices = COMMUNITY_GAMES[game].choices;
  if (!choices.length) {
    const label = game === 'cau-ca' ? 'Thả câu' : 'Mở ba ô';
    return [communityButton(context, `game:${game}`, label, { style: ButtonStyle.Primary, icon: 'game' })];
  }
  return choices.map(choice => communityButton(context, `game:${game}:${choice}`, choiceLabels[choice], { style: ButtonStyle.Primary }));
}

function viewGame(context, game, choice, result) {
  const controls = gameControls(context, game);
  const title = COMMUNITY_GAMES[game].label;
  if (!result || result.status === 'cooldown') {
    return communityCard(context, {
      title, lead: result ? cooldownNotice : undefined, fields: [{ label: 'Cách chơi', body: gameRules[game] }],
      color: communityColors.copper, icon: 'game', buttons: controls, footnote: communityPlayNote,
    });
  }
  const fields = [...(result.display ?? [{ body: result.description }])];
  if (choice) fields.push({ label: 'Bạn đã chọn', body: choiceLabels[choice] });
  return communityCard(context, {
    title,
    lead: `**${result.won ? 'Bạn thắng' : result.tied ? 'Hai bên hòa' : 'Lượt chơi hoàn tất'}** · +${communityNumber(result.points)} điểm cộng đồng`,
    fields, color: result.won ? communityColors.mint : communityColors.blue, icon: 'game', buttons: controls,
    footnote: communityPlayNote,
  });
}

function viewWordPrompt(context, game, { now = Date.now(), notice } = {}) {
  return communityCard(context, {
    title: wordGames[game], lead: ['**Tiếng Việt** · Một lượt trả lời mỗi ngày', notice].filter(Boolean).join('\n'),
    fields: [{ label: 'Đề hôm nay', body: communityWordPuzzle(game, '', now).prompt }], icon: 'game', color: communityColors.blue,
    buttons: [communityButton(context, `answer:${game}:${communityDay(now)}`, 'Nhập đáp án', { style: ButtonStyle.Primary })],
    footnote: `Đề mới <t:${communityResetTime(now)}:R>.`,
  });
}

function viewWordResult(context, game, result) {
  if (result.status === 'cooldown') return viewWordPrompt(context, game, { notice: cooldownNotice });
  const played = result.status === 'played';
  return communityCard(context, {
    title: wordGames[game],
    lead: played ? `**${result.won ? 'Đáp án hợp lệ' : 'Chưa đúng'}** · +${communityNumber(result.points)} điểm cộng đồng`
      : 'Bạn đã trả lời đề này hôm nay.',
    fields: played ? [{ label: 'Kết quả', body: result.description }] : [],
    icon: 'game', color: result.won ? communityColors.mint : communityColors.blue, footnote: `Đề mới <t:${communityResetTime()}:R>.`,
  });
}

export async function execute(interaction) {
  if (!isBookingCommunityGuild(interaction.client, interaction.guildId)) {
    return interaction.reply({ content: 'Tính năng này dùng trong Cenar Booking.', flags: MessageFlags.Ephemeral });
  }
  const options = interaction.options;
  const id = interaction.user.id;
  const community = bookingCommunity();
  const context = contextFor(interaction);
  const open = payload => interaction.reply(payload);
  const show = spec => open(communityCard(context, spec));
  switch (options.getSubcommand()) {
    case 'bat-dau':
      return show({ title: 'Góc cộng đồng Cenar', fields: [
        { label: 'Nhận XP', body: 'Trò chuyện tại `#tro-chuyen` hoặc vào phòng voice cộng đồng cùng một thành viên khác.' },
        { label: 'Chơi và nhận vật phẩm', body: 'Điểm danh, hoàn thành nhiệm vụ hoặc chơi bằng `choi` và `tro-tu`. Dùng điểm trong cửa hàng cộng đồng.' },
        { label: 'Kết nối', body: 'Mở `ket-noi` để nhận lời mời, dùng `ban-be` để xem và `tuong-tac` để trả lời.' },
      ], buttons: [communityButton(context, 'checkin', 'Điểm danh', { icon: 'calendar' }),
        communityButton(context, 'missions', 'Nhiệm vụ', { icon: 'game' }), communityButton(context, 'shop', 'Cửa hàng', { icon: 'apply' })] });
    case 'ho-so':
      return open(communityProfileCard(context, community.profile(id)));
    case 'diem-danh':
      return open(communityCheckInCard(context, community.checkIn(id)));
    case 'nhiem-vu':
      return open(viewMissions(context, community));
    case 'xep-hang': {
      const board = community.rank();
      return show({ title: 'Bảng xếp hạng XP', color: communityColors.copper, fields: [
        { body: board.length ? board.map((entry, index) => `**${String(index + 1).padStart(2, '0')}** · <@${entry.user_id}> · **${communityNumber(entry.xp)} XP**`).join('\n')
          : 'Bảng xếp hạng chưa có kết quả.' },
      ] });
    }
    case 'cua-hang': {
      const sku = options.getString('mua');
      const notice = sku ? feedbackFromPurchase(community.buy(id, sku)) : undefined;
      return open(viewShop(context, community, notice));
    }
    case 'mo-qua':
      return open(viewGift(context, community));
    case 'choi': {
      const game = options.getString('tro', true);
      const rules = Object.hasOwn(COMMUNITY_GAMES, game) ? COMMUNITY_GAMES[game] : null;
      const choice = options.getString('lua-chon');
      if (!rules) return show({ title: 'Trò chơi', lead: 'Hãy chọn trò từ danh sách.' });
      if (rules.choices.length && !rules.choices.includes(choice)) return open(viewGame(context, game));
      const result = community.play(id, () => playCommunityGame(game, choice));
      return open(viewGame(context, game, rules.choices.includes(choice) ? choice : null, result));
    }
    case 'tro-tu': {
      const game = options.getString('tro', true);
      if (!Object.hasOwn(wordGames, game)) return show({ title: 'Trò chơi chữ', lead: 'Hãy chọn Nối từ hoặc Đoán từ.' });
      const answer = options.getString('dap-an')?.trim();
      if (!answer) return open(viewWordPrompt(context, game));
      const result = community.play(id, now => communityWordPuzzle(game, answer, now), game);
      return open(viewWordResult(context, game, result));
    }
    case 'ket-noi': {
      const enabled = options.getBoolean('bat', true);
      community.setConnections(id, enabled);
      return show({ title: enabled ? 'Đã bật kết nối' : 'Đã tắt kết nối', icon: 'profiles',
        lead: enabled ? 'Bạn có thể nhận và xem lời mời riêng.' : 'Lời mời và kết nối đang có đã được gỡ.',
        buttons: enabled ? [communityButton(context, 'connections', 'Xem lời mời', { icon: 'profiles' })] : [] });
    }
    case 'ban-be':
      return open(communityConnectionsCard(context, community.connections(id)));
    case 'tuong-tac': {
      const target = options.getUser('thanh-vien', true);
      const member = options.getMember('thanh-vien');
      if (target.bot || !member) return show({ title: 'Kết nối', lead: 'Hãy chọn một thành viên của máy chủ.' });
      const action = options.getString('hanh-dong', true);
      if (!socialActions.some(([, value]) => value === action)) return show({ title: 'Kết nối', lead: 'Hành động không hợp lệ.' });
      const result = community[action](id, target.id);
      const fed = result.status === 'fed';
      return show({ title: fed ? 'Thú cưng chung' : 'Kết nối', color: fed ? communityColors.mint : communityColors.blue,
        lead: result.status === 'interacted' ? `Đã gửi lời động viên cho <@${target.id}>.` : fed ? `Thú cưng chung của bạn và <@${target.id}> đã ăn.`
          : socialStatus[result.status],
        fields: fed ? [{ label: 'Cấp thú cưng', body: `**Cấp ${result.pet + 1}**` }]
          : result.status === 'interacted' ? [{ label: 'Mức thân thiết', body: `**${communityNumber(result.affinity)}**` }] : [],
        buttons: [communityButton(context, 'connections', 'Lời mời và bạn bè', { icon: 'profiles' })] });
    }
    default:
      return show({ title: 'Góc cộng đồng Cenar', lead: 'Dùng `bat-dau` để xem hướng dẫn.' });
  }
}

export async function handleBookingCommunityInteraction(interaction) {
  const [, , owner, action, option, value, ...extra] = interaction.customId.split(':');
  const reject = content => interaction.reply(privateReply(content));
  if (!isBookingCommunityGuild(interaction.client, interaction.guildId) || !validSnowflake(owner)
    || extra.length || interaction.user.id !== owner) {
    await reject('Bảng này chỉ mở được bằng tài khoản đã gọi lệnh trong Cenar Booking.');
    return true;
  }
  if (interaction.isButton() && interaction.message?.author?.id !== interaction.client.user?.id) {
    await reject('Bảng này không còn sử dụng được. Hãy mở lại lệnh cộng đồng.');
    return true;
  }
  const context = contextFor(interaction);
  const community = bookingCommunity();
  if (action === 'answer' && Object.hasOwn(wordGames, option)) {
    const today = communityDay(Date.now());
    if (value !== today) {
      await reject('Đề này đã hết lượt trong ngày. Mở `/cenar-cong-dong tro-tu` để lấy đề mới.');
    } else if (interaction.isButton()) {
      await interaction.showModal(new ModalBuilder().setCustomId(interaction.customId).setTitle(wordGames[option])
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('answer').setLabel('Đáp án của bạn')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40))));
    } else if (interaction.isModalSubmit()) {
      const answer = interaction.fields.getTextInputValue('answer').trim();
      if (!answer || answer.length > 40) {
        await reject('Nhập đáp án dài từ 1 đến 40 ký tự.');
      } else {
        const result = community.play(owner, now => communityWordPuzzle(option, answer, now), option);
        await interaction.reply(viewWordResult(context, option, result));
      }
    }
    return true;
  }
  if (!interaction.isButton()) {
    await reject('Bảng này không còn sử dụng được. Hãy mở lại lệnh cộng đồng.');
    return true;
  }
  let payload;
  switch (action) {
    case 'shop': payload = viewShop(context, community); break;
    case 'gift': payload = viewGift(context, community); break;
    case 'checkin': payload = communityCheckInCard(context, community.checkIn(owner)); break;
    case 'missions': payload = viewMissions(context, community); break;
    case 'profile': payload = communityProfileCard(context, community.profile(owner)); break;
    case 'connections': payload = communityConnectionsCard(context, community.connections(owner)); break;
    case 'buy': {
      const offer = latestShop.get(owner);
      if (!Object.hasOwn(COMMUNITY_SHOP, option) || !validSnowflake(value) || !offer || offer.version !== value || Date.now() >= offer.expiresAt) {
        await reject('Bảng giá đã đổi hoặc đã xử lý lần bấm trước. Hãy dùng bảng mới nhất hoặc mở lại cửa hàng.');
        return true;
      }
      // Retire this card before spending points so two rapid clicks cannot buy twice.
      latestShop.delete(owner);
      payload = viewShop(context, community, feedbackFromPurchase(community.buy(owner, option)));
      break;
    }
    case 'game': {
      if (!Object.hasOwn(COMMUNITY_GAMES, option)) break;
      const { choices } = COMMUNITY_GAMES[option];
      if (choices.length ? !choices.includes(value) : value !== undefined) break;
      const result = community.play(owner, () => playCommunityGame(option, value));
      payload = viewGame(context, option, value, result);
      break;
    }
    default: break;
  }
  if (payload) await interaction.update({ ...payload, flags: MessageFlags.IsComponentsV2 });
  else await reject('Nút đã hết hiệu lực. Hãy mở lại lệnh cộng đồng.');
  return true;
}
