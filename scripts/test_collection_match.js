// scripts/test_collection_match.js
// 验证 collection-detail 在各种情况下能否正确匹配 storage 里的收藏
// 模拟真实场景：URL 传来的 word 与 storage 里的 word 可能存在的差异

const storage = {};

const mockWx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, val) => { storage[key] = val; },
  removeStorageSync: (key) => { delete storage[key]; }
};
global.wx = mockWx;
global.getApp = () => ({ globalData: { statusBarHeight: 20 } });
global.Page = (config) => config;

const storageSvc = require('../utils/services/storage.js');

// 模拟 onLoad 的查找逻辑（与 collection-detail.js 一致）
function findCollection(collections, optionsWord) {
  const word = (optionsWord || '').trim();
  const normalize = (s) => (s || '').trim().normalize('NFC');
  return collections.find(c => normalize(c.word) === normalize(word));
}

// 模拟 onItemTap 的 URL 构造（与 collections.js 一致）
function buildUrl(itemWord) {
  return '/pages/collection-detail/collection-detail?word=' + encodeURIComponent(itemWord);
}

// 模拟 wx.navigateTo 接收后 options.word 的值（decodeURIComponent）
function simulateNavigate(url) {
  const queryStr = url.split('?')[1] || '';
  const params = {};
  queryStr.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    params[k] = decodeURIComponent(v || '');
  });
  return params;
}

// ================ TEST 1: 新版（trim 后收藏）====================
console.log('\n===== TEST 1: 新版 - 收藏时 trim 过 =====');
storage.collections = [{ word: '古', result: '...', time: 1 }];
const url1 = buildUrl('古');
console.log('  URL:', url1);
const opts1 = simulateNavigate(url1);
console.log('  options.word:', JSON.stringify(opts1.word));
const item1 = findCollection(storage.collections, opts1.word);
console.log('  找到:', item1 ? 'YES (word=' + item1.word + ')' : 'NO');
console.assert(item1, 'TEST 1 FAIL: 应该能找到');

// ================ TEST 2: 旧版（收藏时未 trim，有尾空格）====================
console.log('\n===== TEST 2: 旧版 - 收藏时未 trim，word 有尾空格 =====');
storage.collections = [{ word: '古 ', result: '...', time: 1 }];
const url2 = buildUrl('古 ');
console.log('  URL:', url2);
const opts2 = simulateNavigate(url2);
console.log('  options.word:', JSON.stringify(opts2.word));
const item2 = findCollection(storage.collections, opts2.word);
console.log('  找到:', item2 ? 'YES (word=' + item2.word + ')' : 'NO');
console.assert(item2, 'TEST 2 FAIL: 应该能找到');

// ================ TEST 3: 收藏中含其他特殊字符（全角/半角）====================
console.log('\n===== TEST 3: word 含全角空格 =====');
storage.collections = [{ word: '古　字', result: '...', time: 1 }];
const url3 = buildUrl('古　字');
console.log('  URL:', url3);
const opts3 = simulateNavigate(url3);
console.log('  options.word:', JSON.stringify(opts3.word));
const item3 = findCollection(storage.collections, opts3.word);
console.log('  找到:', item3 ? 'YES' : 'NO');
console.assert(item3, 'TEST 3 FAIL: 应该能找到');

// ================ TEST 4: word 有前后空格差异 ====================
console.log('\n===== TEST 4: 收藏 word="古"，URL word="  古  " =====');
storage.collections = [{ word: '古', result: '...', time: 1 }];
const url4 = buildUrl('  古  ');
console.log('  URL:', url4);
const opts4 = simulateNavigate(url4);
console.log('  options.word:', JSON.stringify(opts4.word));
const item4 = findCollection(storage.collections, opts4.word);
console.log('  找到:', item4 ? 'YES' : 'NO');
console.assert(item4, 'TEST 4 FAIL: 应该能找到');

// ================ TEST 5: 真正的 bug 场景模拟 ====================
// 假设：storage 里的 word 和 URL 传来的 word 都 trim 过，
// 但 storage 里的 word 是来自旧云端（合并时引入），与本地新增的不一致？
console.log('\n===== TEST 5: URL word 不在 storage 里（真正的 bug 场景） =====');
storage.collections = [
  { word: '字', result: '...', time: 1 },
  { word: '古字', result: '...', time: 2 },
];
const url5 = buildUrl('古');
const opts5 = simulateNavigate(url5);
const item5 = findCollection(storage.collections, opts5.word);
console.log('  找到:', item5 ? 'YES' : 'NO（用户报的就是这种情况）');

// ================ TEST 6: 实际场景模拟 - storage 中 word 是 "古字通" 但 records-list 显示 "古字" 截断？====================
console.log('\n===== TEST 6: records-list 是否可能修改 word？ =====');
// 这需要看 records-list 组件是否有 filter 逻辑 - 检查 wxml
// 已确认 records-list 只渲染 {{item[titleField]}} 不修改 word

console.log('\n===== 总结 =====');
console.log('如果 TEST 1-4 都通过，但用户仍报 bug，说明问题在 records-list 显示的数据与实际 storage 不一致');
console.log('可能原因：');
console.log('  1. onShow 没刷新（数据陈旧）');
console.log('  2. 云端合并时引入了 word 不同的项');
console.log('  3. 列表过滤逻辑错误');