// pages/review/review.js
const storage = require('../../utils/services/storage.js');
const { REAL_WORDS_DATA } = require('../../utils/services/realWords.js');
const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30]; // 艾宾浩斯间隔（天）

Page({
  data: {
    statusBarHeight: 20,
    reviewWords: [],
    currentIndex: 0,
    showMeaning: false,
    currentWord: null,
    totalCount: 0
  },

  onLoad: function(options) {
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight
    });
    this.loadReviewWords();
  },

  onShow: function() {
    // 只刷新统计，不重新加载列表
    const { reviewWords, currentIndex, currentWord } = this.data;
    if (currentWord) {
      this.setData({
        showMeaning: false
      });
    }
  },

  // 加载需要复习的词
  loadReviewWords: function() {
    const learned = storage.getLearnedWords() || [];
    const reviewWords = this.calculateReview(learned);
    const allWords = REAL_WORDS_DATA || [];

    // 获取每个词的详细数据
    const reviewWordsWithMeanings = reviewWords.map(w => {
      const wordData = allWords.find(a => a.word === w.word);
      return {
        ...w,
        meanings: wordData ? wordData.meanings : [{ meaning: '' }]
      };
    });

    const percent = reviewWordsWithMeanings.length > 0 ? Math.round((1 / reviewWordsWithMeanings.length) * 100) : 0;
    this.setData({
      reviewWords: reviewWordsWithMeanings,
      totalCount: reviewWordsWithMeanings.length,
      currentIndex: 0,
      currentWord: reviewWordsWithMeanings[0] || null,
      showMeaning: false,
      progressPercent: percent
    });
  },

  // 计算需要复习的词（根据艾宾浩斯遗忘曲线）- 与 learn.js 保持一致
  calculateReview: function(learned) {
    const now = Date.now();
    const result = [];
    const intervals = [1, 2, 4, 7, 15, 30];  // 天数
    const learnList = storage.getLearnList() || [];

    // 只复习 learnList 中学过的词
    const learnedWords = new Set(learned.map(l => l.word));

    learnList.forEach(w => {
      if (!learnedWords.has(w.word)) return;

      const lastReview = storage.getLastReviewTime(w.word) || w.learnedTime || 0;
      const errorCount = storage.getErrorCount(w.word) || 0;
      const reviewCount = w.reviewCount || 0;

      // 根据错误次数增加复习频率
      const baseInterval = intervals[Math.min(reviewCount, intervals.length - 1)];
      const interval = baseInterval * 24 * 60 * 60 * 1000 * (errorCount > 2 ? 0.5 : 1);

      if (now - lastReview >= interval) {
        result.push({ word: w.word, times: reviewCount, errors: errorCount });
      }
    });

    return result;
  },

  // 获取词的详细数据
  getWordData: function(wordStr) {
    const allWords = REAL_WORDS_DATA || [];
    return allWords.find(w => w.word === wordStr) || { word: wordStr, meanings: [{ meaning: '' }] };
  },

  // 认识
  markKnown: function() {
    const { reviewWords, currentIndex, currentWord } = this.data;
    if (!currentWord) return;

    // 更新复习统计 - 认识
    storage.updateReviewStats(true, currentWord.word);
    storage.addReviewHistory(1);

    this.nextWord();
  },

  // 不认识
  markUnknown: function() {
    const { reviewWords, currentIndex, currentWord } = this.data;
    if (!currentWord) return;

    // 显示意思
    this.setData({ showMeaning: true });

    // 更新复习统计 - 不认识（把复习流程返回上一轮）
    storage.updateReviewStats(false, currentWord.word);
    storage.resetErrorCount(currentWord.word);
  },

  // 下一个词
  nextWord: function() {
    const { reviewWords, currentIndex, totalCount } = this.data;
    const nextIndex = currentIndex + 1;

    if (nextIndex >= reviewWords.length) {
      // 复习完成
      this.setData({
        currentIndex: nextIndex,
        currentWord: null,
        progressPercent: 100
      });
      return;
    }

    const nextWord = reviewWords[nextIndex];
    const wordData = this.getWordData(nextWord.word);
    const percent = Math.round(((nextIndex + 1) / totalCount) * 100);

    this.setData({
      currentIndex: nextIndex,
      currentWord: { ...nextWord, meanings: wordData.meanings },
      showMeaning: false,
      progressPercent: percent
    });
  },

  // 返回主页
  goHome: function() {
    wx.switchTab({ url: '/pages/learn/learn' });
  }
});