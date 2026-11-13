import { AttachmentBuilder, ActionRowBuilder, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';
import { config } from '../config.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { isManager } from '../utils/permissions.js';
import { supplierAutobuyRuntime } from '../services/supplierAutobuyRuntime.js';
import * as presentation from '../services/supplierAutobuyPanelService.js';
import { isSupplierAutobuyProductKey } from '../utils/supplierAutobuyIdentifiers.js';

const PREFIX = 'supplier-autobuy:';
const INVALID_PANEL = 'Bảng autobuy này không còn khả dụng. Vui lòng mở bảng mới nhất trong kênh autobuy của Cenar Store.';
const UNAVAILABLE = 'Chưa thể hiển thị thông tin autobuy. Vui lòng thử lại sau; chưa có đơn hàng hoặc thanh toán nào được tạo.';
const NO_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });
const CUSTOMER_ID = /^\d{17,20}$/;
const QUOTE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ORDER_CODE = /^CN_\d{6,12}$/;
const INTEGER = /^(?:0|[1-9]\d{0,3})$/;
const PRIVATE_ACTIONS = new Set(['page', 'category', 'select', 'qty', 'qtymodal', 'confirm', 'pay', 'orders', 'order', 'orderselect', 'delivery', 'editprice', 'pricemodal']);
const TICKET_ACTIONS = new Set(['pay', 'order', 'delivery']);
const PRIVATE_VIEW_ACTIONS = new Set(['page', 'category', 'select', 'orders', 'order', 'orderselect']);

async function replyInvalid(interaction) {
  if (interaction.deferred || interaction.replied) return;
  try { await interaction.reply({ content: INVALID_PANEL, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS }); } catch { /* No public fallback. */ }
}

function isEphemeral(message) {
  try {
    return typeof message?.flags?.has === 'function' ? message.flags.has(MessageFlags.Ephemeral)
      : Boolean(BigInt(message?.flags?.bitfield ?? message?.flags ?? 0) & BigInt(MessageFlags.Ephemeral));
  } catch { return false; }
}

function scopedOrigin(interaction) {
  if (interaction.guildId !== STORE_ONE_GUILD_ID || config.guildId !== STORE_ONE_GUILD_ID || process.env.ENV_FILE !== '.env') return null;
  const botId = interaction.client?.user?.id;
  if (!CUSTOMER_ID.test(botId || '')) return null;
  const matches = ['cdkvietnam', 'dopermind'].map(provider => ({ provider,
    panel: presentation.getSupplierAutobuyPanelHealth(provider),
  })).filter(({ provider, panel }) => (provider === 'cdkvietnam' || panel?.provider === provider)
    && (!panel?.provider || panel.provider === provider) && panel?.status === 'READY'
    && CUSTOMER_ID.test(panel.channelId || '') && CUSTOMER_ID.test(panel.messageId || '')
    && interaction.channelId === panel.channelId);
  return matches.length === 1 ? { ...matches[0], botId, kind: 'storefront' } : null;
}

async function scopedTicketOrigin(interaction, { action, owner, args, getTicketContext }) {
  if (!TICKET_ACTIONS.has(action) || !validArguments(action, args) || interaction.isButton?.() !== true
    || interaction.guildId !== STORE_ONE_GUILD_ID || config.guildId !== STORE_ONE_GUILD_ID || process.env.ENV_FILE !== '.env'
    || !CUSTOMER_ID.test(owner || '') || interaction.user?.id !== owner) return null;
  const botId = interaction.client?.user?.id;
  const message = interaction.message, channel = interaction.channel;
  if (!CUSTOMER_ID.test(botId || '') || !CUSTOMER_ID.test(message?.id || '')
    || message?.author?.id !== botId || message.webhookId
    || channel?.id !== interaction.channelId || channel.guildId !== STORE_ONE_GUILD_ID || channel.type !== ChannelType.GuildText) return null;
  const ephemeral = isEphemeral(message);
  const sourceUser = message.interactionMetadata?.user?.id ?? message.interaction?.user?.id;
  if (ephemeral && sourceUser !== owner) return null;
  const everyone = channel.permissionOverwrites?.cache?.get(STORE_ONE_GUILD_ID);
  const customer = channel.permissionOverwrites?.cache?.get(owner);
  if (!everyone?.deny?.has(PermissionFlagsBits.ViewChannel) || !customer?.allow?.has(PermissionFlagsBits.ViewChannel)
    || !channel.permissionsFor?.(botId)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory])) return null;
  const context = await getTicketContext({ guildId: interaction.guildId, channelId: interaction.channelId,
    messageId: message.id, customerId: owner, orderCode: args[0], ephemeral });
  if (!context || !['cdkvietnam', 'dopermind'].includes(context.provider) || context.orderCode !== args[0]
    || context.customerId !== owner || context.channelId !== interaction.channelId
    || (context.expectedTopic && context.expectedTopic !== channel.topic)
    || (context.categoryId && context.categoryId !== channel.parentId)) return null;
  return { ...context, botId, kind: 'ticket' };
}

function validPrivateOrigin(interaction, scope, owner, modal) {
  if (!CUSTOMER_ID.test(owner || '') || interaction.user?.id !== owner) return false;
  if (scope.kind === 'ticket') return !modal && interaction.message?.author?.id === scope.botId && !interaction.message?.webhookId;
  if (modal) return interaction.isModalSubmit?.() === true && (!interaction.message || interaction.message.author?.id === scope.botId);
  if (interaction.message?.author?.id !== scope.botId || !isEphemeral(interaction.message)) return false;
  const sourceUser = interaction.message.interactionMetadata?.user?.id ?? interaction.message.interaction?.user?.id;
  return !sourceUser || sourceUser === owner;
}

function validArguments(action, args) {
  if (action === 'orders') return args.length === 0;
  if (action === 'page') return args.length === 2 && args.every(value => INTEGER.test(value));
  if (['select', 'category', 'orderselect'].includes(action)) return args.length === 0;
  if (['qty', 'qtymodal', 'editprice', 'pricemodal'].includes(action)) return args.length === 1 && isSupplierAutobuyProductKey(args[0]);
  if (action === 'confirm') return args.length === 1 && QUOTE_ID.test(args[0]);
  if (['order', 'delivery'].includes(action)) return args.length === 1 && ORDER_CODE.test(args[0]);
  return action === 'pay' && args.length === 2 && ORDER_CODE.test(args[0]) && ['payos', 'wallet'].includes(args[1]);
}

const dataContext = (interaction, provider) => ({ guildId: interaction.guildId, customerId: interaction.user.id, provider });
const safeText = value => typeof value === 'string' && value.length <= 200 ? value : '';
const inputError = code => Object.assign(new Error('Autobuy input is invalid.'), { code });
function errorText(error) {
  let code = '';
  try { code = safeText(error?.code); } catch { /* Never expose arbitrary exception accessors. */ }
  if (code === 'INVALID_QUANTITY') return 'Số lượng hợp lệ từ 1 đến 10 sản phẩm. Vui lòng chọn lại số lượng trước khi xem báo giá.';
  if (/QUOTE.*(?:EXPIRED|CHANGED)|PRICE_CHANGED|QUOTE_EXPIRED|QUOTE_CHANGED/.test(code)) return 'Báo giá đã hết hạn hoặc thay đổi. Vui lòng chọn lại sản phẩm và xác nhận giá mới; đơn đã thanh toán giữ nguyên số tiền được ghi nhận.';
  if (/STOCK|PRODUCT_UNAVAILABLE|PRODUCT_NOT_FOUND|NOT_AVAILABLE/.test(code)) return 'Gói vừa hết hàng hoặc tạm dừng bán. Vui lòng quay lại Danh mục để chọn gói khác.';
  if (code === 'SUPPLIER_UNFUNDED') return 'Đơn có thể đang chờ shop bổ sung nguồn. Nếu đã thanh toán, hệ thống ghi nhận khoản thanh toán và tự tiếp tục khi nguồn sẵn sàng. Bấm Kiểm tra đơn để theo dõi; không thanh toán lại.';
  if (code === 'PAYMENT_METHOD_LOCKED') return 'Đơn đã chọn một phương thức thanh toán. Vui lòng dùng phương thức đó hoặc bấm Kiểm tra đơn; tránh thanh toán lại qua phương thức khác.';
  if (/INSUFFICIENT.*BALANCE|WALLET.*(?:LOW|INSUFFICIENT)|INSUFFICIENT_FUNDS/.test(code)) return 'Số dư ví chưa đủ hoặc nguồn hàng chưa thể xử lý. Bạn có thể kiểm tra đơn, chọn phương thức thanh toán phù hợp hoặc tạo ticket hỗ trợ.';
  if (/NOT_READY|NOT_DELIVERED|DELIVERY_PENDING|DELIVERY_UNAVAILABLE|FULFILLMENT_PENDING|PAYMENT_REQUIRED|UNPAID/.test(code)) return 'Đơn chưa có hàng để nhận. Nếu đã thanh toán, hệ thống đang xử lý hoặc đối soát; bấm Kiểm tra đơn để xem trạng thái. Không cần tạo đơn mới cho cùng lần thanh toán.';
  if (/OWNER|CUSTOMER|ACCESS|FORBIDDEN|NOT_FOUND/.test(code)) return 'Không tìm thấy đơn hoặc báo giá thuộc tài khoản của bạn.';
  if (/PRICE|MARGIN|LOSS|BELOW|OVERRIDE/.test(code)) return 'Giá mới chưa hợp lệ hoặc thấp hơn ngưỡng bảo vệ của sản phẩm. Vui lòng kiểm tra lại trước khi cập nhật.';
  return 'Chưa thể hoàn tất thao tác này. Vui lòng kiểm tra đơn trước khi thử lại; shop giữ nguyên thông tin thanh toán đã ghi nhận. Bạn có thể tạo ticket để được hỗ trợ.';
}

async function freshManager(interaction) {
  try {
    const member = await interaction.guild?.members?.fetch({ user: interaction.user.id, force: true });
    return member?.id === interaction.user.id && isManager(member);
  } catch { return false; }
}

// This controls button visibility only. Opening/submitting a price change still
// uses freshManager; browsing must not wait for a forced member REST request.
function managerPresentationHint(interaction) {
  try {
    const permissions = interaction.memberPermissions;
    if (permissions?.has(PermissionFlagsBits.Administrator) || permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    const member = interaction.guild?.members?.cache?.get(interaction.user.id);
    return member?.id === interaction.user.id && isManager(member);
  } catch { return false; }
}

function canUpdatePrivateView(interaction, action, owner) {
  const sourceUser = interaction.message?.interactionMetadata?.user?.id ?? interaction.message?.interaction?.user?.id;
  return PRIVATE_VIEW_ACTIONS.has(action) && typeof interaction.deferUpdate === 'function'
    && isEphemeral(interaction.message) && sourceUser === owner && !interaction.message?.webhookId;
}

const defaults = {
  getCatalog: async options => (await import('../services/supplierAutobuyCatalogService.js')).getSupplierOffers(options),
  prepareCheckout: async options => (await import('../services/supplierAutobuyOrderService.js')).prepareSupplierCheckout(options),
  confirmCheckout: async options => (await import('../services/supplierAutobuyCheckoutService.js')).confirmSupplierCheckoutWithTicket(options),
  createPayment: async options => (await import('../services/supplierAutobuyCheckoutService.js')).createSupplierPayment(options),
  getOrder: async options => (await import('../services/supplierAutobuyCheckoutService.js')).getSupplierCheckoutStatus(options),
  listOrders: async options => (await import('../services/supplierAutobuyOrderService.js')).listSupplierOrdersForCustomer(options),
  getDelivery: async options => (await import('../services/supplierAutobuyOrderService.js')).getSupplierDeliveryForCustomer(options),
  acknowledgeDelivery: async options => (await import('../services/supplierAutobuyOrderService.js')).acknowledgeSupplierDeliveryRetrieval(options),
  setPrice: async options => (await import('../services/supplierAutobuyCatalogService.js')).setSupplierPriceOverride(options),
  canManage: freshManager,
  getTicketContext: async options => (await import('../services/supplierAutobuyTicketNoticeService.js')).getSupplierTicketOrderNoticeContext(options),
};

/** Every commerce action resolves its durable quote/order by the current user. */
export function createSupplierAutobuyInteractionHandler(dependencies = {}) {
  const deps = { ...defaults, ...dependencies };
  const catalogReads = new WeakMap();
  const navigationViews = new WeakMap();
  function catalogFor(client, provider) {
    let pending = catalogReads.get(client);
    if (!pending) { pending = new Map(); catalogReads.set(client, pending); }
    if (pending.has(provider)) return pending.get(provider);
    // Public catalog data is common to customers. Share only work already in
    // progress; subsequent reads still go through the backend freshness rules.
    const task = Promise.resolve().then(() => deps.getCatalog({ provider }));
    pending.set(provider, task);
    const release = () => { if (pending.get(provider) === task) pending.delete(provider); };
    task.then(release, release);
    return task;
  }
  function beginNavigation(interaction, provider) {
    let views = navigationViews.get(interaction.client);
    if (!views) { views = new Map(); navigationViews.set(interaction.client, views); }
    const key = `${interaction.guildId}:${provider}:${interaction.user.id}:${interaction.message.id}`;
    const view = views.get(key) || { latest: 0, publishing: Promise.resolve() };
    views.set(key, view);
    const revision = ++view.latest;
    const current = () => views.get(key) === view && view.latest === revision;
    return {
      current,
      publish: async send => {
        const previous = view.publishing;
        let release;
        view.publishing = new Promise(resolve => { release = resolve; });
        await previous;
        try { return current() ? await send() : null; }
        finally { release(); }
      },
      finish: () => { if (views.get(key) === view && view.latest === revision) views.delete(key); },
    };
  }
  return async function handle(interaction) {
    const customId = interaction?.customId;
    if (typeof customId !== 'string' || !customId.startsWith(PREFIX)) return false;
    const [action, owner, ...args] = customId.slice(PREFIX.length).split(':');
    let scope;
    const publicAction = ['catalog', 'status'].includes(action) && owner === undefined;
    const modal = ['qtymodal', 'pricemodal'].includes(action);
    try {
      // A namespaced provider key contains ':', the custom-ID separator. Only
      // the product argument is URI-encoded; validate its decoded identity.
      if (['qty', 'qtymodal', 'editprice', 'pricemodal'].includes(action) && args.length === 1) args[0] = decodeURIComponent(args[0]);
      scope = scopedOrigin(interaction) || await scopedTicketOrigin(interaction, { action, owner, args, getTicketContext: deps.getTicketContext });
      const publicValid = publicAction && interaction.isButton?.() === true
        && interaction.message?.id === scope?.panel.messageId && interaction.message?.author?.id === scope?.botId;
      const privateValid = PRIVATE_ACTIONS.has(action) && validArguments(action, args)
        && scope && validPrivateOrigin(interaction, scope, owner, modal)
        && (modal || (['select', 'category', 'orderselect'].includes(action) ? interaction.isStringSelectMenu?.() === true : interaction.isButton?.() === true));
      if (!scope || (!publicValid && !privateValid)) { await replyInvalid(interaction); return true; }
      if (interaction.deferred || interaction.replied) return true;
    } catch { await replyInvalid(interaction); return true; }

    const currentSnapshot = supplierAutobuyRuntime.forProvider?.(scope.provider)?.getHealth()
      || supplierAutobuyRuntime.getHealth();
    const snapshot = !currentSnapshot?.provider || currentSnapshot.provider === scope.provider ? currentSnapshot
      : { status: 'NOT_STARTED', provider: scope.provider, purchasesEnabled: false };
    // Existing paid orders remain privately retrievable while new sales pause.
    const historical = ['orders', 'order', 'orderselect', 'delivery'].includes(action);
    if (!publicAction && !historical && snapshot?.purchasesEnabled !== true) { await replyInvalid(interaction); return true; }

    if (['qty', 'editprice'].includes(action)) {
      try {
        if (action === 'editprice' && !await deps.canManage(interaction)) { await replyInvalid(interaction); return true; }
        const price = action === 'editprice';
        const field = new TextInputBuilder().setCustomId(price ? 'price' : 'quantity')
          .setLabel(price ? 'Giá mới (VNĐ, chỉ nhập số)' : 'Số lượng (từ 1 đến 10)')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(price ? 10 : 2)
          .setPlaceholder(price ? '55000' : '1');
        await interaction.showModal(new ModalBuilder().setCustomId(PREFIX + (price ? 'pricemodal' : 'qtymodal') + ':' + owner + ':' + encodeURIComponent(args[0]))
          .setTitle(price ? 'Cập nhật giá autobuy' : 'Chọn số lượng').addComponents(new ActionRowBuilder().addComponents(field)));
      } catch { /* Failed modals cannot produce a transaction. */ }
      return true;
    }

    const inPlace = !publicAction && !modal && canUpdatePrivateView(interaction, action, owner);
    // Reserve click order before Discord acknowledges it: a slower older ACK
    // must not become a new revision after the newer view already completed.
    const navigation = inPlace ? beginNavigation(interaction, scope.provider) : null;
    try {
      if (inPlace) await interaction.deferUpdate();
      else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch { navigation?.finish(); return true; }
    if (navigation && !navigation.current()) { navigation.finish(); return true; }
    let payload;
    let files;
    try {
      if (publicAction && (snapshot?.purchasesEnabled !== true || action === 'status')) {
        payload = presentation.buildSupplierAutobuyReply({ client: interaction.client, snapshot, action,
          provider: scope.provider,
          ...(CUSTOMER_ID.test(interaction.user?.id || '') ? { customerId: interaction.user.id } : {}) });
      } else {
        const context = dataContext(interaction, scope.provider);
        if (action === 'catalog' || action === 'page' || action === 'category') {
          let category = action === 'page' ? Number(args[0]) : 0;
          const page = action === 'page' ? Number(args[1]) : 0;
          if (action === 'category') {
            if (interaction.values?.length !== 1 || !INTEGER.test(interaction.values[0])) throw new Error('INVALID_CATEGORY');
            category = Number(interaction.values[0]);
          }
          payload = presentation.buildSupplierCatalogView({ catalog: await catalogFor(interaction.client, scope.provider),
            customerId: context.customerId, page, category, provider: scope.provider });
        } else if (action === 'select' || action === 'qtymodal') {
          const productKey = action === 'select' ? interaction.values?.[0] : args[0];
          if ((action === 'select' && interaction.values?.length !== 1) || !isSupplierAutobuyProductKey(productKey)) throw new Error('INVALID_PRODUCT');
          const rawQuantity = action === 'qtymodal' ? interaction.fields?.getTextInputValue('quantity')?.trim() : '1';
          if (!/^(?:[1-9]|10)$/.test(rawQuantity || '')) throw inputError('INVALID_QUANTITY');
          const quote = await deps.prepareCheckout({ ...context, productKey, quantity: Number(rawQuantity) });
          payload = presentation.buildSupplierQuoteView({ quote, customerId: context.customerId, manager: managerPresentationHint(interaction) });
        } else if (action === 'confirm') {
          const order = await deps.confirmCheckout({ client: interaction.client, ...context, quoteId: args[0] });
          payload = presentation.buildSupplierOrderView({ order, customerId: context.customerId, ticketContext: scope.kind === 'ticket' });
        } else if (action === 'pay') {
          const orderCode = args[0];
          if (!presentation.hasSupplierPrepayDisclosure(interaction.message)) {
            // Buttons from before the policy change refresh the owned invoice
            // and disclose prepayment first; only a subsequent click can pay.
            const order = await deps.getOrder({ client: interaction.client, ...context, orderCode });
            payload = await presentation.buildSupplierPaymentView({ order, customerId: context.customerId, ticketContext: scope.kind === 'ticket' });
          } else {
            const payment = await deps.createPayment({ client: interaction.client, ...context, orderCode, method: args[1] });
            // A successful invoice must remain visible even if its subsequent
            // status lookup fails. The server payment result contains no client price.
            const order = await deps.getOrder({ client: interaction.client, ...context, orderCode }).catch(() => ({
              orderCode, totalAmount: payment.totalAmount, status: payment.status,
              paymentStatus: payment.paid ? 'PAID' : 'UNPAID',
            }));
            payload = await presentation.buildSupplierPaymentView({ order, customerId: context.customerId, payment, ticketContext: scope.kind === 'ticket' });
          }
        } else if (action === 'orders') {
          payload = presentation.buildSupplierOrderListView({ orders: await deps.listOrders({ ...context, limit: 10 }),
            customerId: context.customerId, provider: scope.provider });
        } else if (action === 'order' || action === 'orderselect') {
          const orderCode = action === 'orderselect' ? interaction.values?.[0] : args[0];
          if ((action === 'orderselect' && interaction.values?.length !== 1) || !ORDER_CODE.test(orderCode || '')) throw new Error('INVALID_ORDER');
          payload = await presentation.buildSupplierPaymentView({ order: await deps.getOrder({ client: interaction.client, ...context, orderCode }), customerId: context.customerId, ticketContext: scope.kind === 'ticket' });
        } else if (action === 'delivery') {
          const delivery = await deps.getDelivery({ ...context, orderCode: args[0] });
          if (!Array.isArray(delivery?.items) || !delivery.items.length || !delivery.items.every(item => typeof item === 'string' && item.length > 0)) throw new Error('DELIVERY_PENDING');
          const content = delivery.items.join('\n\n');
          if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) throw new Error('DELIVERY_TOO_LARGE');
          files = [new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: args[0] + '-hang-da-mua.txt' })];
          payload = presentation.buildSupplierNoticeView({ title: 'Hàng đã mua của bạn',
            text: 'Mã đơn ' + args[0] + '. Nội dung giao hàng nằm trong file đính kèm riêng tư. Bạn có thể nhận lại bằng nút Nhận hàng trên thẻ đơn.',
            customerId: context.customerId, ticketContext: scope.kind === 'ticket' });
        } else if (action === 'pricemodal') {
          if (!await deps.canManage(interaction)) throw new Error('FORBIDDEN');
          const value = interaction.fields?.getTextInputValue('price')?.trim();
          if (!/^[1-9]\d{0,9}$/.test(value || '') || Number(value) > 1_000_000_000) throw inputError('INVALID_PRICE');
          await deps.setPrice({ client: interaction.client, guildId: context.guildId, provider: scope.provider,
            productKey: args[0], priceVnd: Number(value), actorId: context.customerId });
          payload = presentation.buildSupplierNoticeView({ title: 'Đã cập nhật giá', text: 'Giá mới đã được lưu. Báo giá mới sử dụng mức giá đã cập nhật; đơn đã thanh toán giữ nguyên giá đã xác nhận.', customerId: context.customerId });
        }
      }
      if (!Array.isArray(payload?.components) || !payload.components.length) throw new Error('INVALID_PRESENTATION');
    } catch (error) {
      try {
        // Preserve a fixed private fallback for the original preparing card.
        if (!CUSTOMER_ID.test(interaction.user?.id || '')) {
          await interaction.editReply({ content: UNAVAILABLE, allowedMentions: NO_MENTIONS });
          navigation?.finish();
          return true;
        }
        payload = presentation.buildSupplierNoticeView({ title: 'Cần kiểm tra lại', text: errorText(error), customerId: interaction.user.id,
          warning: true, ticketContext: scope.kind === 'ticket' });
      } catch { navigation?.finish(); return true; }
      files = undefined;
    }
    try {
      // A slower prior navigation must not overwrite the latest selected view.
      if (navigation && !navigation.current()) return true;
      const attachments = [...(payload.files || []), ...(files || [])];
      const send = () => interaction.editReply({ components: payload.components, flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS,
        ...(inPlace ? { attachments: [] } : {}), ...(attachments.length ? { files: attachments } : {}) });
      const receipt = navigation ? await navigation.publish(send) : await send();
      if (action === 'delivery' && files?.length) {
        await deps.acknowledgeDelivery({ ...dataContext(interaction, scope.provider), orderCode: args[0], messageId: receipt?.id, channelId: interaction.channelId });
      }
    } catch { /* Notification retries must never repeat payment or purchase. */ }
    finally { navigation?.finish(); }
    return true;
  };
}

export const handleSupplierAutobuyInteraction = createSupplierAutobuyInteractionHandler();
