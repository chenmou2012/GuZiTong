// pages/groupdone/groupdone.js
Page({
  data: {
    statusBarHeight: 20,
    groupIndex: 0,
    totalGroups: 0,
    learnedCount: 0
  },

  onLoad: function(options) {
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight,
      groupIndex: parseInt(options.groupIndex || 0) + 1,
      totalGroups: parseInt(options.totalGroups || 0),
      learnedCount: parseInt(options.count || 0)
    });
  },

  // 继续下一组：告诉 learn "直接开始下一组"，然后 navigateBack
  continueNext: function() {
    const app = getApp();
    app.globalData = app.globalData || {};
    // groupdone 的 groupIndex 是 1-based（已完成那一组），learn 内部要 0-based
    app.globalData.pendingContinue = {
      action: 'next',
      groupIndex: this.data.groupIndex - 1
    };
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