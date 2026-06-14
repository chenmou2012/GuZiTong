// pages/groupdone/groupdone.js
Page({
  data: {
    statusBarHeight: 20,
    groupIndex: 0,
    learnedCount: 0
  },

  onLoad: function(options) {
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight,
      groupIndex: parseInt(options.groupIndex || 0) + 1,
      learnedCount: parseInt(options.count || 0)
    });
  },

  // 继续下一组
  continueNext: function() {
    wx.navigateBack();
  },

  // 返回主页
  goHome: function() {
    // 清除学习进度
    wx.removeStorageSync('learnProgress');
    // 强制重置全局状态
    const app = getApp();
    app.globalData = app.globalData || {};
    app.globalData.learning = false;
    // 跳转到学习页面
    wx.switchTab({ url: '/pages/learn/learn' });
  }
});