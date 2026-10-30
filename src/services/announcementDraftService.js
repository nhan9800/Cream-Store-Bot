import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { normalizeAnnouncementImage, publishAnnouncement } from './announcementService.js';

const drafts = new Map();
const TTL = 15 * 60_000;
const NO_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };

function pruneDrafts() {
  for (const [id, draft] of drafts) {
    if (!draft.publishing && draft.expiresAt <= Date.now()) drafts.delete(id);
  }
}

function permitted(interaction) {
  return Boolean(interaction.guildId && interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages));
}

export function createAnnouncementDraft(interaction, image = null) {
  if (!permitted(interaction)) throw new Error('Bạn cần quyền Quản Lý Tin Nhắn để dùng /thongbao trong máy chủ.');
  pruneDrafts();
  if (drafts.size >= 200) throw new Error('Đang có nhiều bản nháp. Vui lòng thử lại sau.');
  const draft = {
    id: interaction.id, guildId: interaction.guildId, channelId: interaction.channelId,
    ownerId: interaction.user.id, image: normalizeAnnouncementImage(image),
    content: '', roles: [], tagEveryone: false, tagHere: false, revision: 0,
    expiresAt: Date.now() + TTL, publishing: false, result: null, cancelled: false,
  };
  drafts.set(draft.id, draft);
  return draft;
}

export function buildAnnouncementModal(draft) {
  const input = new TextInputBuilder().setCustomId('announcement_content')
    .setLabel('Nội dung bạn muốn thông báo').setStyle(TextInputStyle.Paragraph)
    .setRequired(true).setMaxLength(3000);
  if (draft.content) input.setValue(draft.content);
  return new ModalBuilder().setCustomId(`announcement:modal:${draft.id}:${draft.revision}`)
    .setTitle(draft.content ? 'Sửa nội dung thông báo' : 'Nội dung thông báo')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export function buildAnnouncementPreview(draft, notice = '') {
  const disabled = draft.publishing || draft.cancelled || Boolean(draft.result);
  const tags = [...draft.roles.map(id => `<@&${id}>`),
    ...(draft.tagEveryone ? ['@everyone'] : []), ...(draft.tagHere ? ['@here'] : [])];
  const embed = new EmbedBuilder().setTitle('Xác nhận thông báo').setColor(0x3498db)
    .setDescription(draft.content)
    .addFields({ name: 'Các role sẽ tag', value: tags.join(', ') || 'Không có' })
    .setFooter({ text: 'Chọn role rồi bấm Đăng thông báo. Bản nháp hết hạn sau 15 phút.' });
  if (draft.image) embed.setImage(draft.image.url).addFields({ name: 'Ảnh đính kèm', value: draft.image.name });
  const select = new RoleSelectMenuBuilder().setCustomId(`announcement:roleselect:${draft.id}`)
    .setPlaceholder('Chọn hoặc tìm role muốn tag').setMinValues(0).setMaxValues(10).setDisabled(disabled);
  if (draft.roles.length) select.setDefaultRoles(...draft.roles);
  const button = (action, label, style) => new ButtonBuilder().setCustomId(`announcement:${action}:${draft.id}`)
    .setLabel(label).setStyle(style).setDisabled(disabled);
  return {
    content: notice, embeds: [embed], allowedMentions: NO_MENTIONS,
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        button('toggle_everyone', draft.tagEveryone ? 'Đang tag @everyone' : 'Không tag @everyone', draft.tagEveryone ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('toggle_here', draft.tagHere ? 'Đang tag @here' : 'Không tag @here', draft.tagHere ? ButtonStyle.Success : ButtonStyle.Secondary)),
      new ActionRowBuilder().addComponents(
        button('confirm', draft.publishing ? 'Đang đăng…' : 'Đăng thông báo', ButtonStyle.Success),
        button('edit', 'Sửa nội dung', ButtonStyle.Primary), button('cancel', 'Hủy', ButtonStyle.Danger)),
    ],
  };
}

async function privateNotice(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS };
  return interaction.deferred || interaction.replied ? interaction.followUp(payload) : interaction.reply(payload);
}

function successPayload(draft) {
  return { content: `Đã đăng thông báo: ${draft.result.message.url || `https://discord.com/channels/${draft.guildId}/${draft.channelId}/${draft.result.message.id}`}`,
    embeds: [], components: [], allowedMentions: NO_MENTIONS };
}

function publicationError(error) {
  if (error?.code === 50013 || error?.code === 50001) return 'Bot thiếu quyền truy cập hoặc gửi tin nhắn tại kênh này.';
  if (error?.code === 10003) return 'Kênh đăng thông báo không còn tồn tại.';
  return 'Không thể gửi thông báo. Kiểm tra quyền của bot, ảnh đính kèm và kết nối Discord rồi thử lại.';
}

/** Routed before shared button cooldown. Each draft owns its publication lock. */
export async function handleAnnouncementDraftInteraction(interaction) {
  if (!interaction.customId?.startsWith('announcement:')) return false;
  const [, action, id, revision] = interaction.customId.split(':');
  pruneDrafts();
  const draft = drafts.get(id);
  if (!permitted(interaction)) {
    await privateNotice(interaction, 'Bạn cần quyền Quản Lý Tin Nhắn để thao tác thông báo.');
    return true;
  }
  if (!draft || draft.guildId !== interaction.guildId || draft.channelId !== interaction.channelId
    || draft.ownerId !== interaction.user.id) {
    await privateNotice(interaction, 'Bản nháp đã hết hạn hoặc không thuộc bạn. Vui lòng mở lại /thongbao.');
    return true;
  }
  if (draft.cancelled) { await privateNotice(interaction, 'Bản nháp này đã hủy.'); return true; }
  if (draft.result) {
    await interaction.deferUpdate();
    await interaction.editReply(successPayload(draft));
    return true;
  }
  if (draft.publishing) {
    await privateNotice(interaction, 'Thông báo đang được đăng. Vui lòng chờ kết quả tại bản nháp.');
    return true;
  }
  if (draft.uncertainAt && action !== 'confirm') {
    await privateNotice(interaction, 'Kết quả gửi đang chờ xác minh. Kiểm tra kênh trước khi sửa hoặc tạo thông báo khác.');
    return true;
  }
  if (action === 'edit' && interaction.isButton()) {
    await interaction.showModal(buildAnnouncementModal(draft));
    return true;
  }
  if (action === 'modal' && interaction.isModalSubmit()) {
    if (String(draft.revision) !== revision) {
      await privateNotice(interaction, 'Nội dung đã được sửa ở cửa sổ khác. Hãy mở Sửa nội dung từ bản nháp mới nhất.');
      return true;
    }
    const content = interaction.fields.getTextInputValue('announcement_content').trim();
    if (!content || content.length > 3000) {
      await privateNotice(interaction, 'Nội dung cần có từ 1 đến 3.000 ký tự.');
      return true;
    }
    const fromMessage = interaction.isFromMessage();
    if (fromMessage) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    draft.content = content;
    draft.revision++;
    await interaction.editReply(buildAnnouncementPreview(draft));
    return true;
  }
  if (action === 'confirm' && interaction.isButton()) {
    if ((draft.tagEveryone || draft.tagHere) && !interaction.memberPermissions.has(PermissionFlagsBits.MentionEveryone)) {
      await privateNotice(interaction, 'Quyền Nhắc Đến Mọi Người đã thay đổi. Tắt @everyone/@here trước khi đăng.');
      return true;
    }
    // Reserve synchronously, but release even when the initial ACK fails.
    draft.publishing = true;
    try {
      await interaction.deferUpdate();
      if (draft.uncertainAt && Date.now() - draft.uncertainAt >= 90_000) {
        await interaction.editReply(buildAnnouncementPreview(draft,
          'Discord chưa xác nhận lần gửi trước. Kiểm tra kênh trước khi tạo thông báo mới để tránh đăng trùng.'));
        return true;
      }
      if (!draft.content) throw new Error('EMPTY_DRAFT');
      await interaction.editReply(buildAnnouncementPreview(draft, 'Đang đăng thông báo…')).catch(() => null);
      const snapshot = { ...draft, roles: [...draft.roles] };
      const attemptAt = Date.now();
      try {
        draft.result = await publishAnnouncement({ guild: interaction.guild, channelId: snapshot.channelId,
          content: snapshot.content, roleIds: snapshot.roles, tagEveryone: snapshot.tagEveryone,
          tagHere: snapshot.tagHere, image: snapshot.image, nonce: draft.id,
          onSend: () => { draft.sendStarted = true; } });
      } catch (error) {
        // A transport/server failure can hide an accepted message. Reuse this
        // nonce only inside Discord's short dedup window, never blindly later.
        if (draft.sendStarted && !(Number(error?.status) >= 400 && Number(error?.status) < 500)) {
          draft.uncertainAt ||= attemptAt;
        }
        throw error;
      }
      await interaction.editReply(successPayload(draft));
    } catch (error) {
      console.error('[ANNOUNCEMENT_DRAFT]', { phase: draft.result ? 'receipt' : 'publish',
        code: error?.code || error?.status || 'REQUEST_FAILED' });
      if (interaction.deferred || interaction.replied) {
        const payload = draft.result ? successPayload(draft) : buildAnnouncementPreview({ ...draft, publishing: false },
          draft.uncertainAt ? 'Discord chưa xác nhận kết quả. Kiểm tra kênh hoặc thử lại ngay; bot giữ cùng mã gửi để tránh trùng.' : publicationError(error));
        await interaction.editReply(payload).catch(() => null);
      }
    } finally { draft.publishing = false; draft.sendStarted = false; }
    return true;
  }
  if (action === 'cancel' && interaction.isButton()) {
    await interaction.deferUpdate();
    draft.cancelled = true;
    await interaction.editReply({ content: 'Đã hủy đăng thông báo.', embeds: [], components: [], allowedMentions: NO_MENTIONS });
    return true;
  }
  if (action === 'roleselect' && interaction.isRoleSelectMenu()) {
    draft.roles = [...new Set(interaction.values)].filter(value => /^\d{17,20}$/.test(value)).slice(0, 10);
  } else if (['toggle_everyone', 'toggle_here'].includes(action) && interaction.isButton()) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.MentionEveryone)) {
      await privateNotice(interaction, 'Bạn cần quyền Nhắc Đến Mọi Người để bật @everyone hoặc @here.');
      return true;
    }
    const key = action === 'toggle_everyone' ? 'tagEveryone' : 'tagHere';
    draft[key] = !draft[key];
  } else { await privateNotice(interaction, 'Thao tác thông báo không hợp lệ.'); return true; }
  await interaction.deferUpdate();
  await interaction.editReply(buildAnnouncementPreview(draft));
  return true;
}
