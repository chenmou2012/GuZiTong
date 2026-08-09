// pages/translate/translate.js
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');
const wsClient = require('../../utils/services/websocket.js');
const auth = require('../../utils/services/auth.js');
const errorUi = require('../../utils/services/error.js');
const logger = require('../../utils/services/logger.js');
const { startStreamQuery } = require('../../utils/services/streamQuery.js');
const log = logger.for('translate');

Page({
  data: {
    inputText: '',
    showResult: false,
    isLoading: false,
    result: {},
    inputCollapsed: false,
    resultAnimation: {},
    streamingText: '',
    resultHtml: '',
    isCollected: false,    // 当前翻译是否已收藏（与查词模块 isCollected 对齐）
    fromCache: false,      // 当前结果是否来自缓存（与查词模块 fromCache 对齐）
    statusBarHeight: 20
  },

  onLoad: function() {
    try {
      this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
    } catch (e) {
      log.error('[translate.onLoad] failed:', e);
    }
  },

  onShow: function() {
    try {
      // 检查是否有待翻译的文本（从收藏/翻译历史跳转过来）
      const pendingText = storage.getPendingTranslation();
      if (pendingText) {
        storage.clearPendingTranslation();
        this.setData({ inputText: pendingText });
        // 自动触发翻译
        this.translateText();
        return;
      }
      // 保留当前结果（从翻译详情/历史返回时不清空）
      if (this.data.showResult && this.data.inputText) {
        this.setData({ isCollected: storage.isTranslationCollected(this.data.inputText.trim()) });
      }
    } catch (e) {
      log.error('[translate.onShow] failed:', e);
    }
  },

  onInputChange: function(e) {
    this.setData({
      inputText: e.detail.value
    });
  },

  clearInput: function() {
    this.setData({
      inputText: '',
      inputCollapsed: false
    });
  },

  translateText: function() {
    if (this._streamQuery) {
      this._streamQuery.dispose();
      this._streamQuery = null;
    }

    const text = this.data.inputText.trim();

    if (!text) {
      wx.showToast({
        title: '请输入要翻译的文言文',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 未登录拦截：WebSocket 必须带 token，未登录会被后端拒绝
    if (!auth.checkLogin()) {
      wx.showModal({
        title: '提示',
        content: '翻译需要登录，是否前往"我的"页面登录？',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        }
      });
      return;
    }

    // 关闭之前的 WebSocket 连接
    wsClient.close();

    this.setData({
      isLoading: true,
      showResult: false,
      inputCollapsed: true,
      streamingText: '',
      fromCache: false   // 清空上次的缓存标记
    });

    // 查缓存：命中 → 直接展示（不调 AI，秒级响应）
    // 缓存键：text（与查词模块的 wordCache 对齐）
    const cached = storage.getCachedTranslation(text);
    if (cached) {
      log.info('[translate] 命中缓存，跳过 AI 生成', { textLen: text.length, cacheTime: cached.time });
      this.handleTranslateResult(cached.result, { fromCache: true });
      return;
    }

    wx.showLoading({
      title: '正在翻译...',
      mask: true
    });

    const that = this;

    // P0-3/P0-7: 统一流式查询封装（ticket 换取、双层 watchdog、节流、错误收尾）
    that._streamQuery = startStreamQuery({
      path: '/ws/translate',
      tag: 'translate',
      throttleMode: 'interval',
      throttleInterval: 100,
      idleTimeoutMs: 15000,
      connectWaitTimeoutMs: 10000,
      retryMessage: '翻译超时，请重试',
      send: () => wsClient.send({ text: text }),
      isActive: () => that.data.isLoading,
      finish: () => that.setData({ isLoading: false }),
      onDelta: (delta) => {
        const newText = that.data.streamingText + delta;
        that.setData({
          streamingText: newText,
          resultHtml: markdown.markdownToHtml(newText)
        });
      },
      onDone: (tail) => {
        // 完成：先取回未刷新的尾包，保证 streamingText 完整
        if (tail) { that.data.streamingText += tail; }
        log.info('[translate] 完成');
        that.handleTranslateResult(that.data.streamingText);
      },
      onRetry: () => that.translateText(),
      onStartMsg: () => that.setData({ streamingText: '' }),
      onFirstContent: (wsStartTime) => {
        log.info(`[translate] 首token: ${Date.now() - wsStartTime}ms`);
      }
    });
  },

  handleTranslateResult: function(content, options) {
    const animation = wx.createAnimation({
      duration: 400,
      timingFunction: 'ease-out'
    });
    animation.opacity(1).step();

    const html = markdown.markdownToHtml(content);

    // 写缓存（只有非缓存来源、AI 真实生成时才写；缓存命中时跳过）
    const fromCache = options && options.fromCache;
    if (!fromCache) {
      storage.setCachedTranslation(this.data.inputText.trim(), content);
      log.info('[translate] 已写入缓存', { textLen: this.data.inputText.length });
    }

    // 缓存命中时计算「N 分钟前查过」文案（WXML 不能调函数）
    const cacheAge = fromCache
      ? this._formatCacheAge(Date.now() - (storage.getCachedTranslation(this.data.inputText.trim()) || {}).time)
      : '';

    this.setData({
      isLoading: false,
      showResult: true,
      // 缓存命中时也必须写回 streamingText，否则"复制/收藏"读到的是空串
      streamingText: content,
      result: { content: content },
      resultAnimation: animation.export(),
      resultHtml: html,
      fromCache: !!fromCache,
      cacheAge: cacheAge,
      // 翻译完成后同步收藏状态（与查词模块 handleQueryResult 对齐）
      isCollected: storage.isTranslationCollected(this.data.inputText.trim())
    });

    // 关闭 WebSocket
    wsClient.close();
  },

  collectTranslation: function() {
    // 与查词模块 toggleCollect 一致：流式过程中 streamingText 是残缺文本，禁止收藏
    if (this.data.isLoading) {
      wx.showToast({ title: '翻译完成后再收藏', icon: 'none' });
      return;
    }
    const text = this.data.inputText.trim();
    const result = this.data.streamingText;
    if (!text || !result) {
      wx.showToast({ title: '请先翻译后再收藏', icon: 'none' });
      return;
    }
    const ret = storage.toggleTranslation(text, result);
    this.setData({ isCollected: ret.collected });
    wx.showToast({ title: ret.collected ? '收藏成功' : '已取消收藏', icon: 'success' });
  },

  // 缓存时长格式化（「刚刚 / X 分钟前 / X 小时前 / X 天前」），与查词模块对齐
  _formatCacheAge: function(ms) {
    if (!ms || ms < 0) return '';
    if (ms < 60 * 1000) return '刚刚';
    if (ms < 60 * 60 * 1000) return Math.floor(ms / 60000) + ' 分钟前';
    if (ms < 24 * 60 * 60 * 1000) return Math.floor(ms / 3600000) + ' 小时前';
    return Math.floor(ms / 86400000) + ' 天前';
  },

  copyTranslation: function() {
    wx.setClipboardData({
      data: this.data.streamingText,
      success: function() {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' });
      }
    });
  },

  // 停止或清空
  stopOrClear: function() {
    if (this._streamQuery) {
      this._streamQuery.dispose();
      this._streamQuery = null;
    }
    if (this.data.isLoading) {
      // 停止输出
      wsClient.close();
      wx.hideLoading();
      this.setData({
        isLoading: false,
        showResult: false,
        streamingText: '',
        inputCollapsed: false
      });
      wx.showToast({ title: '已停止', icon: 'none' });
    } else {
      // 清空 - 先关闭 WebSocket
      wsClient.close();
      wx.hideLoading();
      this.setData({
        inputText: '',
        showResult: false,
        result: {},
        resultHtml: '',
        inputCollapsed: false,
        streamingText: ''
      });
    }
  },

  onUnload: function() {
    if (this._streamQuery) {
      this._streamQuery.dispose();
      this._streamQuery = null;
    }
    // 页面卸载时关闭 WebSocket
    wsClient.close();
  }
});
