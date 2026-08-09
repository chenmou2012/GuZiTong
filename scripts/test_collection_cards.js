// scripts/test_collection_cards.js
// 验证 collection-detail 卡片渲染：parseMarkdown + 时间戳 + 边界

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
  navigateBack: () => {},
  showLoading: () => {},
  hideLoading: () => {}
};
global.wx = mockWx;
global.getApp = () => ({ globalData: { statusBarHeight: 20 } });
global.Page = (config) => config;

const storageSvc = require('../utils/services/storage.js');
const markdownSvc = require('../utils/services/markdown.js');

// 复制 collection-detail.js 的 onLoad 逻辑（完整版，含卡片数据）
function formatCollectedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const Y = d.getFullYear();
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return Y + '年' + M + '月' + D + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function formatCollectedAtShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return M + '月' + D + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

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
    const resultText = item.result || '';
    const parsed = markdownSvc.parseMarkdown(resultText);
    this.setData({
      word: word,
      originalResult: resultText,
      originalHtml: markdownSvc.markdownToHtml(resultText),
      parsedOriginal: parsed,
      displayParsed: parsed,
      statusBarHeight: 20,
      collectedAt: formatCollectedAt(item.time),
      collectedAtShort: formatCollectedAtShort(item.time)
    });
  };
}

function makePage() {
  return {
    data: { originalResult: '', originalHtml: '', parsedOriginal: null, displayParsed: null, collectedAt: '', collectedAtShort: '' },
    setData: function(obj) { Object.assign(this.data, obj); },
    onLoad: makeOnLoad(storageSvc)
  };
}

// ============ 场景 1: 典型 AI 输出（读音 + 多个义项）============
console.log('\n===== 场景 1: 典型结构化输出 =====');
const sampleMarkdown = `## 读音
yǒu

1. **【名词】朋友**
例句：有朋自远方来。【论语·学而】

2. **【动词】亲近、友好**
释义：与人亲近、交好。
例句：出入相友。【孟子·滕文公上】

3. **【副词】表示反问**
释义：相当于"难道"。
例句：有不为也。【孟子·梁惠王下】`;

storageSvc.addCollection('友', sampleMarkdown);
const p1 = makePage();
p1.onLoad({ word: '友' });

console.log('  word:', p1.data.word);
console.log('  originalResult 长度:', p1.data.originalResult.length);
console.log('  parsedOriginal.pinyin:', JSON.stringify(p1.data.parsedOriginal.pinyin));
console.log('  parsedOriginal.meanings 数量:', p1.data.parsedOriginal.meanings.length);

if (p1.data.parsedOriginal.meanings.length !== 3) {
  console.error('  [FAIL] 应有 3 个义项，实际:', p1.data.parsedOriginal.meanings.length);
  process.exit(1);
}

const m1 = p1.data.parsedOriginal.meanings[0];
const m2 = p1.data.parsedOriginal.meanings[1];
const m3 = p1.data.parsedOriginal.meanings[2];

console.log('  义项 1: pos=' + JSON.stringify(m1.pos) + ', meaning=' + JSON.stringify(m1.meaning));
console.log('    example=' + JSON.stringify(m1.example) + ', source=' + JSON.stringify(m1.source));
console.log('  义项 2: pos=' + JSON.stringify(m2.pos) + ', meaning=' + JSON.stringify(m2.meaning));
console.log('    example=' + JSON.stringify(m2.example) + ', source=' + JSON.stringify(m2.source));
console.log('  义项 3: pos=' + JSON.stringify(m3.pos) + ', meaning=' + JSON.stringify(m3.meaning));

if (!m1.pos || !m1.meaning || !m1.example || !m1.source) {
  console.error('  [FAIL] 义项 1 缺字段');
  process.exit(1);
}

console.log('  collectedAt:', p1.data.collectedAt);
console.log('  collectedAtShort:', p1.data.collectedAtShort);

if (!p1.data.collectedAtShort.includes('月') || !p1.data.collectedAtShort.includes('日')) {
  console.error('  [FAIL] collectedAtShort 格式不对');
  process.exit(1);
}

console.log('  [OK] 场景 1 通过');

// ============ 场景 2: 边界 - 非结构化输出（fallback 到 markdownToHtml）============
console.log('\n===== 场景 2: 非结构化输出（rich-text fallback）=====');
storageSvc.addCollection('之', '之乎者也，助词之常用者也。');
const p2 = makePage();
p2.onLoad({ word: '之' });
console.log('  parsedOriginal.meanings 数量:', p2.data.parsedOriginal ? p2.data.parsedOriginal.meanings.length : 'null');
console.log('  originalHtml 长度:', p2.data.originalHtml.length);

// 此场景 parseMarkdown 可能解析为 0 个义项（或空），让 WXML 走 fallback 渲染 rich-text
if (p2.data.parsedOriginal.meanings.length > 0) {
  console.log('  [WARN] 意外解析出义项，期望为空（fallback 路径）');
} else {
  console.log('  [OK] 0 个义项，WXML 会走 rich-text fallback');
}

// ============ 场景 3: 缺 time 字段（兼容旧数据）============
console.log('\n===== 场景 3: 旧数据无 time 字段 =====');
storage.collections = [{ word: '乎', result: '## 读音\nhū\n1. **【语气词】**助词', time: undefined }];
const p3 = makePage();
p3.onLoad({ word: '乎' });
console.log('  collectedAt:', JSON.stringify(p3.data.collectedAt));
console.log('  collectedAtShort:', JSON.stringify(p3.data.collectedAtShort));
// 应为空字符串（time 缺失时不显示）
if (p3.data.collectedAt !== '' || p3.data.collectedAtShort !== '') {
  console.error('  [FAIL] 缺 time 时应为空字符串');
  process.exit(1);
}
console.log('  [OK] 旧数据兼容');

// ============ 场景 4: URL 未解码的 word + 卡片渲染 ====================
console.log('\n===== 场景 4: 完整 bug 修复 + 卡片渲染 =====');
storageSvc.addCollection('古字通', '## 读音\ngǔ zì tōng\n1. **【应用名】**古字通小程序');
const p4 = makePage();
p4.onLoad({ word: '%E5%8F%A4%E5%AD%97%E9%80%9A' });  // URL 未解码
console.log('  word (decoded):', p4.data.word);
console.log('  parsedOriginal.pinyin:', p4.data.parsedOriginal.pinyin);
console.log('  parsedOriginal.meanings[0].meaning:', p4.data.parsedOriginal.meanings[0].meaning);
if (p4.data.word !== '古字通') {
  console.error('  [FAIL] URL 解码错误');
  process.exit(1);
}
if (p4.data.parsedOriginal.meanings.length === 0) {
  console.error('  [FAIL] 应有 1 个义项');
  process.exit(1);
}
console.log('  [OK] 场景 4 通过');

// ============ 场景 5: 流式累积解析（永不回退）============
console.log('\n===== 场景 5: 流式累积解析（与查词页一致）=====');
const page5 = makePage();
page5.setData({ parsedStreaming: null, displayParsed: null });

// 模拟流式：先收到部分
const partial1 = '## 读音\nhū\n1. **【语气词】**';
const parsed1 = markdownSvc.parseMarkdown(partial1);
const existing1 = page5.data.parsedStreaming || { pinyin: '', meanings: [] };
const final1 = (parsed1 && parsed1.meanings.length >= existing1.meanings.length) ? parsed1 : existing1;
page5.setData({ parsedStreaming: final1, displayParsed: final1 });
console.log('  流式 1: ' + partial1.length + ' 字符, meanings=' + page5.data.parsedStreaming.meanings.length);

// 继续接收
const partial2 = '## 读音\nhū\n1. **【语气词】**助词\n2. **【介词】**于';
const parsed2 = markdownSvc.parseMarkdown(partial2);
const existing2 = page5.data.parsedStreaming;
const final2 = (parsed2 && parsed2.meanings.length >= existing2.meanings.length) ? parsed2 : existing2;
page5.setData({ parsedStreaming: final2, displayParsed: final2 });
console.log('  流式 2: ' + partial2.length + ' 字符, meanings=' + page5.data.parsedStreaming.meanings.length);

if (page5.data.parsedStreaming.meanings.length !== 2) {
  console.error('  [FAIL] 流式累积应有 2 个义项');
  process.exit(1);
}
console.log('  [OK] 流式累积解析正常');

// ============ 场景 6: 验证 displayParsed 字段 ============
console.log('\n===== 场景 6: displayParsed 字段同步 =====');
storageSvc.addCollection('字通', sampleMarkdown);  // 独立 case，与之前解耦
const p6 = makePage();
p6.onLoad({ word: '字通' });
if (!p6.data.displayParsed || p6.data.displayParsed.meanings.length !== 3) {
  console.error('  [FAIL] displayParsed 未正确初始化');
  process.exit(1);
}
if (p6.data.displayParsed !== p6.data.parsedOriginal) {
  console.error('  [FAIL] displayParsed 应 === parsedOriginal');
  process.exit(1);
}
console.log('  [OK] displayParsed 正确指向 parsedOriginal，3 个义项');

console.log('\n===== 全部测试通过 =====');