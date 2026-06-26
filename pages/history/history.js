// pages/history/history.js
const storage = require('../../utils/services/storage');

Page({
  data: {
    history: [],
    statusBarHeight: 20
  },

  onLoad: function() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
  },

  onShow: function() {
    this.refresh();
  },

  refresh: function() {
    this.setData({ history: storage.getHistory() });
  },

  onItemTap(e) {
    const { item } = e.detail;
    storage.setPendingQuery(item.word);
    wx.switchTab({ url: '/pages/index/index' });
  },

  onItemDelete(e) {
    const { item } = e.detail;
    storage.removeHistory(item.word);
    this.refresh();
    wx.showToast({ title: '已删除', icon: 'none' });
  },

  onClearAll() {
    wx.showModal({
      title: '提示',
      content: '确定清空所有学习记录？',
      success: (res) => {
        if (res.confirm) {
          storage.clearHistory();
          this.refresh();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});