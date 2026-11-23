import { escapeMarkdown } from 'discord.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { formatCurrency } from '../utils/formatters.js';

const DAY = 86_400_000;
const localTime = 7 * 3_600_000;
const publicGuide = Object.freeze({
  booking: 'Mở kênh đặt lịch, chọn Chơi game hoặc Trò chuyện, nhập ngày giờ UTC+7 và thời lượng. Staff xác nhận host và giá trong phiếu riêng. Xem tiến độ bằng `/cenar-booking lich`.',
  hosts: 'Xem hồ sơ đã duyệt trong forum Host. Nếu muốn ứng tuyển, mở kênh tuyển host để gửi biệt danh, dịch vụ và giờ rảnh.',
  payment: 'Báo giá và hướng dẫn thanh toán nằm trong phiếu riêng. Chỉ thanh toán khi giá và lịch đã được xác nhận. Bot đối soát qua PayOS khi thanh toán được bật. Ảnh chụp giao dịch không đổi trạng thái hóa đơn.',
  voice: 'Bot gửi đường dẫn phòng riêng trong phiếu khi đến giờ. Khách và host được cấp quyền vào phòng. Khi cần gia hạn, nhắn staff trong phiếu để cập nhật thời điểm kết thúc.',
});

export function getBookingReport(ledger, { now = Date.now(), from = now - 7 * DAY, to = now + 1 } = {}) {
  const { hosts, totals } = ledger.getPayrollReport(STORE_TWO_GUILD_ID, { from, to });
  return [
    `**${totals.sessions} phiên đã hoàn thành** · ${totals.minutes} phút`,
    `**Doanh thu đối soát:** ${formatCurrency(totals.revenue)}\n**Tiền công host:** ${formatCurrency(totals.wage)}`,
    ...hosts.slice(0, 8).map(host => `<@${host.host_id}> · ${host.sessions} phiên · ${host.minutes} phút · ${formatCurrency(host.wage)}`),
    ...(hosts.length > 8 ? [`Còn ${hosts.length - 8} host trong tổng số trên.`] : []),
  ];
}

export async function answerBookingQuestion(ledger, question, manager, now = Date.now()) {
  const text = question.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd');
  if (/doanh thu|tien cong|\bluong\b|thong ke|bao cao|cham chi/.test(text)) {
    if (!manager) return ['Báo cáo doanh thu và tiền công chỉ hiển thị cho quản lý.'];
    const local = new Date(now + localTime);
    const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - localTime;
    const from = /hom nay/.test(text) ? today : /tuan nay/.test(text)
      ? today - (local.getUTCDay() + 6) % 7 * DAY : now - 7 * DAY;
    return getBookingReport(ledger, { now, from });
  }

  const topic = /ho so|tuyen|player|\bhost\b/.test(text) ? 'hosts' : /hoa don|thanh toan|chuyen khoan|\bqr\b/.test(text)
    ? 'payment' : /gia han|phong|\bvoice\b/.test(text) ? 'voice' : 'booking';
  if (process.env.BOOKING_AI_ENABLED !== 'true') return [publicGuide[topic]];
  try {
    const { requestAiCompletion } = await import('./aiService.js');
    // Only send the approved public help entry. Personal details and staff reports stay in Discord.
    const answer = await requestAiCompletion({
      systemPrompt: 'Bạn là trợ lý Cenar Booking. Tóm tắt hướng dẫn công khai bằng tiếng Việt trong tối đa hai câu. Giữ nguyên tên lệnh. Không thêm giá, chính sách hoặc lời hứa.',
      history: [{ role: 'user', content: publicGuide[topic] }], tools: [],
    }, { timeoutMs: 7_000 });
    const line = String(answer.content || '').trim().slice(0, 600);
    return line ? [escapeMarkdown(line)] : [publicGuide[topic]];
  } catch {
    return [publicGuide[topic]];
  }
}
