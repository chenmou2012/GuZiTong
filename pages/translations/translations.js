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
    // 缓存对象只读一次，避免逐条 getStorageSync + JSON 解析
    const cache = storage.getTranslationCache();
    const list = storage.getTranslations().map(item => ({
      ...item,
      _key: item.original,
      // 列表只渲染预览，完整译文在翻译详情页从 storage 读取
      translated: storage.previewText(item.translated),
      fromCache: cache[item.original] ? '已缓存' : ''
    }));
    this.setData({ translations: list });
  },

  onItemTap(e) {
    const { item } = e.detail;
    // 跳翻译详情页（与查词收藏 collection-detail 镜像）
    const encoded = encodeURIComponent(item.original);
    wx.navigateTo({ url: '/pages/translation-detail/translation-detail?original=' + encoded });
  },

  // "重译"操作：清掉这条的缓存，再跳转翻译页，下次会强制调 AI
  onItemAction(e) {
    const { item } = e.detail;
    storage.invalidateCachedTranslation(item.original);
    storage.setPendingTranslation(item.original);
    wx.switchTab({ url: '/pages/translate/translate' });
    wx.showToast({ title: '将重新翻译', icon: 'none', duration: 1500 });
  },

  onItemDelete(e) {
    const { item } = e.detail;
    // 删历史时同步删缓存（避免下次同原文查词时被旧缓存命中）
    storage.invalidateCachedTranslation(item.original);
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
          // 清空翻译历史时同步清空翻译缓存（单次落盘 + 单次同步）
          storage.clearTranslationCache();
          storage.clearTranslations();
          this.refresh();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});
