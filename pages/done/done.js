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

  // 继续学习：全部学完后再来一轮（重新洗牌所有 150 字）
  continueLearn: function() {
    const app = getApp();
    app.globalData = app.globalData || {};
    app.globalData.pendingContinue = { action: 'restart' };
    wx.navigateBack();
  }
});