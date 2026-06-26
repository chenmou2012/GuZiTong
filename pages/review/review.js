// pages/review/review.js
const storage = require('../../utils/services/storage.js');
const sm2 = require('../../utils/services/sm2.js');
const { REAL_WORDS_DATA } = require('../../utils/services/realWords.js');

Page({
  data: {
    statusBarHeight: 20,
    reviewWords: [],
    currentIndex: 0,
    showMeaning: false,
    currentWord: null,
    totalCount: 0,
    progressPercent: 0
  },

  onLoad: function(options) {
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight
    });
    this.loadReviewWords();
  },

  onShow: function() {
    if (this.data.currentWord) {
      this.setData({ showMeaning: false });
    }
  },

  // 加载需要复习的词
  loadReviewWords: function() {
    const allWords = REAL_WORDS_DATA || [];
    const meaningsByWord = {};
    allWords.forEach(w => { meaningsByWord[w.word] = w.meanings; });

    const due = sm2.getWordsToReview(Date.now(), meaningsByWord);

    this.setData({
      reviewWords: due,
      totalCount: due.length,
      currentIndex: 0,
      currentWord: due[0] || null,
      showMeaning: false,
      progressPercent: 0
    });
  },

  getWordData: function(wordStr) {
    const allWords = REAL_WORDS_DATA || [];
    return allWords.find(w => w.word === wordStr) || { word: wordStr, meanings: [{ meaning: '' }] };
  },

  // 认识 (EASY, quality=5) —— 完全掌握，加速间隔
  markEasy: function() {
    const { currentWord } = this.data;
    if (!currentWord) return;
    sm2.recordReview(currentWord.word, sm2.QUALITY.EASY);
    this.nextWord();
  },

  // 模糊 (GOOD, quality=4) —— 答对但迟疑，标准间隔
  markGood: function() {
    const { currentWord } = this.data;
    if (!currentWord) return;
    sm2.recordReview(currentWord.word, sm2.QUALITY.GOOD);
    this.nextWord();
  },

  // 不认识 (HARD, quality=2) —— 先显示意思，用户确认后再记录并进入下一词
  markHard: function() {
    const { currentWord } = this.data;
    if (!currentWord) return;

    if (!this.data.showMeaning) {
      // 第一次点击：仅显示意思，让用户对照后再决策
      this.setData({ showMeaning: true });
      return;
    }
    // 已显示意思后再次点击：记录 HARD 并进入下一词
    sm2.recordReview(currentWord.word, sm2.QUALITY.HARD);
    this.nextWord();
  },

  // 下一个词
  nextWord: function() {
    const { reviewWords, currentIndex, totalCount } = this.data;
    const nextIndex = currentIndex + 1;

    if (nextIndex >= reviewWords.length) {
      this.setData({
        currentIndex: nextIndex,
        currentWord: null,
        progressPercent: 100
      });
      return;
    }

    const nextWord = reviewWords[nextIndex];
    const percent = Math.round(((nextIndex + 1) / totalCount) * 100);

    this.setData({
      currentIndex: nextIndex,
      currentWord: nextWord,
      showMeaning: false,
      progressPercent: percent
    });
  },

  // 返回主页
  goHome: function() {
    wx.removeStorageSync('learnProgress');
    wx.switchTab({ url: '/pages/learn/learn' });
  },

  // 退出复习（不返回主页时使用，顶部 ✕ 按钮）
  exitReview: function() {
    wx.switchTab({ url: '/pages/learn/learn' });
  }
});