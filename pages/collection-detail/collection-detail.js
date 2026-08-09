// pages/collection-detail/collection-detail.js
// 点击收藏列表项进入：展示当时查询的释义 + 重新生成按钮
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');
const wsClient = require('../../utils/services/websocket.js');
const auth = require('../../utils/services/auth.js');
const errorUi = require('../../utils/services/error.js');
const logger = require('../../utils/services/logger.js');
const { startStreamQuery } = require('../../utils/services/streamQuery.js');
const log = logger.for('collection-detail');

// 时间格式化：长版「2026年7月3日 23:20」
function formatCollectedAt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const Y = d.getFullYear();
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return Y + '年' + M + '月' + D + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// 短版「7月3日 23:20」（与首页小标题更协调）
function formatCollectedAtShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return M + '月' + D + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

Page({
  data: {
    word: '',
    originalResult: '',      // 收藏的原始 result
    originalHtml: '',         // 渲染后的 HTML
    parsedOriginal: null,     // 结构化解析：{ pinyin, meanings: [{pos, meaning, example, source}] }
    streamingText: '',        // 重新生成中累积的流式文本
    streamingHtml: '',        // 渲染后的 HTML
    parsedStreaming: null,    // 流式内容的结构化解析
    displayParsed: null,      // 当前展示的 parsed（流式时=parsedStreaming，否则=parsedOriginal）
    isRegenerating: false,    // 是否正在重新查询
    isShowingNew: false,      // 是否展示流式新结果（未完成时）
    statusBarHeight: 20,
    collectedAt: '',          // 收藏时间（格式：YYYY年M月D日 HH:mm）
    collectedAtShort: ''      // 收藏时间短版（M月D日 HH:mm）
  },

  onLoad: function(options) {
    // 防御性 decode：部分场景（分享卡片、深链、第三方跳转）下 WeChat 不会自动解码 URL 参数，
    // 此时 options.word 仍是 "%E5%8F%8B" 这种字面编码串，长度 9 而不是 1。
    // decodeURIComponent("友") 返回 "友"（不变），所以对已解码情况也是安全的。
    let raw = options.word || '';
    try {
      if (raw.includes('%')) raw = decodeURIComponent(raw);
    } catch (e) { /* 异常时保持原值 */ }
    const word = raw.trim();
    const collections = storage.getCollections();
    // 容错：trim + Unicode NFC 规范化后再匹配（避免前后空格/全半角差异导致匹配失败）
    const normalize = (s) => (s || '').trim().normalize('NFC');
    const item = collections.find(c => normalize(c.word) === normalize(word));
    if (!item) {
      console.warn('[collection-detail] 找不到收藏', {
        urlWord: word,
        urlWordLen: word.length,
        collectionsCount: collections.length,
        firstFewWords: collections.slice(0, 5).map(c => ({ word: c.word, len: c.word.length }))
      });
      // 详细 toast：告诉用户 URL word 和实际 storage 里的 word
      const actualWords = collections.slice(0, 3).map(c => c.word).join('、');
      const tip = collections.length === 0
        ? '收藏列表为空'
        : '找不到「' + word + '」（列表: ' + actualWords + '）';
      wx.showModal({
        title: '收藏不存在',
        content: tip + '\n\n请回到查词页重新收藏',
        showCancel: false,
        confirmText: '返回',
        success: () => wx.navigateBack()
      });
      return;
    }
    const resultText = item.result || '';
    const parsed = markdown.parseMarkdown(resultText);
    this.setData({
      word: word,
      originalResult: resultText,
      originalHtml: markdown.markdownToHtml(resultText),
      parsedOriginal: parsed,
      displayParsed: parsed,
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
      content: '取消收藏「' + this.data.word + '」？',
      success: (res) => {
        if (res.confirm) {
          // 取消收藏时如果还在流式查询，先关掉 WS 避免泄露
          if (that.data.isRegenerating) {
            if (that._streamQuery) {
              that._streamQuery.dispose();
              that._streamQuery = null;
            }
            wsClient.close();
          }
          storage.removeCollection(that.data.word);
          wx.showToast({ title: '已取消收藏', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 600);
        }
      }
    });
  },

  copyContent: function() {
    const text = this.data.isShowingNew ? this.data.streamingText : this.data.originalResult;
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
        content: '重新生成需要登录，是否前往"我的"页面登录？',
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
      streamingHtml: '',
      parsedStreaming: null
    });
    wx.showLoading({ title: '正在重新查询...', mask: true });

    const that = this;

    // P0-3/P0-6: 统一流式查询封装（ticket 换取、双层 watchdog、节流、错误收尾）
    that._streamQuery = startStreamQuery({
      path: '/ws/query',
      tag: 'collection-detail',
      throttleMode: 'interval',
      throttleInterval: 100,
      idleTimeoutMs: 15000,
      connectWaitTimeoutMs: 10000,
      retryMessage: '查询超时，请重试',
      send: () => wsClient.send({ text: that.data.word }),
      isActive: () => that.data.isRegenerating,
      finish: () => that.setData({ isRegenerating: false, isShowingNew: false }),
      onStartMsg: () => that.setData({ streamingText: '' }),  // 重连后清空旧内容，避免两轮拼接重复
      onDelta: (delta) => {
        const newText = that.data.streamingText + delta;
        const parsed = markdown.parseMarkdown(newText);
        const existing = that.data.parsedStreaming || { pinyin: '', meanings: [] };
        const finalParsed = (parsed && parsed.meanings.length >= existing.meanings.length)
          ? parsed
          : existing;
        const patch = {
          streamingText: newText,
          parsedStreaming: finalParsed,
          displayParsed: finalParsed,
          isShowingNew: true
        };
        // 结构化卡片已就绪时 fallback HTML 用不上
        if (!finalParsed || finalParsed.meanings.length === 0) {
          patch.streamingHtml = markdown.markdownToHtml(newText);
        }
        that.setData(patch);
      },
      onDone: (tail) => {
        wsClient.close();  // 与原文一致：完成后关闭连接
        if (tail) { that.data.streamingText += tail; }
        // 自动替换收藏的 result 字段（保留原 time）
        const updated = storage.updateCollection(that.data.word, that.data.streamingText);
        if (updated) {
          const newParsed = markdown.parseMarkdown(that.data.streamingText);
          that.setData({
            isRegenerating: false,
            originalResult: that.data.streamingText,
            originalHtml: markdown.markdownToHtml(that.data.streamingText),
            parsedOriginal: newParsed,
            displayParsed: newParsed,
            streamingText: '',
            streamingHtml: '',
            parsedStreaming: null,
            isShowingNew: false
          });
          wx.showToast({ title: '已更新收藏', icon: 'success' });
        } else {
          that.setData({ isRegenerating: false, isShowingNew: false });
          wx.showToast({ title: '更新失败', icon: 'none' });
        }
      },
      onRetry: () => that.regenerate()
    });
  }
});
