

// ViOTP uses a token query parameter. Keep the value out of logs and fail early
// when the hosting environment has not been configured yet.
const VIOTP_TOKEN = String(process.env.VIOTP_TOKEN || process.env.VIOTP_API_TOKEN || '').trim();
const API_BASE = 'https://api.viotp.com';

async function callApi(endpoint, params = {}) {
  if (!VIOTP_TOKEN) {
    const error = new Error('Thiếu VIOTP_TOKEN trên hosting. Hãy thêm token API ViOTP vào cả .env và .env.store2 rồi khởi động lại bot.');
    error.code = 'VIOTP_NOT_CONFIGURED';
    console.error('[VIOTP_CONFIG_ERROR] VIOTP_TOKEN is not configured');
    throw error;
  }

  const url = new URL(`${API_BASE}${endpoint}`);
  url.searchParams.append('token', VIOTP_TOKEN);
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  }

  const response = await fetch(url.toString());
  const data = await response.json();
  
  // ViOTP trả về status_code = 200 khi thành công
  if (data.status_code !== 200) {
    console.error('[VIOTP_API_ERROR] Raw response:', JSON.stringify(data));
    const code = data.status_code ?? data.status ?? 'undefined';
    const error = new Error(
      code === 401
        ? 'Token ViOTP không hợp lệ hoặc đã hết hạn. Hãy kiểm tra lại VIOTP_TOKEN trên hosting.'
        : (data.message || `Lỗi API ViOTP (Code: ${code})`),
    );
    error.code = code === 401 ? 'VIOTP_AUTH_INVALID' : 'VIOTP_API_ERROR';
    throw error;
  }
  return data.data;
}

/**
 * Lấy số dư tài khoản ViOTP
 * @returns {Promise<{balance: number}>}
 */
export async function getBalance() {
  return await callApi('/users/balance');
}

/**
 * Lấy danh sách dịch vụ
 * @param {string} country 'vn' hoặc 'la'
 * @returns {Promise<Array<{id: number, name: string, price: number}>>}
 */
export async function getServices(country = 'vn') {
  return await callApi('/service/getv2', { country });
}

/**
 * Yêu cầu thuê số
 * @param {number} serviceId 
 * @param {string} network 
 * @param {string} country 
 * @returns {Promise<{phone_number: string, balance: number, request_id: string, countryISO: string}>}
 */
export async function requestOtp(serviceId, network = null, country = 'vn') {
  const params = { serviceId };
  if (country === 'la') params.country = 'la';
  if (network) params.network = network;
  return await callApi('/request/getv2', params);
}

/**
 * Kiểm tra trạng thái mã OTP
 * @param {string|number} requestId 
 * @returns {Promise<{ID: string, Phone: string, Status: number, Code: string, SmsContent: string}>}
 */
export async function checkSession(requestId) {
  const cleanId = Math.floor(Number(requestId));
  return await callApi('/session/getv2', { requestId: cleanId });
}
