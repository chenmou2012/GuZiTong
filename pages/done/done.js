// pages/done/done.js
Page({
  data: {
    statusBarHeight: 20,
    learnedCount: 0
  },

  onLoad: function(options) {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
    if (options.count) {
      this.setData({ learnedCount: parseInt(options.count) });
    }
  },

  goHome: function() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  continueLearn: function() {
    wx.navigateBack();
  }
});