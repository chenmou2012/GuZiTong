// pages/realwords/realwords.js
const constants = require('../../utils/services/constants');
const storage = require('../../utils/services/storage');

const { REAL_WORDS } = constants;

Page({
  data: {
    realWords: REAL_WORDS,
    filteredWords: REAL_WORDS,
    statusBarHeight: 20
  },

  onLoad: function() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
  },

  goBack: function() {
    wx.navigateBack();
  },

  // 点击实词：保存待查词，切换到查词页自动查询
  onWordTap: function(e) {
    const word = e.currentTarget.dataset.word;
    storage.setPendingQuery(word);
    wx.switchTab({
      url: '/pages/index/index'
    });
  }
});