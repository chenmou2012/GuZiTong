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
    const list = storage.getCollections().map(item => ({
      ...item,
      _key: item.word,
      // 列表只渲染预览，完整结果在收藏详情页从 storage 读取
      result: storage.previewText(item.result)
    }));
    this.setData({ collections: list });
  },

  onItemTap(e) {
    const { item } = e.detail;
    wx.navigateTo({
      url: '/pages/collection-detail/collection-detail?word=' + encodeURIComponent(item.word)
    });
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
          storage.clearCollections();
          this.refresh();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});
