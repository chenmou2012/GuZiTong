// scripts/test_sm2_batch.js
// 回归测试（P0）：SM-2 同 tick 批量写入不丢数据。
// 之前 markWordLearned/recordReview 把「读快照 + 落盘 + 同步」整体入队，
// 同一 tick 多次调用各自读到旧快照，后面的写覆盖前面的 → 批量只剩最后一个字。
// 修复后：本地同步落盘，队列只负责网络同步。

const store = {};
// 模拟微信 storage 的深拷贝语义（getStorageSync 每次返回独立对象）
const deepClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

global.wx = {
  getStorageSync: (key) => deepClone(store[key]),
  setStorageSync: (key, val) => { store[key] = deepClone(val); },
  removeStorageSync: (key) => { delete store[key]; }
};
global.getApp = () => ({ globalData: {} });

const sm2 = require('../utils/services/sm2.js');

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ❌ ' + msg);
  }
}

(async function main() {
  console.log('===== TEST 1: 同 tick 批量 markWordLearned 不丢字 =====');
  const words = ['甲', '乙', '丙', '丁', '戊'];
  words.forEach(w => sm2.markWordLearned(w));

  const all = sm2.getAllWordStates();
  assert(Object.keys(all).length === 5, `5 个字全部落盘 (实际 ${Object.keys(all).length})`);
  assert(words.every(w => all[w] && all[w].word === w), '每个字都有状态');

  const stats = sm2.getEbbinghausStats();
  assert(stats.todayLearn === 5, `todayLearn = 5 (实际 ${stats.todayLearn})`);

  console.log('\n===== TEST 2: 同 tick 批量 recordReview 不丢字 =====');
  sm2.recordReview('子', sm2.QUALITY.GOOD);
  sm2.recordReview('丑', sm2.QUALITY.GOOD);

  const all2 = sm2.getAllWordStates();
  assert(all2['子'] && all2['子'].repetition === 1, '子 已复习 (repetition=1)');
  assert(all2['丑'] && all2['丑'].repetition === 1, '丑 已复习 (repetition=1)');

  const stats2 = sm2.getEbbinghausStats();
  assert(stats2.todayReview === 2, `todayReview = 2 (实际 ${stats2.todayReview})`);

  console.log('\n===== TEST 3: markWordLearned 幂等 =====');
  sm2.markWordLearned('甲');
  // 5 个批量字 + 子/丑 两条复习 = 7；重复标记甲 不应新增第 8 个
  assert(Object.keys(sm2.getAllWordStates()).length === 7, '重复标记不增加字');
  const stats3 = sm2.getEbbinghausStats();
  assert(stats3.todayLearn === 5, 'todayLearn 不重复累加');

  console.log('\n===== TEST 4: mergeWordStates 按最后复习时间合并 =====');
  const older = { 甲: { word: '甲', lastReviewedAt: 100, learnedAt: 100 } };
  const newer = {
    甲: { word: '甲', lastReviewedAt: 200, learnedAt: 200 },
    乙: { word: '乙', lastReviewedAt: 300, learnedAt: 300 }
  };
  const merged = sm2.mergeWordStates(older, newer);
  assert(merged['甲'].lastReviewedAt === 200, '较新的一方胜出');
  assert(merged['乙'].word === '乙', '单边存在的字被合并保留');

  console.log('\n===== TEST 5: mergeReviewStats 逐项取较大值 =====');
  const ms = sm2.mergeReviewStats(
    { todayLearn: 3, totalCorrect: 5, totalWrong: 1 },
    { todayLearn: 1, totalCorrect: 8, totalWrong: 2 }
  );
  assert(ms.todayLearn === 3 && ms.totalCorrect === 8 && ms.totalWrong === 2, '任一边进度不丢失');

  console.log('\n===== TEST 6: pushToServer 可用并序列化 =====');
  const p = sm2.pushToServer();
  assert(p && typeof p.then === 'function', 'pushToServer 返回 Promise');
  await p;

  console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
})();
