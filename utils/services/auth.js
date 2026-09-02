// 登录认证服务
const logger = require('./logger.js');
const log = logger.for('auth');
const API_BASE_URL = 'https://share.sng-oj.cn';

const STORAGE_KEYS = {
  TOKEN: 'auth_token',
  OPENID: 'auth_openid',
  USER_INFO: 'user_info'
};

/**
 * 微信登录
 */
function login() {
  return new Promise((resolve, reject) => {
    // 1. 获取 code
    wx.login({
      success: async (res) => {
        if (!res.code) {
          reject(new Error('获取 code 失败'));
          return;
        }

        try {
          // 2. 调用后端登录接口
          const response = await request('/api/login', {
            method: 'POST',
            data: { code: res.code }
          });

          if (response.error) {
            reject(new Error(response.error));
            return;
          }

          // 3. 保存登录态
          setToken(response.token);
          setOpenid(response.openid);

          resolve({
            openid: response.openid,
            token: response.token
          });
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

/**
 * 检查登录态
 */
function checkLogin() {
  const token = wx.getStorageSync(STORAGE_KEYS.TOKEN);
  return !!token;
}

/**
 * 获取 token
 */
function getToken() {
  return wx.getStorageSync(STORAGE_KEYS.TOKEN);
}

/**
 * 保存 token
 */
function setToken(token) {
  wx.setStorageSync(STORAGE_KEYS.TOKEN, token);
}

/**
 * 获取 openid
 */
function getOpenid() {
  return wx.getStorageSync(STORAGE_KEYS.OPENID);
}

/**
 * 保存 openid
 */
function setOpenid(openid) {
  wx.setStorageSync(STORAGE_KEYS.OPENID, openid);
}

/**
 * 获取用户信息
 */
function getUserInfo() {
  return wx.getStorageSync(STORAGE_KEYS.USER_INFO) || null;
}

/**
 * 保存用户信息
 */
function setUserInfo(info) {
  wx.setStorageSync(STORAGE_KEYS.USER_INFO, info);
}

/**
 * 获取用户资料（从云端）
 */
async function fetchUserInfo() {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await request('/api/user', {
      method: 'GET',
      header: { 'Authorization': 'Bearer ' + token }
    });

    if (response.error) return null;

    setUserInfo(response);
    return response;
  } catch (e) {
    return null;
  }
}

/**
 * 把字符串哈希成 8 位十六进制字符串（无符号 32-bit）。
 * 用于把任意长度的 openid 收敛成稳定可读的短标识。
 */
function _hashToHex8(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0; // 收敛到 32 位有符号
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 根据 openid 生成默认昵称：「文言学者」+ 4 位十六进制字符。
 * 没有 openid 时回退到「古字通用户」。
 */
function getDefaultNickname() {
  const openid = getOpenid();
  if (!openid) return '古字通用户';
  return '文言学者' + _hashToHex8(openid).slice(0, 4);
}

/**
 * 更新用户资料
 */
async function updateUserInfo(nickname, avatar) {
  const token = getToken();
  if (!token) return false;

  try {
    // 用 body 而非 query：头像 URL 长度可达数百字符，query 容易超 URL 长度限制
    const response = await request('/api/user', {
      method: 'PUT',
      data: { nickname, avatar },
      header: { 'Authorization': 'Bearer ' + token }
    });

    if (response.success) {
      const info = getUserInfo() || {};
      if (nickname) info.nickname = nickname;
      if (avatar) info.avatar = avatar;
      setUserInfo(info);
    }
    return response.success;
  } catch (e) {
    return false;
  }
}

/**
 * 获取用户数据
 */
async function getUserData(dataType) {
  const token = getToken();
  if (!token) return {};

  try {
    const url = dataType ? `/api/user/data?data_type=${dataType}` : '/api/user/data';
    const response = await request(url, {
      header: { 'Authorization': 'Bearer ' + token }
    });
    return response.data || {};
  } catch (e) {
    return {};
  }
}

/**
 * 保存用户数据
 */
async function saveUserData(dataType, dataKey, dataValue) {
  const token = getToken();
  if (!token) return false;

  try {
    const response = await request('/api/user/data', {
      method: 'PUT',
      data: {
        data_type: dataType,
        data_key: dataKey,
        data_value: dataValue
      },
      header: { 'Authorization': 'Bearer ' + token }
    });
    return response.success;
  } catch (e) {
    log.error('saveUserData failed:', e);
    return false;
  }
}

/**
 * 换取一次性 WS ticket（P0-3）
 * 30s 有效，一次性消费。让 token 不出现在 URL/Nginx 日志。
 *
 * @returns {Promise<string|null>} ticket 或 null（失败/未登录）
 */
async function fetchWsTicket() {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await request('/api/ws-ticket', {
      method: 'POST',
      header: { 'Authorization': 'Bearer ' + token }
    });
    if (response && response.ticket) return response.ticket;
    log.warn('fetchWsTicket: 响应无 ticket', response);
    return null;
  } catch (e) {
    log.warn('fetchWsTicket failed:', e.message);
    return null;
  }
}

/**
 * 提交用户反馈（小程序 → 管理后台查看处理）
 * @param {string} content 反馈内容
 * @param {string} contact 联系方式（选填）
 * @returns {Promise<boolean>}
 */
async function submitFeedback(content, contact) {
  const token = getToken();
  if (!token) return false;
  try {
    const response = await request('/api/feedback', {
      method: 'POST',
      data: { content: content, contact: contact || '' },
      header: { 'Authorization': 'Bearer ' + token }
    });
    return response.success === true;
  } catch (e) {
    log.error('submitFeedback failed:', e);
    return false;
  }
}

/**
 * 登出（服务端撤销 token + 本地清缓存）
 */
async function logout() {
  const token = getToken();
  // 先调服务端撤销 token（P0-4），失败也继续清本地（登出幂等）
  if (token) {
    try {
      await request('/api/logout', {
        method: 'POST',
        header: { 'Authorization': 'Bearer ' + token }
      });
    } catch (e) {
      // 网络失败也无所谓：登出动作不能卡住用户
      log.warn('logout: 服务端撤销失败（已忽略）:', e.message);
    }
  }
  wx.removeStorageSync(STORAGE_KEYS.TOKEN);
  wx.removeStorageSync(STORAGE_KEYS.OPENID);
  wx.removeStorageSync(STORAGE_KEYS.USER_INFO);
}

/**
 * 网络请求
 */
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const fullUrl = API_BASE_URL + url;
    const token = getToken();

    // 默认 15s 超时，避免弱网下 loading 卡死
    const timeout = options.timeout || 15000;

    wx.request({
      url: fullUrl,
      method: options.method || 'GET',
      data: options.data || {},
      timeout: timeout,
      header: {
        'Content-Type': 'application/json',
        ...options.header
      },
      success: (res) => {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error('请求失败: ' + res.statusCode));
        }
      },
      fail: (err) => {
        reject(err);
      }
    });
  });
}

module.exports = {
  login,
  checkLogin,
  getToken,
  setToken,
  getOpenid,
  setOpenid,
  getUserInfo,
  setUserInfo,
  fetchUserInfo,
  getDefaultNickname,
  updateUserInfo,
  getUserData,
  saveUserData,
  fetchWsTicket,
  submitFeedback,
  logout
};
