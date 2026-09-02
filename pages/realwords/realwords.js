// pages/realwords/realwords.js
const constants = require('../../utils/services/constants');
const storage = require('../../utils/services/storage');

const { REAL_WORDS } = constants;
const PAGE_SIZE = 60;  // 每批渲染的字数，避免 459 个节点一次性铺开

Page({
  data: {
    realWords: REAL_WORDS,
    visibleWords: [],
    visibleCount: PAGE_SIZE,
    statusBarHeight: 20
  },

  onLoad: function() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
    this.applyVisible();
  },

  // 按当前 visibleCount 切片渲染
  applyVisible: function() {
    this.setData({
      visibleWords: this.data.realWords.slice(0, this.data.visibleCount)
    });
  },

  // 滚到底部时追加下一批
  onReachBottom: function() {
    const next = this.data.visibleCount + PAGE_SIZE;
    if (next <= this.data.visibleCount) return;  // 已全部渲染
    this.setData({ visibleCount: next }, () => this.applyVisible());
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
