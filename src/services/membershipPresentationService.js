import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ChannelType, ContainerBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, TextDisplayBuilder } from 'discord.js';
import { db } from '../database/db.js';
import { config } from '../config.js';
import { MEMBER_ROLES, MEMBERSHIP_REVISION } from '../config/membershipProgram.js';
import { roleColorsFor } from '../config/roleColors.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';

const states = new WeakMap();
const assetPath = key => fileURLToPath(new URL(`../../assets/roles/member26_${key}.png`, import.meta.url));
const emojiName = key => `cenar_member26_${key}`;
const storageKey = guildId => `membership_presentation:${guildId}`;
function stored(guildId) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(storageKey(guildId));
  return row ? JSON.parse(row.value) : {icons:{}};
}
function save(guildId, value) {
  db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP')
    .run(storageKey(guildId), JSON.stringify(value));
}
export function getMembershipPresentationStatus(client) {
  return states.get(client)?.summary || {status:'not_started',revision:MEMBERSHIP_REVISION};
}
function iconText(client, tier, E) {
  const emoji = client?.application?.emojis?.cache?.find(item => item.name === emojiName(tier.key));
  return emoji ? `<:${emoji.name}:${emoji.id}>` : E(tier.slot, tier.fallback);
}
export function buildMembershipBenefitsPayload(client, guildId) {
  const E = createEmojiResolver(guildId);
  const hero = new ContainerBuilder().setAccentColor(0xBDA4FA).addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('icon_sparkle')} CENAR CIRCLE`, '**Mỗi lần đồng hành · Một dấu ấn riêng**',
    '> Hạng thành viên được ghi nhận từ giao dịch thanh toán đủ trên Discord và website.',
    '> Liên kết đúng tài khoản Discord và tham gia server để bot tự đồng bộ role.',
  ].join('\n')));
  const cards = MEMBER_ROLES.map(tier => new ContainerBuilder()
    .setAccentColor(parseInt(roleColorsFor(tier.id).primaryColor.slice(1),16))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${iconText(client,tier,E)} ${tier.label}`, `-# ${tier.tagline}`,
      `**${tier.minSpent ? `${tier.minSpent.toLocaleString('vi-VN')}đ tích luỹ` : tier.requireActivity ? 'Đã thanh toán đơn hoặc dùng dịch vụ hợp lệ' : 'Thành viên đã xác minh'}** · <@&${tier.id}>`,
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(tier.perks.map(text=>`${E('status_check')} ${text}`).join('\n'))));
  const note = new ContainerBuilder().setAccentColor(0x8AE4C2).addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('icon_info','ℹ️')} CÁCH SỬ DỤNG ĐẶC QUYỀN`,
    'Mở ticket và cho staff biết nhu cầu; mã ưu đãi được xác nhận trước khi thanh toán.',
    'Điểm loyalty chỉ phát sinh khi đơn hoàn thành; hạng role tính từ giao dịch đủ tiền còn hiệu lực.',
    'Đơn huỷ/hoàn tiền không tính hạng. Các role tích luỹ giữ nguyên ID và mốc 1 / 3 / 5 / 8 triệu.',
    'Quà, voucher và dịch vụ tặng chỉ áp dụng khi có chương trình cụ thể; không tự cộng giảm giá hoặc tặng tài khoản hàng tháng.',
    'Xem điểm: `/loyalty points` · Xem lại quyền lợi: `/dac-quyen` · Hồ sơ: https://cenarstore.xyz/account',
    `-# ${MEMBERSHIP_REVISION}`,
  ].join('\n')));
  return {components:[hero,...cards,note],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}
const integerColor = value => value ? parseInt(value.replace('#',''),16) : null;
export function rolePresentationPatch(role,tier,{enhanced,roleIcons,iconCurrent=false}={}) {
  const palette=roleColorsFor(tier.id,{enhanced});
  const colors={...palette,secondaryColor:palette.secondaryColor || null,tertiaryColor:palette.tertiaryColor || null};
  const name=`${tier.symbol} ${tier.label}${tier.minSpent ? ` · ${tier.minSpent/1_000_000}M+` : ''}`;
  const patch={};
  if(role.name!==name) patch.name=name;
  if(['primaryColor','secondaryColor','tertiaryColor'].some(key=>(role.colors?.[key] ?? (key==='primaryColor' ? role.color : null))!==integerColor(colors[key]))) patch.colors=colors;
  if(roleIcons && !iconCurrent) patch.icon=fs.readFileSync(assetPath(tier.key));
  return patch;
}
export async function refreshMembershipPresentation(client,{guildId=config.guildId}={}) {
  if(String(guildId)!==STORE_ONE_GUILD_ID) return {status:'not_configured',revision:MEMBERSHIP_REVISION};
  let state=states.get(client);
  if(state?.promise) return state.promise;
  state ||= {};
  states.set(client,state);
  state.summary={status:'in_progress',revision:MEMBERSHIP_REVISION};
  state.promise=(async()=>{
    try {
      const guild=await client.guilds.fetch({guild:String(guildId),force:true});
      await guild.roles.fetch();
      const bot=await guild.members.fetchMe();
      if(!bot.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('MANAGE_ROLES_REQUIRED');
      const enhanced=guild.features.includes('ENHANCED_ROLE_COLORS');
      const roleIcons=guild.features.includes('ROLE_ICONS');
      const ledger=stored(guild.id);
      ledger.icons ||= {};
      const inventory=await client.application.emojis.fetch();
      for(const [id,emoji] of client.application.emojis.cache) {
        if(emoji.name?.startsWith('cenar_member26_') && !inventory.has(id)) client.application.emojis.cache.delete(id);
      }
      for(const tier of MEMBER_ROLES) {
        const image=fs.readFileSync(assetPath(tier.key));
        if(!image.length || image.length>256*1024) throw new Error('INVALID_MEMBERSHIP_ASSET');
        if(!inventory.find(item=>item.name===emojiName(tier.key))) {
          const emoji=await client.application.emojis.create({name:emojiName(tier.key),attachment:image});
          inventory.set(emoji.id,emoji);
        }
      }
      const result={status:'ready',revision:MEMBERSHIP_REVISION,enhanced,roleIcons,expected:MEMBER_ROLES.length,verified:0,updated:0,skipped:0};
      for(const tier of MEMBER_ROLES) {
        const role=guild.roles.cache.get(tier.id);
        if(!role || role.managed || !role.editable) {result.skipped++;continue;}
        const previous=ledger.icons[tier.id];
        const iconCurrent=Boolean(role.icon && previous?.revision===MEMBERSHIP_REVISION && previous.hash===role.icon);
        const patch=rolePresentationPatch(role,tier,{enhanced,roleIcons,iconCurrent});
        if(Object.keys(patch).length) {
          const updated=await role.edit({...patch,reason:'Cenar Circle: refresh membership artwork; preserve IDs, hierarchy and permissions'});
          if(roleIcons && updated.icon) ledger.icons[tier.id]={revision:MEMBERSHIP_REVISION,hash:updated.icon};
          save(guild.id,ledger);
          result.updated++;
        }
        result.verified++;
      }
      if(result.skipped) throw new Error('MEMBERSHIP_ROLE_NOT_EDITABLE');
      const channels=await guild.channels.fetch();
      let channel=channels.get(ledger.channelId) || channels.find(item=>item.type===ChannelType.GuildText && /^(?:đặc-quyền-thành-viên|dac-quyen|đặc-quyền-role)$/i.test(item.name));
      if(!channel) {
        const price=channels.get('1514606995842273280');
        channel=await guild.channels.create({name:'đặc-quyền-thành-viên',type:ChannelType.GuildText,parent:price?.parentId || undefined,
          permissionOverwrites:[{id:guild.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory],deny:[PermissionFlagsBits.SendMessages,PermissionFlagsBits.CreatePublicThreads,PermissionFlagsBits.CreatePrivateThreads]},
            {id:client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]}],
          reason:'Cenar Circle public membership guide'});
        ledger.channelId=channel.id; save(guild.id,ledger);
      }
      let message=ledger.messageId ? await channel.messages.fetch(ledger.messageId).catch(()=>null) : null;
      if(!message || message.author.id!==client.user.id || !message.flags.has(MessageFlags.IsComponentsV2)) {
        const recent=await channel.messages.fetch({limit:50});
        message=recent.find(item=>item.author.id===client.user.id && item.flags.has(MessageFlags.IsComponentsV2) && JSON.stringify(item.components).includes('CENAR CIRCLE'));
      }
      const payload=buildMembershipBenefitsPayload(client,guild.id);
      message=message ? await message.edit(payload) : await channel.send(payload);
      ledger.channelId=channel.id; ledger.messageId=message.id; save(guild.id,ledger);
      result.boardUrl=message.url;
      state.summary={...result,updatedAt:new Date().toISOString()};
      return state.summary;
    } catch(error) {
      state.summary={status:'retry_required',revision:MEMBERSHIP_REVISION,error:/^[A-Z_]+$/.test(error.message) ? error.message : 'MEMBERSHIP_PRESENTATION_FAILED'};
      throw error;
    }
  })().finally(()=>{state.promise=null;});
  return state.promise;
}
