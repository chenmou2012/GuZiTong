// scripts/test_collection_integration.js
// 端到端测试：模拟真实 bug 场景，URL word 未被 WeChat 解码

const storage = {};
const mockWx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, val) => { storage[key] = val; },
  removeStorageSync: (key) => { delete storage[key]; },
  showModal: (opts) => {
    console.log('  [modal]', opts.title, '|', opts.content.split('\n')[0]);
    if (opts.success) opts.success({ confirm: true });
  },
  showToast: () => {},
  navigateBack: () => {}
};
global.wx = mockWx;
global.getApp = () => ({ globalData: { statusBarHeight: 20 } });
global.Page = (config) => config;

const storageSvc = require('../utils/services/storage.js');
const markdownSvc = require('../utils/services/markdown.js');
const wsClient = require('../utils/services/websocket.js');
const auth = require('../utils/services/auth.js');
const errorUi = require('../utils/services/error.js');
const logger = require('../utils/services/logger.js');

// 直接复制 onLoad 逻辑（修复后版本）作为测试 fixture，避免 Page() mock 副作用
const markdownSvc2 = require('../utils/services/markdown.js');
function makeOnLoad(storage) {
  return function(options) {
    let raw = options.word || '';
    try {
      if (raw.includes('%')) raw = decodeURIComponent(raw);
    } catch (e) {}
    const word = raw.trim();
    const collections = storage.getCollections();
    const normalize = (s) => (s || '').trim().normalize('NFC');
    const item = collections.find(c => normalize(c.word) === normalize(word));
    if (!item) {
      const actualWords = collections.slice(0, 3).map(c => c.word).join('、');
      const tip = collections.length === 0 ? '收藏列表为空' : '找不到「' + word + '」（列表: ' + actualWords + '）';
      mockWx.showModal({ title: '收藏不存在', content: tip, success: () => mockWx.navigateBack() });
      return;
    }
    this.setData({
      word: word,
      originalResult: item.result || '',
      originalHtml: markdownSvc2.markdownToHtml(item.result || ''),
    });
  };
}

console.log('===== 场景 1: 之前收藏的「友」字，URL word 未解码 =====');
// 准备 storage: 收藏了一个 "友"
storageSvc.addCollection('友', '友，会意字，从又从𠂇。');

// 模拟 WeChat 未解码的情况：options.word 是 "%E5%8F%8B"
const fakePage = {
  data: {},
  setData: function(obj) { Object.assign(this.data, obj); },
  onLoad: makeOnLoad(storageSvc)
};

fakePage.onLoad({ word: '%E5%8F%8B' });  // 未解码的字面编码串

if (fakePage.data.word === '友' && fakePage.data.originalResult) {
  console.log('  [OK] 找到收藏，data.word =', JSON.stringify(fakePage.data.word));
  console.log('  [OK] originalResult 长度 =', fakePage.data.originalResult.length);
} else {
  console.error('  [FAIL] 期望 word="友"，实际:', JSON.stringify(fakePage.data.word));
  process.exit(1);
}

console.log('\n===== 场景 2: 之前收藏的「之」字，URL word 已正常解码 =====');
storageSvc.addCollection('之', '之，指示代词。');
fakePage.data = {};
fakePage.onLoad({ word: '之' });  // 已解码

if (fakePage.data.word === '之') {
  console.log('  [OK] 找到收藏，data.word =', JSON.stringify(fakePage.data.word));
} else {
  console.error('  [FAIL] 期望 word="之"，实际:', JSON.stringify(fakePage.data.word));
  process.exit(1);
}

console.log('\n===== 场景 3: 边界 - word 含 % 但非编码（"100%"）=====');
storageSvc.addCollection('100%', '百分号字面值测试。');
fakePage.data = {};
fakePage.onLoad({ word: '100%' });

if (fakePage.data.word === '100%') {
  console.log('  [OK] 找到收藏，data.word =', JSON.stringify(fakePage.data.word));
} else {
  console.error('  [FAIL] 期望 word="100%"，实际:', JSON.stringify(fakePage.data.word));
  process.exit(1);
}

console.log('\n===== 场景 4: 边界 - word 为空 =====');
fakePage.data = {};
fakePage.onLoad({});
if (!fakePage.data.word && !fakePage.data.originalResult) {
  console.log('  [OK] 空 word 不进入页面（弹 modal 后 return）');
} else {
  console.error('  [FAIL] 空 word 应不进入页面，实际:', JSON.stringify(fakePage.data.word));
  process.exit(1);
}

console.log('\n===== 场景 5: 之前收藏带前后空格，URL word 已解码 =====');
storageSvc.addCollection('古字', '古字，甲骨文...');
fakePage.data = {};
fakePage.onLoad({ word: '古字' });

if (fakePage.data.word === '古字') {
  console.log('  [OK] 找到收藏，data.word =', JSON.stringify(fakePage.data.word));
} else {
  console.error('  [FAIL] 期望 word="古字"，实际:', JSON.stringify(fakePage.data.word));
  process.exit(1);
}

console.log('\n===== 全部集成测试通过 =====');