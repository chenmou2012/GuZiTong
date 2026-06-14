// 登录认证服务
const app = getApp();
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
 * 更新用户资料
 */
async function updateUserInfo(nickname, avatar) {
  const token = getToken();
  if (!token) return false;

  try {
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
    const url = dataType ? `/api/user/data?token=${token}&data_type=${dataType}` : `/api/user/data?token=${token}`;
    const response = await request(url);
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
  console.log('saveUserData token:', token ? 'exists' : 'null');
  if (!token) return false;

  try {
    const response = await request(`/api/user/data?token=${token}`, {
      method: 'PUT',
      data: {
        data_type: dataType,
        data_key: dataKey,
        data_value: JSON.stringify(dataValue)
      }
    });
    console.log('saveUserData response:', response);
    return response.success;
  } catch (e) {
    console.log('saveUserData error:', e);
    return false;
  }
}

/**
 * 登出
 */
function logout() {
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

    wx.request({
      url: fullUrl,
      method: options.method || 'GET',
      data: options.data || {},
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
  getOpenid,
  getUserInfo,
  fetchUserInfo,
  updateUserInfo,
  getUserData,
  saveUserData,
  logout
};