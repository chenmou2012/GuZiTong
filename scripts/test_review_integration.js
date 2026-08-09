// scripts/test_review_integration.js
// 集成测试：直接 mock Page 实例 + wx，验证 review.js 真实业务逻辑
// 与 test_review_multi.js 的区别：那个测试 mock 了 review 的核心循环，这个测试加载真实 review.js

const path = require('path');

// ==================== Mock 依赖 ====================
// 必须在 require review.js 之前设置

// 1. mock wx
const storage = {};
global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, val) => { storage[key] = val; },
  removeStorageSync: (key) => { delete storage[key]; },
  vibrateShort: (cb) => cb && cb.success && cb.success(),
  vibrateLong: (cb) => cb && cb.success && cb.success(),
  showModal: () => {},
  showToast: (opts) => { global.__lastToast = opts; },
  switchTab: () => {},
  navigateTo: () => {},
  loadFontFace: (opts) => { opts.success && opts.success(); }
};

// 2. mock getApp
global.getApp = () => ({
  globalData: { statusBarHeight: 20 }
});

// 3. mock sm2.recordReview（监听所有调用）
const reviewLog = [];
const sm2 = require('../utils/services/sm2.js');
const originalRecordReview = sm2.recordReview;
sm2.recordReview = function(word, quality) {
  reviewLog.push({ word: word, quality: quality });
};

// ==================== 加载 review.js ====================

let pageInstance = null;
let pageDataUpdateHandler = null;

// mock Page：捕获创建时传入的对象
const PageModule = require('module');
const originalRequire = PageModule.prototype.require;
const originalPage = global.Page;

global.Page = function(obj) {
  pageInstance = {
    data: obj.data,
    setData: function(newData) {
      // 小程序 setData 支持 'a.b.c': value 嵌套路径
      Object.keys(newData).forEach(key => {
        if (key.includes('.')) {
          const parts = key.split('.');
          let cur = this.data;
          for (let i = 0; i < parts.length - 1; i++) {
            cur = cur[parts[i]];
            if (!cur) return; // 路径不存在则跳过
          }
          cur[parts[parts.length - 1]] = newData[key];
        } else {
          this.data[key] = newData[key];
        }
      });
      if (pageDataUpdateHandler) pageDataUpdateHandler(this.data, newData);
    },
    // 复制所有方法
    ...obj
  };
  return pageInstance;
};

// 现在加载 review.js（会用 mock Page 创建实例）
require('../pages/review/review.js');

// ==================== 辅助函数 ====================

function resetState() {
  reviewLog.length = 0;
  pageInstance.data = {
    statusBarHeight: 20,
    mode: 'multi',
    round1List: [],
    round2List: [],
    currentRound: 1,
    currentIndex: 0,
    redoCount: 0,
    currentWord: null,
    multiQuiz: null,
    selectedIndexes: [],
    showResult: false,
    showMeaning: false,
    totalCount: 0,
    progressPercent: 0
  };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('❌ ' + msg);
    process.exit(1);
  }
}

// 注入 round1List 并启动第一个字
function startWithWords(words) {
  resetState();
  pageInstance.data.round1List = words.map(w => ({ word: w, meanings: [] }));
  pageInstance.data.totalCount = words.length;
  pageInstance.data.mode = 'multi';
  pageInstance.startCurrentWord();
}

// ==================== TEST 1: 加载 + 出题 ====================
console.log('===== TEST 1: loadReviewWords + startCurrentWord 出题 =====');
{
  // 直接调用 loadReviewWords（会从 REAL_WORDS_DATA 拿到期字）
  pageInstance.loadReviewWords();
  // 没到期字时直接 done 态
  if (pageInstance.data.mode === 'done') {
    console.log('  无到期字 → done 态 ✓');
  } else {
    // 有到期字 → multi 模式
    assert(pageInstance.data.mode === 'multi', '应为 multi 模式');
    assert(pageInstance.data.currentWord !== null, 'currentWord 不应为空');
    assert(pageInstance.data.multiQuiz !== null, 'multiQuiz 不应为空');
    assert(Array.isArray(pageInstance.data.multiQuiz.optionDisplays), 'optionDisplays 应为数组');
    assert(pageInstance.data.multiQuiz.optionDisplays.length >= 2, '至少 2 个选项');
    console.log(`  mode=${pageInstance.data.mode}, 当前字=${pageInstance.data.currentWord.word}, 选项=${pageInstance.data.multiQuiz.optionDisplays.length} ✓`);
  }
}

// ==================== TEST 2: 选项切换 ====================
console.log('\n===== TEST 2: onSelectOption 切换选中 =====');
{
  startWithWords(['比']);

  const before = pageInstance.data.selectedIndexes.length;
  pageInstance.onSelectOption({ currentTarget: { dataset: { index: 0 } } });
  assert(pageInstance.data.selectedIndexes.length === before + 1, '点击应增加选中');

  // 再次点击同一项：取消选中
  pageInstance.onSelectOption({ currentTarget: { dataset: { index: 0 } } });
  assert(pageInstance.data.selectedIndexes.length === before, '再次点击应取消');

  console.log('  切换/取消选中 ✓');
}

// ==================== TEST 3: 答对流程（round1 → EASY）====================
console.log('\n===== TEST 3: round1 答对 → EASY =====');
{
  startWithWords(['比']);

  // 模拟答对：选中所有正确项
  const correctIdxs = pageInstance.data.multiQuiz.correctIndexes;
  pageInstance.data.selectedIndexes = [...correctIdxs];

  // 同步 optionDisplays.selected（review.js 的 onSelectOption 会自动同步，但直接 setData 跳过）
  pageInstance.data.multiQuiz.optionDisplays.forEach((opt, i) => {
    opt.selected = correctIdxs.includes(i);
  });

  pageInstance.nextQuestion();  // 第一次：提交评分

  assert(pageInstance.data.showResult === true, '提交后 showResult 应为 true');
  assert(pageInstance.data.multiQuiz.isCorrect === true, '答对 isCorrect 应为 true');

  pageInstance.nextQuestion();  // 第二次：进入下一题

  // 单字流程：完成态
  assert(pageInstance.data.mode === 'done', '单字完成后应进 done 态');
  assert(reviewLog.length === 1, '应有 1 条 review 记录');
  assert(reviewLog[0].word === '比', '记录的字应为 比');
  assert(reviewLog[0].quality === 5, 'EASY = 5');
  assert(pageInstance.data.round2List.length === 0, '答对不应入 round2');

  console.log(`  reviewLog = [${JSON.stringify(reviewLog[0])}] ✓`);
  console.log(`  round2List 长度 = 0 ✓`);
}

// ==================== TEST 4: 答错流程（round1 → round2）====================
console.log('\n===== TEST 4: round1 答错 → round2，round2 答对 → GOOD =====');
{
  startWithWords(['比', '鄙']);

  // 第一个字 比：给错选项（选非正确项）
  const wrongIdxs = pageInstance.data.multiQuiz.optionDisplays
    .map((_, i) => i)
    .filter(i => !pageInstance.data.multiQuiz.correctIndexes.includes(i))
    .slice(0, 1);  // 选 1 个错的（必错）
  pageInstance.data.selectedIndexes = [...wrongIdxs];
  pageInstance.data.multiQuiz.optionDisplays.forEach((opt, i) => {
    opt.selected = wrongIdxs.includes(i);
  });
  pageInstance.nextQuestion();  // 提交
  assert(pageInstance.data.showResult === true, '提交后 showResult');
  assert(pageInstance.data.multiQuiz.isCorrect === false, '答错');
  pageInstance.nextQuestion();  // 推进

  // round1 第二个字 鄙：给错选项
  const wrongIdxs2 = pageInstance.data.multiQuiz.optionDisplays
    .map((_, i) => i)
    .filter(i => !pageInstance.data.multiQuiz.correctIndexes.includes(i))
    .slice(0, 1);
  pageInstance.data.selectedIndexes = [...wrongIdxs2];
  pageInstance.data.multiQuiz.optionDisplays.forEach((opt, i) => {
    opt.selected = wrongIdxs2.includes(i);
  });
  pageInstance.nextQuestion();  // 提交
  pageInstance.nextQuestion();  // 推进

  // 此时应进入 round 2
  assert(pageInstance.data.currentRound === 2, '应进入 round 2');
  assert(pageInstance.data.round2List.length === 2, 'round2 应有 2 个字');
  assert(pageInstance.data.redoCount === 2, 'redoCount 应为 2');
  assert(pageInstance.data.currentWord.word === '比', 'round2 第一个应是 比');

  console.log(`  round2List 长度 = ${pageInstance.data.round2List.length}, redoCount = ${pageInstance.data.redoCount} ✓`);

  // round2 第一个字 比：答对 → GOOD
  const correctIdxs = pageInstance.data.multiQuiz.correctIndexes;
  pageInstance.data.selectedIndexes = [...correctIdxs];
  pageInstance.data.multiQuiz.optionDisplays.forEach((opt, i) => {
    opt.selected = correctIdxs.includes(i);
  });
  pageInstance.nextQuestion();  // 提交
  assert(pageInstance.data.multiQuiz.isCorrect === true, 'round2 答对');
  pageInstance.nextQuestion();  // 推进

  // round2 第二个字 鄙：给错选项 → HARD
  const wrongIdxs3 = pageInstance.data.multiQuiz.optionDisplays
    .map((_, i) => i)
    .filter(i => !pageInstance.data.multiQuiz.correctIndexes.includes(i))
    .slice(0, 1);
  pageInstance.data.selectedIndexes = [...wrongIdxs3];
  pageInstance.data.multiQuiz.optionDisplays.forEach((opt, i) => {
    opt.selected = wrongIdxs3.includes(i);
  });
  pageInstance.nextQuestion();  // 提交
  pageInstance.nextQuestion();  // 推进

  // 完成
  assert(pageInstance.data.mode === 'done', '应进入 done');

  // 验证 reviewLog: round1 答错不入 log，round2 答对 = GOOD，round2 答错 = HARD
  assert(reviewLog.length === 2, `应有 2 条 review, 实际 ${reviewLog.length}`);
  assert(reviewLog[0].quality === 3, '比 round2 答对 → GOOD(3)');
  assert(reviewLog[0].word === '比', '第一个是 比');
  assert(reviewLog[1].quality === 2, '鄙 round2 答错 → HARD(2)');
  assert(reviewLog[1].word === '鄙', '第二个是 鄙');

  console.log(`  reviewLog = [${JSON.stringify(reviewLog)}] ✓`);
}

// ==================== TEST 5: 看答案 ====================
console.log('\n===== TEST 5: giveUp 看答案 =====');
{
  startWithWords(['比']);

  pageInstance.giveUp();
  assert(pageInstance.data.showResult === true, '看答案后 showResult');
  assert(pageInstance.data.multiQuiz.isCorrect === false, '看答案视为答错');

  // 提交后选项仍可看到对错状态（这里只验证状态，不继续走完整流程）
  console.log('  giveUp → showResult=true, isCorrect=false ✓');

  // 继续走完流程：推进到 round2，再答对 → 应有 2 条 reviewLog
  pageInstance.nextQuestion();  // 推进到 round2（push 到 round2List）
  assert(pageInstance.data.currentRound === 2, 'giveUp 后应进入 round2');
  assert(pageInstance.data.round2List.length === 1, 'round2 应有 1 个字');

  // round2 答对 → GOOD
  const correctIdxs = pageInstance.data.multiQuiz.correctIndexes;
  pageInstance.data.selectedIndexes = [...correctIdxs];
  pageInstance.data.multiQuiz.optionDisplays.forEach((opt, i) => {
    opt.selected = correctIdxs.includes(i);
  });
  pageInstance.nextQuestion();  // 提交
  assert(pageInstance.data.multiQuiz.isCorrect === true, 'round2 答对');
  pageInstance.nextQuestion();  // 推进

  assert(pageInstance.data.mode === 'done', '完成');
  assert(reviewLog.length === 1, 'round1 看答案不入 log，round2 答对 → 1 条记录');
  assert(reviewLog[0].quality === 3, 'round2 答对 → GOOD(3)');

  console.log('  giveUp → round1 不入 log, round2 答对 → GOOD(3) ✓');
}

// ==================== TEST 6: 不能重复选 / 提交后不可改 ====================
console.log('\n===== TEST 6: showResult 后点击选项无效 =====');
{
  startWithWords(['比']);

  pageInstance.data.selectedIndexes = [...pageInstance.data.multiQuiz.correctIndexes];
  pageInstance.data.multiQuiz.optionDisplays.forEach((opt, i) => {
    opt.selected = pageInstance.data.multiQuiz.correctIndexes.includes(i);
  });
  pageInstance.nextQuestion();  // 提交
  assert(pageInstance.data.showResult === true, '已提交');

  const lenBefore = pageInstance.data.selectedIndexes.length;
  pageInstance.onSelectOption({ currentTarget: { dataset: { index: 0 } } });
  assert(pageInstance.data.selectedIndexes.length === lenBefore, '提交后点击不应改变 selectedIndexes');

  console.log('  提交后点击无效 ✓');
}

// ==================== TEST 7: 全 EASY 不进 round2 ====================
console.log('\n===== TEST 7: 全 EASY 不进 round2 =====');
{
  startWithWords(['比', '鄙', '兵']);

  for (let i = 0; i < 3; i++) {
    pageInstance.data.selectedIndexes = [...pageInstance.data.multiQuiz.correctIndexes];
    pageInstance.data.multiQuiz.optionDisplays.forEach((opt, idx) => {
      opt.selected = pageInstance.data.multiQuiz.correctIndexes.includes(idx);
    });
    pageInstance.nextQuestion();  // 提交
    pageInstance.nextQuestion();  // 推进
  }

  assert(pageInstance.data.mode === 'done', '完成');
  assert(pageInstance.data.round2List.length === 0, 'round2 应为空');
  assert(pageInstance.data.redoCount === 0, 'redoCount 应为 0');
  assert(reviewLog.length === 3, '应有 3 条 review');
  assert(reviewLog.every(r => r.quality === 5), '全部 EASY');

  console.log(`  reviewLog 长度 = ${reviewLog.length}, 全 EASY ✓`);
}

console.log('\n===== 总结 =====');
console.log('review.js 集成测试 7 项全部通过：出题、选项切换、答对/答错、看答案、提交后不可改、全 EASY。');