// pages/translation-detail/translation-detail.js
// 点击翻译历史项进入：展示当时翻译的原文 + 译文 + 重新翻译按钮
// 与 collection-detail 镜像设计
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');
const wsClient = require('../../utils/services/websocket.js');
const auth = require('../../utils/services/auth.js');
const errorUi = require('../../utils/services/error.js');
const logger = require('../../utils/services/logger.js');
const { startStreamQuery } = require('../../utils/services/streamQuery.js');
const log = logger.for('translation-detail');

// 时间格式化（与 collection-detail 一致）
function formatCollectedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const Y = d.getFullYear();
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return Y + '年' + M + '月' + D + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function formatCollectedAtShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return M + '月' + D + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// 原文短摘：标题区域用，避免长原文撑爆页面
function shortOriginal(text, maxLen = 14) {
  if (!text) return '';
  // 按字符截断（中文按字、英文按 word）
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + '…';
}

Page({
  data: {
    original: '',           // 完整原文
    originalShort: '',      // 原文短摘（标题用）
    originalTranslated: '', // 收藏时的译文
    originalHtml: '',        // 渲染后的 HTML
    streamingText: '',      // 重新翻译中累积的流式文本
    streamingHtml: '',      // 渲染后的 HTML
    isRegenerating: false,  // 是否正在重新翻译
    isShowingNew: false,    // 是否展示流式新结果（未完成时）
    statusBarHeight: 20,
    collectedAt: '',        // 收藏时间
    collectedAtShort: ''    // 收藏时间短版
  },

  onLoad: function(options) {
    // 防御性 decode：URL 参数 original 可能未被自动解码
    let raw = options.original || '';
    try {
      if (raw.includes('%')) raw = decodeURIComponent(raw);
    } catch (e) { /* 异常时保持原值 */ }
    const original = raw.trim();

    if (!original) {
      wx.showModal({
        title: '参数错误',
        content: '未指定翻译原文',
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }

    // 在 translations 数组里找这条
    const translations = storage.getTranslations();
    const normalize = (s) => (s || '').trim().normalize('NFC');
    const item = translations.find(t => normalize(t.original) === normalize(original));
    if (!item) {
      console.warn('[translation-detail] 找不到翻译', {
        urlOriginal: original,
        urlLen: original.length,
        translationsCount: translations.length,
        firstFew: translations.slice(0, 3).map(t => ({ original: t.original, len: t.original.length }))
      });
      const actualOriginals = translations.slice(0, 3).map(t => t.original).join('、');
      const tip = translations.length === 0
        ? '翻译列表为空'
        : '找不到「' + shortOriginal(original, 20) + '」（列表: ' + actualOriginals + '）';
      wx.showModal({
        title: '翻译不存在',
        content: tip + '\n\n请回到翻译页重新翻译',
        showCancel: false,
        confirmText: '返回',
        success: () => wx.navigateBack()
      });
      return;
    }

    const translatedText = item.translated || '';
    this.setData({
      original: item.original,
      originalShort: shortOriginal(item.original),
      originalTranslated: translatedText,
      originalHtml: markdown.markdownToHtml(translatedText),
      statusBarHeight: getApp().globalData.statusBarHeight,
      collectedAt: formatCollectedAt(item.time),
      collectedAtShort: formatCollectedAtShort(item.time)
    });
  },

  onUnload: function() {
    if (this._streamQuery) {
      this._streamQuery.dispose();
      this._streamQuery = null;
    }
    wsClient.close();
  },

  goBack: function() {
    wx.navigateBack();
  },

  removeCollect: function() {
    const that = this;
    wx.showModal({
      title: '提示',
      content: '取消收藏这条翻译？',
      success: (res) => {
        if (res.confirm) {
          // 取消收藏时如果还在流式翻译，先关掉 WS 避免泄露
          if (that.data.isRegenerating) {
            if (that._streamQuery) {
              that._streamQuery.dispose();
              that._streamQuery = null;
            }
            wsClient.close();
          }
          storage.removeTranslation(that.data.original);
          // 同步清缓存（避免下次同原文查词时被旧缓存命中）
          storage.invalidateCachedTranslation(that.data.original);
          wx.showToast({ title: '已取消收藏', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 600);
        }
      }
    });
  },

  copyContent: function() {
    const text = this.data.isShowingNew ? this.data.streamingText : this.data.originalTranslated;
    if (!text) {
      wx.showToast({ title: '暂无可复制内容', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
    });
  },

  regenerate: function() {
    if (this.data.isRegenerating) return;
    if (this._streamQuery) {
      this._streamQuery.dispose();
      this._streamQuery = null;
    }

    if (!auth.checkLogin()) {
      wx.showModal({
        title: '提示',
        content: '重新翻译需要登录，是否前往"我的"页面登录？',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.switchTab({ url: '/pages/profile/profile' });
        }
      });
      return;
    }

    wsClient.close();
    this.setData({
      isRegenerating: true,
      isShowingNew: false,
      streamingText: '',
      streamingHtml: ''
    });
    wx.showLoading({ title: '正在重新翻译...', mask: true });

    const that = this;

    // P0-3/P0-7: 统一流式查询封装（ticket 换取、双层 watchdog、节流、错误收尾）
    that._streamQuery = startStreamQuery({
      path: '/ws/translate',
      tag: 'translation-detail',
      throttleMode: 'interval',
      throttleInterval: 100,
      idleTimeoutMs: 15000,
      connectWaitTimeoutMs: 10000,
      retryMessage: '翻译超时，请重试',
      send: () => wsClient.send({ text: that.data.original }),
      isActive: () => that.data.isRegenerating,
      finish: () => that.setData({ isRegenerating: false, isShowingNew: false }),
      onStartMsg: () => that.setData({ streamingText: '' }),  // 重连后清空旧内容，避免两轮拼接重复
      onDelta: (delta) => {
        const newText = that.data.streamingText + delta;
        that.setData({
          streamingText: newText,
          streamingHtml: markdown.markdownToHtml(newText),
          isShowingNew: true
        });
      },
      onDone: (tail) => {
        wsClient.close();  // 与原文一致：完成后关闭连接
        if (tail) { that.data.streamingText += tail; }
        // 自动替换翻译的 translated 字段（保留原 time）
        const updated = storage.updateTranslation(that.data.original, that.data.streamingText);
        if (updated) {
          // 同步写新缓存（下次命中）
          storage.setCachedTranslation(that.data.original, that.data.streamingText);
          that.setData({
            isRegenerating: false,
            originalTranslated: that.data.streamingText,
            originalHtml: markdown.markdownToHtml(that.data.streamingText),
            streamingText: '',
            streamingHtml: '',
            isShowingNew: false
          });
          wx.showToast({ title: '已更新翻译', icon: 'success' });
        } else {
          that.setData({ isRegenerating: false, isShowingNew: false });
          wx.showToast({ title: '更新失败', icon: 'none' });
        }
      },
      onRetry: () => that.regenerate()
    });
  }
});
