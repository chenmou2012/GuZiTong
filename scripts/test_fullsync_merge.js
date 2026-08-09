// scripts/test_fullsync_merge.js
// 回归测试：fullSync 必须「先拉取合并、再推送」，防止两类数据丢失：
// 1) 新设备（本地为空）同步时把云端 collections/history 覆盖成空；
// 2) 离线期间本地较新的 wordStates 被旧云端数据覆盖。

const store = {};
const deepClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

global.wx = {
  getStorageSync: (key) => deepClone(store[key]),
  setStorageSync: (key, val) => { store[key] = deepClone(val); },
  removeStorageSync: (key) => { delete store[key]; }
};
global.getApp = () => ({ globalData: {} });
global.Page = (config) => config;

// 先加载 auth，再替换其网络函数（storage/sm2 内部是运行时属性访问，patch 生效）
const auth = require('../utils/services/auth.js');
const storageSvc = require('../utils/services/storage.js');
const sm2 = require('../utils/services/sm2.js');

let cloud = { learn: {}, search: {} };
let pushLog = [];

auth.checkLogin = () => true;
auth.getToken = () => 'mock_token';
auth.getUserData = async (dataType) => deepClone(cloud[dataType] || {});
auth.saveUserData = async (dataType, dataKey, dataValue) => {
  pushLog.push({ dataType, dataKey, value: deepClone(dataValue) });
  cloud[dataType] = cloud[dataType] || {};
  cloud[dataType][dataKey] = deepClone(dataValue);
  return true;
};

function reset(seed) {
  cloud = { learn: {}, search: {} };
  if (seed) {
    if (seed.collections) cloud.learn.collections = seed.collections;
    if (seed.history) cloud.search.history = seed.history;
    if (seed.wordStates) cloud.learn.wordStates = seed.wordStates;
    if (seed.reviewStats) cloud.learn.reviewStats = seed.reviewStats;
  }
  pushLog = [];
  Object.keys(store).forEach(k => delete store[k]);
}

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ❌ ' + msg);
  }
}

function pushed(dataType, dataKey) {
  return pushLog.find(p => p.dataType === dataType && p.dataKey === dataKey);
}

(async function main() {
  console.log('===== TEST 1: 新设备（本地空）同步不丢云端数据 =====');
  reset({
    collections: [{ word: '比', time: 111 }],
    history: [{ word: '为', time: 222 }],
    wordStates: { 比: { word: '比', lastReviewedAt: 333, learnedAt: 333 } },
    // lastReviewDate 必须是今天，否则展示时会被 rollDailyStats 跨天重置
    reviewStats: { todayLearn: 4, lastReviewDate: new Date().toLocaleDateString('zh-CN') }
  });
  await storageSvc.fullSync();

  assert(storageSvc.getCollections().length === 1, '收藏已合并到本地');
  assert(storageSvc.getHistory().length === 1, '历史已合并到本地');
  assert(sm2.getWordState('比') !== null, 'wordStates 已合并到本地');
  assert(sm2.getEbbinghausStats().todayLearn === 4, 'reviewStats 已合并到本地');

  const collectionsPush = pushed('learn', 'collections');
  const historyPush = pushed('search', 'history');
  const wordStatesPush = pushed('learn', 'wordStates');
  assert(collectionsPush && collectionsPush.value.length === 1, '合并后推送云端（收藏非空）');
  assert(historyPush && historyPush.value.length === 1, '合并后推送云端（历史非空）');
  assert(wordStatesPush && wordStatesPush.value['比'], '合并后推送云端（wordStates 非空）');

  console.log('\n===== TEST 2: 离线复习数据不被旧云端覆盖 =====');
  // 云端只有旧记录；本地有更新的 learnedAt
  reset({
    wordStates: { 比: { word: '比', lastReviewedAt: 100, learnedAt: 100 } },
    reviewStats: { todayLearn: 1 }
  });
  sm2.markWordLearned('比');
  const localLearnedAt = sm2.getWordState('比').learnedAt;
  assert(localLearnedAt > 100, '本地数据确实更新（learnedAt > 100）');

  await storageSvc.fullSync();

  const after = sm2.getWordState('比');
  assert(after && after.learnedAt === localLearnedAt, '本地较新数据保留');
  const wsPush = pushed('learn', 'wordStates');
  assert(wsPush && wsPush.value['比'] && wsPush.value['比'].learnedAt === localLearnedAt, '合并结果推回云端');

  console.log('\n===== TEST 3: 双端各有独有收藏时合并保留 =====');
  reset({
    collections: [{ word: '云端独有', time: 500 }],
    history: []
  });
  // 直接写本地（不经过 toggleCollection，避免其 fire-and-forget 同步先覆盖云端）
  store['collections'] = [{ word: '本地独有', time: 999 }];
  await storageSvc.fullSync();
  const words = storageSvc.getCollections().map(c => c.word).sort();
  assert(words.join(',') === '云端独有,本地独有', `两边收藏都保留 (实际 ${words.join(',')})`);
  const cPush = pushed('learn', 'collections');
  assert(cPush && cPush.value.length === 2, '合并后云端也有两条');

  console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
})();
