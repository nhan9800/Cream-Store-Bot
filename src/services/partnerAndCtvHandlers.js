import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import {
  addPartnerApplication,
  evaluatePartnerEligibility,
  getPartnerById,
  getPartnerSettings,
  hasAcceptedPartnerTerms,
  normalizeDiscordInviteUrl,
  PARTNER_PROGRAM,
  updatePartnerStatus,
} from './partnerService.js';
import { getCtvSettings, isCustomerCtv, setCustomerCtvStatus } from './ctvService.js';
import { accentFor, stripDiscordUnicode } from '../utils/uiKit.js';

function cardPayload(guildId, { tone = 'primary', title, lines = [], ephemeral = false } = {}) {
  const E = createEmojiResolver(guildId);
  const icon = tone === 'danger'
    ? E('status_cross')
    : tone === 'warning'
      ? E('cenar_cooldown')
      : tone === 'success'
        ? E('cenar_verified')
        : E('cenar_partner');
  const container = new ContainerBuilder().setAccentColor(accentFor(tone));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${icon} ${title}`));
  if (lines.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.filter(Boolean).join('\n')));
  }
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] },
  };
}

function addReviewButtons(container, E, approveId, rejectId, approveLabel) {
  const approveButton = new ButtonBuilder()
    .setCustomId(approveId)
    .setLabel(approveLabel)
    .setStyle(ButtonStyle.Success);
  const approveEmoji = E.component('cenar_partner_ok');
  if (approveEmoji) approveButton.setEmoji(approveEmoji);

  const rejectButton = new ButtonBuilder()
    .setCustomId(rejectId)
    .setLabel('Từ chối')
    .setStyle(ButtonStyle.Danger);
  const rejectEmoji = E.component('status_cross');
  if (rejectEmoji) rejectButton.setEmoji(rejectEmoji);
  return [container, new ActionRowBuilder().addComponents(approveButton, rejectButton)];
}

function isReviewer(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const settings = db.prepare('SELECT support_role_id, manager_role_id FROM guild_settings WHERE guild_id = ?')
    .get(interaction.guildId) || {};
  return [settings.support_role_id, settings.manager_role_id]
    .filter(Boolean)
    .some((roleId) => interaction.member?.roles?.cache?.has(roleId));
}

async function reviewerGuard(interaction) {
  if (isReviewer(interaction)) return true;
  await interaction.reply(cardPayload(interaction.guildId, {
    tone: 'danger',
    title: 'Bạn không có quyền xét duyệt',
    lines: [`${createEmojiResolver(interaction.guildId)('cenar_admin')} Chỉ Admin, Manager hoặc Support được xử lý hồ sơ.`],
    ephemeral: true,
  }));
  return false;
}

export async function handlePartnerApplyStart(interaction) {
  const settings = getPartnerSettings(interaction.guildId);
  if (!settings.approve_channel_id) {
    return interaction.reply(cardPayload(interaction.guildId, {
      tone: 'danger',
      title: 'Hệ thống Partner chưa sẵn sàng',
      lines: ['Vui lòng báo Admin chạy lại thiết lập Partner.'],
      ephemeral: true,
    }));
  }

  const modal = new ModalBuilder()
    .setCustomId('partner:apply:modal')
    .setTitle('Ứng tuyển Cenar Partner 3K+');
  const inviteInput = new TextInputBuilder()
    .setCustomId('invite_link')
    .setLabel('Link mời Discord còn hạn')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(150)
    .setPlaceholder('https://discord.gg/your-server');
  const profileInput = new TextInputBuilder()
    .setCustomId('community_profile')
    .setLabel('Chủ đề và hoạt động của cộng đồng')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(30)
    .setMaxLength(700)
    .setPlaceholder('Cộng đồng về chủ đề gì, hoạt động nổi bật và nhóm thành viên chính...');
  const activityInput = new TextInputBuilder()
    .setCustomId('weekly_activity')
    .setLabel('Tương tác thực tế mỗi tuần')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(20)
    .setMaxLength(400)
    .setPlaceholder('Số người online, tin nhắn/ngày, tăng trưởng tuần hoặc số liệu Community Insights...');
  const planInput = new TextInputBuilder()
    .setCustomId('collaboration_plan')
    .setLabel('Kế hoạch quảng bá và giveaway')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(30)
    .setMaxLength(700)
    .setPlaceholder('Vị trí đặt bài Cenar, lịch giveaway tuần và cách hai bên cùng phát triển...');
  const termsInput = new TextInputBuilder()
    .setCustomId('terms_confirmation')
    .setLabel('Nhập DONG Y để xác nhận điều khoản')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(10)
    .setPlaceholder('DONG Y');
  modal.addComponents(
    new ActionRowBuilder().addComponents(inviteInput),
    new ActionRowBuilder().addComponents(profileInput),
    new ActionRowBuilder().addComponents(activityInput),
    new ActionRowBuilder().addComponents(planInput),
    new ActionRowBuilder().addComponents(termsInput),
  );
  await interaction.showModal(modal);
}

export async function handlePartnerApplyModal(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const inviteLink = interaction.fields.getTextInputValue('invite_link').trim();
  const communityProfile = stripDiscordUnicode(interaction.fields.getTextInputValue('community_profile')).trim();
  const weeklyActivity = stripDiscordUnicode(interaction.fields.getTextInputValue('weekly_activity')).trim();
  const collaborationPlan = stripDiscordUnicode(interaction.fields.getTextInputValue('collaboration_plan')).trim();
  const acceptedTerms = hasAcceptedPartnerTerms(interaction.fields.getTextInputValue('terms_confirmation'));
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

  if (!acceptedTerms) {
    return interaction.editReply(cardPayload(interaction.guildId, {
      tone: 'warning',
      title: 'Bạn chưa xác nhận điều khoản Partner',
      lines: [
        `${E('cenar_verified')} Hãy nhập chính xác **DONG Y** ở ô cuối của biểu mẫu.`,
        `${E('cenar_support')} Xác nhận này áp dụng cho quy định nội dung, quyền lợi tài trợ và nghĩa vụ quảng bá Cenar Store.`,
      ],
    }));
  }

  const match = inviteLink.match(/(?:https?:\/\/)?(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com\/invite)\/([a-zA-Z0-9-]+)/i);
  const inviteCode = match ? match[1] : inviteLink;
  try {
    const invite = await interaction.client.fetchInvite(inviteCode, { withCounts: true }).catch(() => null);
    if (!invite?.guild) {
      return interaction.editReply(cardPayload(interaction.guildId, {
        tone: 'danger',
        title: 'Link mời không hợp lệ',
        lines: [`${E('cenar_support')} Hãy dùng link còn hạn dạng \`https://discord.gg/...\`.`],
      }));
    }

    const partnerGuildId = invite.guild.id;
    const partnerName = stripDiscordUnicode(invite.guild.name);
    const memberCount = Number(invite.approximateMemberCount || 0);
    const applicantId = interaction.user.id;
    const canonicalInviteLink = normalizeDiscordInviteUrl(invite.code || inviteCode);
    if (!canonicalInviteLink) throw new Error('Không thể chuẩn hóa link mời Discord.');
    const eligibility = evaluatePartnerEligibility({ memberCount, partnerGuildId });
    if (!eligibility.eligible) {
      return interaction.editReply(cardPayload(interaction.guildId, {
        tone: 'danger',
        title: 'Server chưa đủ điều kiện Partner 3K+',
        lines: [
          `${E('cenar_partner')} **${partnerName}** hiện có **${memberCount.toLocaleString('vi-VN')}** thành viên.`,
          `${E('status_cross')} Chương trình yêu cầu tối thiểu **${PARTNER_PROGRAM.minimumMembers.toLocaleString('vi-VN')} thành viên thực**.`,
          `${E('cenar_support')} Khi server đạt đủ quy mô, bạn có thể mở lại biểu mẫu và đăng ký ngay.`,
        ],
      }));
    }
    const duplicate = db.prepare(`
      SELECT id, status FROM partners
      WHERE guild_id = ? AND partner_guild_id = ? AND status IN ('PENDING', 'ACTIVE')
      ORDER BY id DESC LIMIT 1
    `).get(interaction.guildId, partnerGuildId);
    if (duplicate) {
      return interaction.editReply(cardPayload(interaction.guildId, {
        tone: 'warning',
        title: duplicate.status === 'ACTIVE' ? 'Server đã là Partner' : 'Hồ sơ đang chờ duyệt',
        lines: [`${E('cenar_partner')} Hồ sơ \`#${duplicate.id}\` không cần gửi lại.`],
      }));
    }

    const reviewMode = 'PROGRAM_3K';
    const appId = addPartnerApplication(
      interaction.guildId,
      partnerGuildId,
      partnerName,
      canonicalInviteLink,
      memberCount,
      invite.guild.ownerId || 'UNKNOWN',
      applicantId,
      reviewMode,
      {
        communityProfile,
        weeklyActivity,
        collaborationPlan,
        agreedTerms: acceptedTerms,
        serverCreatedAt: eligibility.createdAt,
      },
    );
    const settings = getPartnerSettings(interaction.guildId);
    const approveChannel = await interaction.guild.channels.fetch(settings.approve_channel_id).catch(() => null);
    if (!approveChannel?.isTextBased()) throw new Error('Không tìm thấy kênh duyệt Partner.');

    const reviewContainer = new ContainerBuilder().setAccentColor(accentFor('info'));
    reviewContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${E('cenar_partner')} Hồ sơ Partner 3K+ #${appId}`,
    ));
    reviewContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    reviewContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `${E('cenar_verified')} **Đại diện:** <@${applicantId}> · \`${applicantId}\``,
      `${E('cenar_partner')} **Server:** ${partnerName} · \`${partnerGuildId}\``,
      `${E('cenar_announce')} **Quy mô:** ${memberCount.toLocaleString('vi-VN')} thành viên · **Tuổi server:** ${eligibility.serverAgeDays ?? 'Không đọc được'} ngày`,
      `${E('cenar_verified')} **Điều kiện cứng:** Đạt ngưỡng 3K+ · Đã xác nhận điều khoản`,
      `${E('cenar_partner_ok')} **Tham quan:** [Mở server ứng tuyển](${canonicalInviteLink})`,
      eligibility.reviewFlags.length ? `${E('cenar_cooldown')} **Cần kiểm tra:** ${eligibility.reviewFlags.join(' ')}` : null,
    ].filter(Boolean).join('\n')));
    reviewContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    reviewContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `### ${E('cenar_verified')} Dữ liệu cộng đồng`,
      `**Chủ đề & hoạt động**\n${communityProfile}`,
      `**Tương tác hàng tuần**\n${weeklyActivity}`,
      `**Kế hoạch cùng Cenar**\n${collaborationPlan}`,
      `-# Admin đối chiếu tương tác thật, nội dung server, vị trí quảng bá và khả năng duy trì ít nhất 1 hoạt động/tuần.`,
    ].join('\n')));
    await approveChannel.send({
      components: addReviewButtons(
        reviewContainer,
        E,
        `partner:approve:${appId}`,
        `partner:reject:${appId}`,
        'Duyệt Partner',
      ),
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });

    return interaction.editReply(cardPayload(interaction.guildId, {
      tone: 'success',
      title: 'Đã tiếp nhận hồ sơ Partner',
      lines: [
        `${E('cenar_partner')} Server **${partnerName}** · ${memberCount.toLocaleString('vi-VN')} thành viên`,
        `${E('cenar_verified')} Hồ sơ đã đạt điều kiện quy mô và vào hàng chờ **thẩm định cộng đồng**.`,
        `${E('cenar_cooldown')} Admin sẽ kiểm tra tương tác thực, nội dung, vị trí quảng bá và kế hoạch giveaway.`,
        `${E('cenar_cooldown')} Kết quả sẽ được thông báo trực tiếp sau khi Admin xử lý.`,
      ],
    }));
  } catch (error) {
    console.error('[PARTNER-APPLY]', error);
    return interaction.editReply(cardPayload(interaction.guildId, {
      tone: 'danger',
      title: 'Không thể gửi hồ sơ Partner',
      lines: [`${E('status_cross')} ${error.message}`],
    }));
  }
}

export async function handlePartnerApprove(interaction, appId) {
  if (!await reviewerGuard(interaction)) return;
  const E = createEmojiResolver(interaction.guildId);
  const app = getPartnerById(appId);
  if (!app || app.status !== 'PENDING') {
    return interaction.reply(cardPayload(interaction.guildId, {
      tone: 'warning',
      title: app ? 'Hồ sơ đã được xử lý' : 'Không tìm thấy hồ sơ',
      lines: [app ? `Trạng thái hiện tại: **${app.status}**.` : `Mã hồ sơ: \`#${appId}\`.`],
      ephemeral: true,
    }));
  }
  const settings = getPartnerSettings(interaction.guildId);
  updatePartnerStatus(appId, 'ACTIVE');
  const processingPayload = cardPayload(interaction.guildId, {
    tone: 'warning',
    title: `Đã nhận lệnh duyệt Partner #${appId}`,
    lines: [
      `${E('cenar_cooldown')} Bot đang cấp role và đồng bộ hồ sơ đối tác.`,
      `${E('cenar_verified')} Nút duyệt đã được khóa để tránh xử lý trùng.`,
    ],
  });
  const { flags: _processingFlags, ...processingUpdate } = processingPayload;
  await interaction.update(processingUpdate);

  const [member, directoryChannel] = await Promise.all([
    interaction.guild.members.fetch(app.applicant_id).catch(() => null),
    settings.directory_channel_id
      ? interaction.guild.channels.fetch(settings.directory_channel_id).catch(() => null)
      : Promise.resolve(null),
  ]);

  const roleGrantPromise = member && settings.partner_role_id
    ? member.roles.add(settings.partner_role_id, `Partner #${appId} approved by ${interaction.user.id}`)
      .then(() => true)
      .catch((error) => {
        console.error('[PARTNER-ROLE]', error);
        return false;
      })
    : Promise.resolve(false);

  const canonicalInviteLink = normalizeDiscordInviteUrl(app.invite_link);
  const directoryPromise = directoryChannel?.isTextBased()
    ? (() => {
        const directory = new ContainerBuilder().setAccentColor(accentFor('success'));
        directory.addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `# ${E('cenar_partner_ok')} Cenar Partner | ${stripDiscordUnicode(app.partner_name)}`,
        ));
        directory.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        directory.addTextDisplayComponents(new TextDisplayBuilder().setContent([
          `${E('cenar_verified')} **Trạng thái:** Đối tác đã xác minh`,
          `${E('cenar_announce')} **Quy mô:** ${Number(app.member_count).toLocaleString('vi-VN')} thành viên`,
          `${E('cenar_partner')} **Đại diện:** <@${app.applicant_id}>`,
          canonicalInviteLink ? `${E('cenar_support')} **Kết nối:** [Tham gia server đối tác](${canonicalInviteLink})` : null,
          `-# Cenar Store đồng hành cùng các cộng đồng minh bạch, an toàn và cùng phát triển.`,
        ].filter(Boolean).join('\n')));
        return directoryChannel.send({
          components: [directory],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
        }).catch((error) => {
          console.error('[PARTNER-DIRECTORY]', error);
          return null;
        });
      })()
    : Promise.resolve(null);

  const [roleGranted] = await Promise.all([roleGrantPromise, directoryPromise]);

  await interaction.editReply(cardPayload(interaction.guildId, {
    tone: 'success',
    title: `Đã duyệt Partner #${appId}`,
    lines: [
      `${E('cenar_partner')} **Server:** ${stripDiscordUnicode(app.partner_name)}`,
      `${E('cenar_admin')} **Admin duyệt:** <@${interaction.user.id}>`,
      `${roleGranted ? E('cenar_verified') : E('cenar_cooldown')} **Role Partner:** ${roleGranted ? 'Đã cấp tự động' : 'Chưa thể cấp · thành viên đã rời server hoặc role cao hơn bot'}`,
      settings.partner_channel_id ? `${E('cenar_announce')} **Kênh Partner:** <#${settings.partner_channel_id}>` : null,
    ],
  }));

  const applicant = await interaction.client.users.fetch(app.applicant_id).catch(() => null);
  if (applicant) {
    await applicant.send(cardPayload(interaction.guildId, {
      tone: 'success',
      title: 'Chúc mừng, hồ sơ Partner đã được duyệt',
      lines: [
        `${E('cenar_partner_ok')} **${stripDiscordUnicode(app.partner_name)}** đã trở thành đối tác chính thức của Cenar Store.`,
        roleGranted ? `${E('cenar_verified')} Role Partner đã được cấp tự động.` : `${E('cenar_cooldown')} Hãy vào lại server và liên hệ Admin để nhận role Partner.`,
        settings.partner_channel_id ? `${E('cenar_announce')} Đăng truyền thông tại <#${settings.partner_channel_id}> bằng lệnh \`/partner-post send\`.` : null,
        `${E('cenar_cooldown')} Hạn mức: role Partner 2 lần/24h · everyone 1 lần/24h.`,
      ],
    })).catch(() => null);
  }
}

export async function handlePartnerReject(interaction, appId) {
  if (!await reviewerGuard(interaction)) return;
  const E = createEmojiResolver(interaction.guildId);
  const app = getPartnerById(appId);
  if (!app || app.status !== 'PENDING') {
    return interaction.reply(cardPayload(interaction.guildId, {
      tone: 'warning',
      title: app ? 'Hồ sơ đã được xử lý' : 'Không tìm thấy hồ sơ',
      lines: [`${E('cenar_support')} Vui lòng làm mới kênh duyệt.`],
      ephemeral: true,
    }));
  }
  await interaction.deferUpdate();
  updatePartnerStatus(appId, 'REJECTED');
  await interaction.editReply(cardPayload(interaction.guildId, {
    tone: 'danger',
    title: `Đã từ chối Partner #${appId}`,
    lines: [
      `${E('cenar_partner')} **Server:** ${stripDiscordUnicode(app.partner_name)}`,
      `${E('cenar_admin')} **Người xử lý:** <@${interaction.user.id}>`,
      `${E('cenar_support')} Đại diện có thể liên hệ Admin để được giải thích hoặc gửi lại hồ sơ sau khi cải thiện server.`,
    ],
  }));
  const applicant = await interaction.client.users.fetch(app.applicant_id).catch(() => null);
  if (applicant) {
    await applicant.send(cardPayload(interaction.guildId, {
      tone: 'danger',
      title: 'Hồ sơ Partner chưa được chấp thuận',
      lines: [
        `${E('cenar_partner')} Server **${stripDiscordUnicode(app.partner_name)}** chưa phù hợp tại thời điểm này.`,
        `${E('cenar_support')} Bạn có thể liên hệ Admin để nhận góp ý và đăng ký lại sau.`,
      ],
    })).catch(() => null);
  }
}

export async function handleCtvApplyStart(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const settings = getCtvSettings(interaction.guildId);
  if (!settings.approve_channel_id) {
    return interaction.reply(cardPayload(interaction.guildId, {
      tone: 'danger',
      title: 'Hệ thống CTV chưa sẵn sàng',
      lines: [`${E('cenar_support')} Vui lòng báo Admin chạy lại thiết lập CTV.`],
      ephemeral: true,
    }));
  }
  if (isCustomerCtv(interaction.guildId, interaction.user.id)) {
    return interaction.reply(cardPayload(interaction.guildId, {
      tone: 'warning',
      title: 'Bạn đã là CTV',
      lines: [settings.price_channel_id ? `${E('cenar_price')} Xem bảng giá tại <#${settings.price_channel_id}>.` : 'Tài khoản đã có quyền CTV.'],
      ephemeral: true,
    }));
  }

  const modal = new ModalBuilder().setCustomId('ctv:apply:modal').setTitle('Đăng ký Cenar CTV');
  const sourceInput = new TextInputBuilder()
    .setCustomId('source')
    .setLabel('Kênh hoặc nguồn khách hàng')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(150)
    .setPlaceholder('Facebook, TikTok, Discord, cộng đồng riêng...');
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Kế hoạch bán hàng và hỗ trợ khách')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(20)
    .setMaxLength(800)
    .setPlaceholder('Mô tả cách bạn bán hàng, chăm sóc và xử lý khi khách cần hỗ trợ.');
  modal.addComponents(
    new ActionRowBuilder().addComponents(sourceInput),
    new ActionRowBuilder().addComponents(reasonInput),
  );
  await interaction.showModal(modal);
}

export async function handleCtvApplyModal(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const settings = getCtvSettings(interaction.guildId);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  try {
    const approveChannel = await interaction.guild.channels.fetch(settings.approve_channel_id).catch(() => null);
    if (!approveChannel?.isTextBased()) throw new Error('Không tìm thấy kênh duyệt CTV.');
    const source = stripDiscordUnicode(interaction.fields.getTextInputValue('source'));
    const reason = stripDiscordUnicode(interaction.fields.getTextInputValue('reason'));
    const container = new ContainerBuilder().setAccentColor(accentFor('warning'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${E('cenar_ctv')} Hồ sơ CTV mới`));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `${E('cenar_verified')} **Ứng viên:** <@${interaction.user.id}> · \`${interaction.user.id}\``,
      `${E('cenar_announce')} **Nguồn khách:** ${source}`,
      `${E('cenar_support')} **Kế hoạch:**\n> ${reason.replace(/\n/g, '\n> ')}`,
      `-# Khi duyệt, bot tự cấp role CTV, mở danh mục nội bộ và áp dụng giá CTV vào đơn hàng.`,
    ].join('\n')));
    await approveChannel.send({
      components: addReviewButtons(
        container,
        E,
        `ctv:approve:${interaction.user.id}`,
        `ctv:reject:${interaction.user.id}`,
        'Duyệt CTV',
      ),
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
    return interaction.editReply(cardPayload(interaction.guildId, {
      tone: 'success',
      title: 'Đã tiếp nhận hồ sơ CTV',
      lines: [
        `${E('cenar_verified')} Hồ sơ đã được chuyển tới đội ngũ xét duyệt.`,
        `${E('cenar_cooldown')} Kết quả và quyền truy cập sẽ được gửi qua tin nhắn riêng.`,
      ],
    }));
  } catch (error) {
    return interaction.editReply(cardPayload(interaction.guildId, {
      tone: 'danger',
      title: 'Không thể gửi hồ sơ CTV',
      lines: [`${E('status_cross')} ${error.message}`],
    }));
  }
}

export async function handleCtvApprove(interaction, applicantId) {
  if (!await reviewerGuard(interaction)) return;
  const E = createEmojiResolver(interaction.guildId);
  await interaction.deferUpdate();
  const settings = getCtvSettings(interaction.guildId);
  setCustomerCtvStatus(interaction.guildId, applicantId, true);
  const member = await interaction.guild.members.fetch(applicantId).catch(() => null);
  let roleGranted = false;
  if (member && settings.ctv_role_id) {
    roleGranted = await member.roles.add(settings.ctv_role_id, `CTV approved by ${interaction.user.id}`)
      .then(() => true)
      .catch(() => false);
  }
  await interaction.editReply(cardPayload(interaction.guildId, {
    tone: 'success',
    title: 'Đã duyệt hồ sơ CTV',
    lines: [
      `${E('cenar_ctv')} **CTV:** <@${applicantId}>`,
      `${E('cenar_admin')} **Admin duyệt:** <@${interaction.user.id}>`,
      `${roleGranted ? E('cenar_verified') : E('cenar_cooldown')} **Role CTV:** ${roleGranted ? 'Đã cấp tự động' : 'Chưa thể cấp tự động'}`,
      `${E('cenar_price')} Giá CTV đã được kích hoạt trong catalog và luồng mua hàng.`,
    ],
  }));

  const applicant = await interaction.client.users.fetch(applicantId).catch(() => null);
  if (applicant) {
    await applicant.send(cardPayload(interaction.guildId, {
      tone: 'success',
      title: 'Chúc mừng, bạn đã trở thành Cenar CTV',
      lines: [
        `${E('cenar_verified')} Role và mức giá CTV đã được kích hoạt.`,
        settings.price_channel_id ? `${E('cenar_price')} Bảng giá nội bộ: <#${settings.price_channel_id}>` : null,
        settings.chat_channel_id ? `${E('cenar_support')} Kênh trao đổi CTV: <#${settings.chat_channel_id}>` : null,
        settings.order_log_channel_id ? `${E('cenar_announce')} Log đơn CTV: <#${settings.order_log_channel_id}>` : null,
        `${E('cenar_wallet')} Mỗi đơn mua qua bot sẽ tự áp dụng giá CTV và ghi log riêng.`,
      ],
    })).catch(() => null);
  }
}

export async function handleCtvReject(interaction, applicantId) {
  if (!await reviewerGuard(interaction)) return;
  const E = createEmojiResolver(interaction.guildId);
  await interaction.deferUpdate();
  setCustomerCtvStatus(interaction.guildId, applicantId, false);
  await interaction.editReply(cardPayload(interaction.guildId, {
    tone: 'danger',
    title: 'Đã từ chối hồ sơ CTV',
    lines: [
      `${E('cenar_ctv')} **Ứng viên:** <@${applicantId}>`,
      `${E('cenar_admin')} **Người xử lý:** <@${interaction.user.id}>`,
      `${E('cenar_support')} Ứng viên có thể liên hệ Admin để nhận góp ý và đăng ký lại.`,
    ],
  }));
  const applicant = await interaction.client.users.fetch(applicantId).catch(() => null);
  if (applicant) {
    await applicant.send(cardPayload(interaction.guildId, {
      tone: 'danger',
      title: 'Hồ sơ CTV chưa được chấp thuận',
      lines: [
        `${E('cenar_support')} Hồ sơ chưa phù hợp với chương trình tại thời điểm này.`,
        `${E('cenar_partner_ok')} Bạn có thể hoàn thiện kênh bán hàng và đăng ký lại sau.`,
      ],
    })).catch(() => null);
  }
}
