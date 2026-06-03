// pages/profile/profile.js
Page({
  data: {
    stats: {
      words: 0,
      collections: 0,
      translations: 0
    }
  },

  onLoad: function() {
    this.loadStats();
  },

  onShow: function() {
    this.loadStats();
  },

  loadStats: function() {
    const history = wx.getStorageSync('searchHistory') || [];
    const collections = wx.getStorageSync('collections') || [];
    const translations = wx.getStorageSync('translations') || [];

    this.setData({
      stats: {
        words: history.length,
        collections: collections.length,
        translations: translations.length
      }
    });
  },

  viewHistory: function() {
    const history = wx.getStorageSync('searchHistory') || [];
    if (history.length === 0) {
      wx.showToast({
        title: '暂无学习记录',
        icon: 'none'
      });
      return;
    }
    wx.showModal({
      title: '学习记录',
      content: history.slice(0, 10).map((item, i) => `${i + 1}. ${item.word}`).join('\n'),
      showCancel: false
    });
  },

  viewCollections: function() {
    const collections = wx.getStorageSync('collections') || [];
    if (collections.length === 0) {
      wx.showToast({
        title: '暂无收藏',
        icon: 'none'
      });
      return;
    }
    wx.showModal({
      title: '我的收藏',
      content: collections.slice(0, 10).map((item, i) => `${i + 1}. ${item.word}`).join('\n'),
      showCancel: false
    });
  },

  viewTranslations: function() {
    const translations = wx.getStorageSync('translations') || [];
    if (translations.length === 0) {
      wx.showToast({
        title: '暂无翻译记录',
        icon: 'none'
      });
      return;
    }
    wx.showModal({
      title: '翻译历史',
      content: translations.slice(0, 5).map((item, i) => `${i + 1}. ${item.original}`).join('\n'),
      showCancel: false
    });
  },

  viewAbout: function() {
    wx.showModal({
      title: '关于',
      content: '古字通 v1.0.0\n\n为初中生打造的文言文学习工具。\n\n联系我们：chenmou2012@outlook.com',
      showCancel: false
    });
  }
});
