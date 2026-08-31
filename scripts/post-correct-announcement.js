import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const envFileName = process.env.ENV_FILE || '.env';

dotenv.config({
  path: path.resolve(projectRoot, envFileName),
  override: true
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const isBot1 = !process.env.ENV_FILE || process.env.ENV_FILE === '.env';

// Store 1 IDs
const STORE1_ANNOUNCE_ID = '1514598369597587546';
const STORE1_TERMS_ID = '1514597981666672691';

// Store 2 IDs
const STORE2_ANNOUNCE_ID = '1514594182717640735';
const STORE2_TERMS_ID = '1514594186828189858';

const announceChannelId = isBot1 ? STORE1_ANNOUNCE_ID : STORE2_ANNOUNCE_ID;
const termsChannelId = isBot1 ? STORE1_TERMS_ID : STORE2_TERMS_ID;
const storeName = isBot1 ? 'Cenar Store 1' : 'Cenar Store 2';

const announcementText = `## <a:tsm_fire:1327553120842158111> THÔNG BÁO QUY ĐỊNH DỊCH VỤ & CHÍNH SÁCH BẢO HÀNH <a:tsm_fire:1327553120842158111>
<a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059>

Quý khách vui lòng đọc kỹ các quy định dưới đây để đảm bảo quyền lợi tốt nhất khi giao dịch tại **Cenar Store**:

### <:verifybadge:1481127479702847646> 1. DỊCH VỤ DISCORD NITRO
* **Nitro 2 tháng (Mua mới):**
  * <a:chamxanh:1481124932447371374> Shop chỉ nhận bảo hành khi Gmail liên kết **còn hoạt động bình thường**.
  * <a:chamxanh:1481124932447371374> Nếu bạn để Gmail bị khóa/chết, shop xin phép **miễn trừ trách nhiệm**.
  * <a:chamxanh:1481124932447371374> *Lưu ý:* Do thị trường Gmail khan hiếm, đơn mua mới có thể bị trả đơn chậm nhẹ.
* **Nitro 12 tháng (Gia hạn):**
  * <a:chamxanh:1481124932447371374> Bảo hành đầy đủ khi Gmail hoạt động tốt. Trường hợp Gmail bị mất/khóa, thời gian bảo hành sẽ bị khấu trừ **1 - 2 tháng** tùy mức độ khôi phục tài khoản.
* **Quy trình gia hạn:**
  * <a:chamxanh:1481124932447371374> Cần thực hiện gia hạn ngay sau khi gói cũ vừa hết hạn. Quá hạn trên 1 tháng sẽ không thể gia hạn tiếp mà phải mua gói mới.

### <:cenar_yt_logo:1543842435707310151> 2. DỊCH VỤ YOUTUBE PREMIUM
* **Mua mới:** Quý khách chỉ cần gửi địa chỉ Gmail, kiểm tra thư mời và bấm đồng ý tham gia Family.
* **Bảo hành:** Cung cấp đầy đủ **Gmail chủ Family** và **Gmail cá nhân của bạn** để xử lý nhanh nhất.
* **Bảo mật:** Nhóm gia đình đảm bảo **riêng tư 100%**, tuyệt đối không chia sẻ thông tin cá nhân.

### <:Partner:1367138825129955379> 3. CHÍNH SÁCH BẢO HÀNH CHUNG
* **Duy trì thành viên:** Rời (out) khỏi Server Discord của shop sẽ bị **từ chối hỗ trợ bảo hành** cho mọi đơn hàng trước đó.
* **Yêu cầu Feedback:** Bắt buộc gửi feedback đánh giá sau khi hoàn thành đơn để kích hoạt bảo hành. Shop xin phép không hỗ trợ bảo hành nếu thiếu feedback.
* **Thời gian giao hàng:** Shop cam kết không giữ (hold) đơn hàng. Các gói Spotify, YouTube, Netflix... luôn được xử lý rất nhanh.

<a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059>
<a:starxoay:1481141954346483845> **Chúc quý khách mua sắm vui vẻ cùng Cenar Store!** <:purple_heart_glow:1327541911749263360>`;

const termsText = `## <a:emoji:1327552040355762187> ĐIỀU KHOẢN DỊCH VỤ & CHÍNH SÁCH BẢO HÀNH <a:emoji:1327552040355762187>
<a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059>

Khi thực hiện giao dịch tại **Cenar Store**, quý khách mặc định đồng ý tuân thủ các quy định dưới đây:

### <:cr_baohanh:1348625535512870965> 1. CHÍNH SÁCH BẢO HÀNH CHUNG
* <:muiten:1481124261501337601> **Duy trì thành viên:** Không out khỏi Server Discord của shop. Out Server đồng nghĩa với việc tự nguyện **từ bỏ quyền bảo hành** đối với toàn bộ dịch vụ đã mua.
* <:muiten:1481124261501337601> **Gửi đánh giá (Feedback):** Bắt buộc phải gửi feedback đánh giá sau khi nhận hàng để kích hoạt thời gian bảo hành.
* <:muiten:1481124261501337601> **Ticket hỗ trợ:** Khi có sự cố, vui lòng mở ticket đúng loại và cung cấp đầy đủ thông tin để staff hỗ trợ nhanh nhất.

### <:cr_cardd:1348624271437463552> 2. ĐIỀU KHOẢN DISCORD NITRO
* <:muiten:1481124261501337601> **Nitro 2 tháng:** Chỉ hỗ trợ bảo hành khi Gmail liên kết sống. Gmail bị khóa/vô hiệu hóa sẽ không thuộc diện hỗ trợ.
* <:muiten:1481124261501337601> **Nitro 12 tháng:** Hỗ trợ bảo hành khi Gmail sống. Trường hợp mất/khóa Gmail, shop khấu trừ **1 - 2 tháng** thời hạn bảo hành.
* <:muiten:1481124261501337601> **Hạn gia hạn:** Thực hiện gia hạn ngay khi gói cũ hết hạn. Quá hạn trên 1 tháng buộc phải chuyển sang gói mua mới.

### <:cr_shop:1392749981332541501> 3. ĐIỀU KHOẢN DỊCH VỤ KHÁC
* <:muiten:1481124261501337601> **YouTube Premium:** Tham gia Family qua lời mời email. Đảm bảo nhóm gia đình bảo mật và riêng tư 100%.
* <:muiten:1481124261501337601> **Giao nhận:** Các đơn hàng Spotify, YouTube, Netflix... được giao tự động và nhanh chóng.

<a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059><a:ccjdeobt:1481142015994495059>
-# *Điều khoản có thể được cập nhật theo thời gian để phù hợp với chính sách của các nhà cung cấp gốc (Discord, Google, Netflix...).*`;

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} for ${storeName}`);
  
  const embedColor = isBot1 ? 0x7C3AED : 0xF472B6;

  // 1. Post to announcement channel
  try {
    const announceCh = await client.channels.fetch(announceChannelId).catch(() => null);
    if (announceCh) {
      const cleanAnnounceText = announcementText.replace('@everyone', '').trim();
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setDescription(cleanAnnounceText)
        .setTimestamp();
      await announceCh.send({ embeds: [embed] });
      console.log(`Successfully sent announcement embed to channel ${announceChannelId} in ${storeName}`);
    } else {
      console.error(`Announce channel ${announceChannelId} not found in ${storeName}`);
    }
  } catch (err) {
    console.error(`Error sending to announce channel in ${storeName}:`, err);
  }

  // 2. Post to terms channel
  try {
    const termsCh = await client.channels.fetch(termsChannelId).catch(() => null);
    if (termsCh) {
      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setDescription(termsText)
        .setTimestamp();
      await termsCh.send({ embeds: [embed] });
      console.log(`Successfully sent terms embed to channel ${termsChannelId} in ${storeName}`);
    } else {
      console.error(`Terms channel ${termsChannelId} not found in ${storeName}`);
    }
  } catch (err) {
    console.error(`Error sending to terms channel in ${storeName}:`, err);
  }
  
  client.destroy();
  process.exit(0);
});

client.login(process.env.BOT_TOKEN);
