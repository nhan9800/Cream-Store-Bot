import fetch from 'node-fetch';

const VIOTP_TOKEN = process.env.VIOTP_TOKEN || 'f352811c1a8441b6a7e730e5498ccfb8';
const API_BASE = 'https://api.viotp.com';

async function callApi(endpoint, params = {}) {
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
    throw new Error(data.message || `Lỗi API ViOTP: ${data.status_code}`);
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
 * @param {string} requestId 
 * @returns {Promise<{ID: string, Phone: string, Status: number, Code: string, SmsContent: string}>}
 */
export async function checkSession(requestId) {
  return await callApi('/session/getv2', { requestId });
}
