// pages/review/review.js
const storage = require('../../utils/services/storage.js');
const { REAL_WORDS_DATA } = require('../../utils/services/realWords.js');

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
    const reviewWords = storage.calculateReview(learned);
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
    wx.removeStorageSync('learnProgress');
    wx.switchTab({ url: '/pages/learn/learn' });
  }
});