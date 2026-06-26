// pages/collections/collections.js
const storage = require('../../utils/services/storage');

Page({
  data: {
    collections: [],
    statusBarHeight: 20
  },

  onLoad: function() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
  },

  onShow: function() {
    this.refresh();
  },

  goBack: function() {
    wx.navigateBack();
  },

  refresh: function() {
    this.setData({ collections: storage.getCollections() });
  },

  onItemTap(e) {
    const { item } = e.detail;
    storage.setPendingQuery(item.word);
    wx.switchTab({ url: '/pages/index/index' });
  },

  onItemDelete(e) {
    const { item } = e.detail;
    storage.removeCollection(item.word);
    this.refresh();
    wx.showToast({ title: '已取消收藏', icon: 'none' });
  },

  onClearAll() {
    wx.showModal({
      title: '提示',
      content: '确定清空所有收藏？',
      success: (res) => {
        if (res.confirm) {
          // 逐条删除（storage 无 clearCollections，循环调用 removeCollection）
          const list = storage.getCollections();
          list.forEach(item => storage.removeCollection(item.word));
          this.refresh();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});