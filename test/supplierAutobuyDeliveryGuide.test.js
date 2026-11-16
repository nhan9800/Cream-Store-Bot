import { describe, expect, it } from 'vitest';
import { buildSupplierDeliveryGuide, supplierDeliveryGuideSections } from '../src/services/supplierAutobuyDeliveryGuide.js';

const delivery = { orderCode: 'CN_123456', productKey: 'cdkvietnam:6', productName: 'CDK Claude PRO 1M (IOS) - BH Gói',
  termLabel: '1 tháng', warrantyLabel: 'Theo điều khoản CDK iOS đã xác nhận; không bảo đảm kích hoạt 100%.',
  accountForm: 'CDK iOS + hướng dẫn Organization ID; KYC/Team/tuổi tài khoản.' };
const emoji = () => { let i = 0; return slot => `<:${slot}:${1382729296724099132n + BigInt(i++)}>`; };

describe('private AutoBuy delivery guidance', () => {
  it('shows saved terms, Claude preparation and recovery without copying goods or source accounting into Discord text', () => {
    const text = buildSupplierDeliveryGuide({ ...delivery, items: ['private-key'], unitCostVnd: 525000, supplierOrderCode: 'source-id' }, emoji());
    expect(text).toContain('KYC, tuổi tài khoản và Team/Organization');
    expect(text).toContain('Nhận mã chưa đồng nghĩa đã kích hoạt thành công');
    expect(text).toContain('Đơn của tôi → Nhận hàng riêng');
    expect(text).toContain('1 tháng'); expect(text).toContain('không bảo đảm kích hoạt 100%');
    expect(text).not.toMatch(/private-key|525000|source-id|https?:/);
    const custom = [...text.matchAll(/<a?:[A-Za-z0-9_]+:(\d+)>/g)].map(x => x[1]);
    expect(custom).toHaveLength(8); expect(new Set(custom).size).toBe(8);
    expect(text.length).toBeLessThan(2000);
  });

  it('chooses CDK and supplied-account instructions without inventing a redemption URL or a warranty', () => {
    const cdk = buildSupplierDeliveryGuide({ ...delivery, productKey: 'cdkvietnam:16', productName: 'CDK ChatGPT Plus Android KBH',
      accountForm: 'CDK Android', warrantyLabel: 'Không bảo hành' });
    expect(cdk).toContain('hình thức iOS/Android/Pay Thẻ'); expect(cdk).toContain('Không bảo hành');
    expect(cdk).not.toContain('KYC, tuổi tài khoản');
    const account = buildSupplierDeliveryGuide({ productName: 'ChatGPT Plus', accountForm: 'Cấp tài khoản nguồn' });
    expect(account).toContain('Đăng nhập bằng thông tin nguồn bàn giao');
    expect(account).not.toContain('**Bảo hành:**'); expect(account).not.toMatch(/https?:/);
  });

  it('keeps hostile metadata inert and bounded under the Discord DM limit', () => {
    const value = '@everyone <@123456789012345678> https://attacker.invalid/claim 😀 ** ``` \\'.repeat(50);
    const text = buildSupplierDeliveryGuide({ ...delivery, productName: value, accountForm: value, termLabel: value, warrantyLabel: value,
      orderCode: '@everyone' }, emoji());
    expect(text.length).toBeLessThan(2000);
    expect(text).not.toMatch(/@everyone|<@|https?:\/\/|😀|```/);
    expect(text).toContain('Xem trên thẻ đơn');
    const sections = supplierDeliveryGuideSections({ ...delivery, items: ['never-in-presentation'] });
    expect(JSON.stringify(sections)).not.toContain('never-in-presentation');
  });
});
