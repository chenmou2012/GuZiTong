// pages/translations/translations.js
const storage = require('../../utils/services/storage');

Page({
  data: {
    translations: [],
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
    this.setData({ translations: storage.getTranslations() });
  },

  onItemTap(e) {
    const { item } = e.detail;
    storage.setPendingTranslation(item.original);
    wx.switchTab({ url: '/pages/translate/translate' });
  },

  onItemDelete(e) {
    const { item } = e.detail;
    storage.removeTranslation(item.original);
    this.refresh();
    wx.showToast({ title: '已删除', icon: 'none' });
  },

  onClearAll() {
    wx.showModal({
      title: '提示',
      content: '确定清空所有翻译历史？',
      success: (res) => {
        if (res.confirm) {
          storage.clearTranslations();
          this.refresh();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});