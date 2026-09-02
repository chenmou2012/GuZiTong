// pages/review/review.js
// 多选题复习：两轮重做 + SM-2 评分映射
// UI 全面对齐 pages/learn/learn.js 的多选题交互
//
// 评分矩阵（与 scripts/test_review_multi.js TEST 5 同构）：
//   Round 1 答对 → sm2.recordReview(word, EASY=5)
//   Round 1 答错 → push 到 round2List，redoCount++
//   Round 2 答对 → sm2.recordReview(word, GOOD=3)
//   Round 2 答错 → sm2.recordReview(word, HARD=2)
//
// 出题策略：getOrGenerateMultiSelectQuestion 全覆盖 150 字（无 self 回退触发路径，
//          self 模式分支作为防御性代码保留以应对未来 QUIZ_DATA 变化）。

const storage = require('../../utils/services/storage.js');
const sm2 = require('../../utils/services/sm2.js');
const { REAL_WORDS_DATA } = require('../../utils/services/realWords.js');
const quiz = require('../../utils/services/quiz.js');
const QUIZ_DATA = require('../../utils/data/quiz_questions.js');

// 模块级缓存：distractorPool 一次性构建
// （参考 learn.js:14-20 _DISTRACTOR_POOL 模式）
let _DISTRACTOR_POOL = null;
function getDistractorPool() {
  if (!_DISTRACTOR_POOL) {
    _DISTRACTOR_POOL = REAL_WORDS_DATA.flatMap(w => (w.meanings || []).map(m => m.meaning));
  }
  return _DISTRACTOR_POOL;
}

Page({
  data: {
    statusBarHeight: 20,

    // 模式: 'multi' 多选题 / 'self' 自评（防御性，理论不触发）/ 'done' 完成
    mode: 'multi',

    // 两轮复习列表（[{ word, meanings, state }]）
    round1List: [],
    round2List: [],
    currentRound: 1,           // 1 | 2
    currentIndex: 0,
    redoCount: 0,              // 进入 round2 的字数量

    // 当前字
    currentWord: null,
    multiQuiz: null,           // quiz.js getOrGenerateMultiSelectQuestion 返回对象

    // 多选交互状态
    selectedIndexes: [],
    showResult: false,

    // self 模式私有字段（防御性，与 test_review_multi.js mock 契约一致）
    showMeaning: false,

    // 进度
    totalCount: 0,
    progressPercent: 0
  },

  onLoad: function() {
    try {
      this.setData({
        statusBarHeight: getApp().globalData.statusBarHeight
      });
      this.loadReviewWords();
    } catch (e) {
      // 静默兜底：loadReviewWords 内 getWordsToReview 可能因 sm2 异常失败
      console.error('[review.onLoad] failed:', e);
    }
  },

  onShow: function() {
    // 不重置 selectedIndexes：保留用户在切后台时的答题状态
  },

  // 加载需要复习的字 → 填 round1List
  loadReviewWords: function() {
    const allWords = REAL_WORDS_DATA || [];
    const meaningsByWord = {};
    allWords.forEach(w => { meaningsByWord[w.word] = w.meanings; });

    const due = sm2.getWordsToReview(Date.now(), meaningsByWord);

    this.setData({
      mode: due.length > 0 ? 'multi' : 'done',
      round1List: due,
      round2List: [],
      currentRound: 1,
      currentIndex: 0,
      redoCount: 0,
      totalCount: due.length,
      progressPercent: 0,
      selectedIndexes: [],
      showResult: false,
      showMeaning: false,
      currentWord: null,
      multiQuiz: null
    });

    if (due.length > 0) {
      this.startCurrentWord();
    }
  },

  getWordData: function(wordStr) {
    const allWords = REAL_WORDS_DATA || [];
    return allWords.find(w => w.word === wordStr) || { word: wordStr, meanings: [{ meaning: '' }] };
  },

  // 为当前字生成多选题 / 处理轮次切换 / 完成态
  startCurrentWord: function() {
    const { currentRound, currentIndex, round1List, round2List } = this.data;
    const list = currentRound === 1 ? round1List : round2List;

    // 当前轮已走完 → 切下一轮 或 完成
    if (currentIndex >= list.length) {
      if (currentRound === 1 && round2List.length > 0) {
        this.setData({
          currentRound: 2,
          currentIndex: 0,
          progressPercent: this.calcProgressPercent(0, 2)
        });
        return this.startCurrentWord();
      }
      // 全部完成
      this.setData({
        mode: 'done',
        currentWord: null,
        multiQuiz: null,
        progressPercent: 100
      });
      return;
    }

    const wordEntry = list[currentIndex];
    const wordData = this.getWordData(wordEntry.word);
    const wordMeanings = (wordData.meanings || []).map(m => m.meaning);
    const distractorPool = getDistractorPool();

    // 多选覆盖 150 字；防御性 fallback 保留 self 分支
    const multi = quiz.getOrGenerateMultiSelectQuestion(
      wordEntry.word, QUIZ_DATA, wordMeanings, distractorPool
    );

    if (multi) {
      // 重置 multi 内的 selectedIndexes/showResult/isCorrect（防止复用对象时残留旧状态）
      multi.selectedIndexes = [];
      multi.showResult = false;
      multi.isCorrect = false;
      multi.pendingNext = false;

      this.setData({
        mode: 'multi',
        currentWord: wordEntry,
        multiQuiz: multi,
        selectedIndexes: [],
        showResult: false,
        showMeaning: false,
        progressPercent: this.calcProgressPercent(currentIndex, currentRound)
      });
    } else {
      // 防御性：自评三档
      this.setData({
        mode: 'self',
        currentWord: wordEntry,
        multiQuiz: null,
        showMeaning: false,
        progressPercent: this.calcProgressPercent(currentIndex, currentRound)
      });
    }
  },

  // 进度百分比：(已完成题数 / 总题数) × 100
  // 完成 = round1 已走的 currentIndex + round2 已走的 currentIndex
  calcProgressPercent: function(currentIndexInRound, round) {
    const { round1List, round2List } = this.data;
    const total = round1List.length + round2List.length;
    if (total === 0) return 0;
    const done = (round === 1 ? currentIndexInRound : round1List.length) + (round === 2 ? currentIndexInRound : 0);
    return Math.round((done / total) * 100);
  },

  // 选项点击：切换选中（与 learn.js:522-534 同构）
  onSelectOption: function(e) {
    if (this.data.showResult) return;  // 已提交则不可改

    const idx = Number(e.currentTarget.dataset.index);
    const newSelected = quiz.toggleMultiOption(this.data.selectedIndexes, idx);

    // 同步更新 optionDisplays.selected（驱动 .selected CSS 类）
    const optionDisplays = this.data.multiQuiz.optionDisplays.map((opt, i) => ({
      ...opt,
      selected: newSelected.includes(i)
    }));

    this.setData({
      selectedIndexes: newSelected,
      'multiQuiz.optionDisplays': optionDisplays
    });
  },

  // 看答案：等同于答错
  giveUp: function() {
    if (this.data.showResult) return;

    // 标记所有正确选项为正确（高亮），用户未选项显示为 wrong
    const optionDisplays = this.data.multiQuiz.optionDisplays.map(opt => ({
      ...opt,
      // 不改变 selected 标记，让 WXML 用原 selected 标红
      correct: opt.correct  // 保持原值
    }));

    if (this.data.selectedIndexes.length === 0) {
      wx.vibrateLong({ success: () => {} });
    }

    this.setData({
      showResult: true,
      'multiQuiz.optionDisplays': optionDisplays,
      'multiQuiz.isCorrect': false  // 看答案 = 答错
    });
  },

  // 提交 / 下一词（首次点击提交，二次点击推进）
  nextQuestion: function() {
    const { showResult, selectedIndexes, multiQuiz } = this.data;

    if (!multiQuiz) return;

    // 首次点击：未提交 → 提交评分
    if (!showResult) {
      if (selectedIndexes.length === 0) {
        wx.showToast({ title: '请先选择', icon: 'none' });
        return;
      }

      const selectedTexts = selectedIndexes.map(i => multiQuiz.optionDisplays[i].text);
      const isCorrect = quiz.gradeMultiAnswer(multiQuiz.correctAnswers, selectedTexts);

      // 振动反馈（与 learn.js 一致）
      if (isCorrect) {
        wx.vibrateShort({ success: () => {} });
      } else {
        wx.vibrateLong({ success: () => {} });
      }

      this.setData({
        showResult: true,
        'multiQuiz.isCorrect': isCorrect
      });
      return;
    }

    // 二次点击：进入下一题（推进 round2 列表 + 记录）
    this.handleNext(multiQuiz.isCorrect === true);
  },

  // 处理答题结果：SM-2 评分映射 + 推进
  handleNext: function(wasCorrect) {
    const { currentRound, currentIndex, round1List, round2List } = this.data;
    const list = currentRound === 1 ? round1List : round2List;
    const wordEntry = list[currentIndex];
    if (!wordEntry) return;
    const word = wordEntry.word;

    if (currentRound === 1) {
      if (wasCorrect) {
        sm2.recordReview(word, sm2.QUALITY.EASY);
      } else {
        // push 到 round2List
        const newRound2 = round2List.concat([wordEntry]);
        const newRedoCount = this.data.redoCount + 1;
        // 总数变化（新增 round2 字数），重算百分比
        this.setData({
          round2List: newRound2,
          redoCount: newRedoCount,
          totalCount: round1List.length + newRound2.length
        });
      }
    } else {
      // round 2
      const quality = wasCorrect ? sm2.QUALITY.GOOD : sm2.QUALITY.HARD;
      sm2.recordReview(word, quality);
    }

    this.setData({ currentIndex: this.data.currentIndex + 1 });
    this.startCurrentWord();
  },

  // ==================== self 模式（防御性）====================
  // 实际不会触发（getOrGenerateMultiSelectQuestion 已覆盖 150 字），
  // 保留以应对未来 QUIZ_DATA 变化 / 缺题字场景。

  // 认识 (EASY, quality=5)
  markEasy: function() {
    const { currentWord } = this.data;
    if (!currentWord) return;
    sm2.recordReview(currentWord.word, sm2.QUALITY.EASY);
    this.nextWord();
  },

  // 模糊 (GOOD, quality=3)
  markGood: function() {
    const { currentWord } = this.data;
    if (!currentWord) return;
    sm2.recordReview(currentWord.word, sm2.QUALITY.GOOD);
    this.nextWord();
  },

  // 不认识 (HARD, quality=2)
  markHard: function() {
    const { currentWord } = this.data;
    if (!currentWord) return;

    if (!this.data.showMeaning) {
      this.setData({ showMeaning: true });
      return;
    }
    sm2.recordReview(currentWord.word, sm2.QUALITY.HARD);
    this.nextWord();
  },

  // self 模式推进
  nextWord: function() {
    const { round1List, round2List, currentRound, currentIndex } = this.data;
    const list = currentRound === 1 ? round1List : round2List;

    if (currentIndex >= list.length) {
      if (currentRound === 1 && round2List.length > 0) {
        this.setData({
          currentRound: 2,
          currentIndex: 0,
          showMeaning: false
        });
        return this.startCurrentWord();
      }
      this.setData({
        mode: 'done',
        currentWord: null,
        progressPercent: 100
      });
      return;
    }

    this.setData({ currentIndex: currentIndex + 1 });
    this.startCurrentWord();
  },

  // 返回主页
  goHome: function() {
    // 注意：不清理 learnProgress，那是 learn 页的存储，不属于 review
    wx.switchTab({ url: '/pages/learn/learn' });
  },

  // 退出复习（顶部 ✕ 按钮）
  exitReview: function() {
    wx.switchTab({ url: '/pages/learn/learn' });
  }
});
