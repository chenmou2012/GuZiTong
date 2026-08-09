// scripts/test_privacy_guard.js
// 隐私守卫：未登录状态下不得触发任何网络请求（wx.request）。
// 云开发已彻底移除，同步一律走 FastAPI 后端；未登录时 auth.getToken() 为空，
// syncDataToServer 必须直接跳过，不发请求、不弹错误。

const store = {};
let requestCount = 0;

global.wx = {
  getStorageSync: (key) => store[key],
  setStorageSync: (key, val) => { store[key] = val; },
  removeStorageSync: (key) => { delete store[key]; },
  request: (opts) => {
    requestCount++;
    opts.success && opts.success({ statusCode: 200, data: {} });
  }
};
global.getApp = () => ({ globalData: {} });
global.Page = (config) => config;

const storageSvc = require('../utils/services/storage.js');

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ❌ ' + msg);
  }
}

console.log('===== TEST 1: 未登录 → 本地写操作不触发网络 =====');
store['auth_token'] = undefined;
requestCount = 0;
storageSvc.saveHistory('比', '内容');
storageSvc.toggleCollection('比', {});
storageSvc.setCachedWord('比', '缓存内容');
storageSvc.setCachedTranslation('学而时习之', '译文');
storageSvc.toggleTranslation('学而时习之', '译文');
assert(requestCount === 0, `未登录时 0 个网络请求 (实际 ${requestCount})`);

console.log('\n===== TEST 2: 已登录 → 写操作正常同步 =====');
store['auth_token'] = 'mock_token';
requestCount = 0;
storageSvc.saveHistory('为', '内容2');
assert(requestCount === 1, `已登录时 saveHistory 触发 1 次同步 (实际 ${requestCount})`);

console.log('\n===== TEST 3: 本地数据仍在（未登录也不丢） =====');
assert(storageSvc.getHistory().length === 2, '历史记录保存在本地');
assert(storageSvc.isCollected('比') === true, '收藏保存在本地');

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
