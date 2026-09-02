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

  goBack: function() {
    wx.navigateBack();
  },

  refresh: function() {
    // 缓存对象只读一次，避免逐条 getStorageSync + JSON 解析
    const cache = storage.getWordCache();
    const list = storage.getHistory().map(item => ({
      ...item,
      _key: item.word,
      // 列表只渲染预览，完整内容留在 storage（详情/重查时再取）
      content: storage.previewText(item.content),
      // 注入缓存命中标记：有缓存的项加 fromCache 字段（值是徽章文案）
      fromCache: cache[item.word] ? '已缓存' : ''
    }));
    this.setData({ history: list });
  },

  onItemTap(e) {
    const { item } = e.detail;
    // 有缓存 → 查词页会命中缓存秒级展示；没缓存 → 查词页会调 AI
    storage.setPendingQuery(item.word);
    wx.switchTab({ url: '/pages/index/index' });
  },

  // "重查"操作：清掉这条的缓存，再跳转查词页，下次会强制调 AI
  onItemAction(e) {
    const { item } = e.detail;
    storage.invalidateCachedWord(item.word);
    storage.setPendingQuery(item.word);
    wx.switchTab({ url: '/pages/index/index' });
    wx.showToast({ title: '将重新查询', icon: 'none', duration: 1500 });
  },

  onItemDelete(e) {
    const { item } = e.detail;
    // 删历史时同步删缓存（避免下次同字查词时被旧缓存命中）
    storage.invalidateCachedWord(item.word);
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
          // 清空历史时同步清空 wordCache（单次落盘 + 单次同步）
          storage.clearWordCache();
          storage.clearHistory();
          this.refresh();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});
