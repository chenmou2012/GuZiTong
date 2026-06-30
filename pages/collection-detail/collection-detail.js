// pages/collection-detail/collection-detail.js
// 点击收藏列表项进入：展示当时查询的释义 + 重新生成按钮
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');
const wsClient = require('../../utils/services/websocket.js');
const auth = require('../../utils/services/auth.js');
const errorUi = require('../../utils/services/error.js');
const logger = require('../../utils/services/logger.js');
const log = logger.for('collection-detail');

Page({
  data: {
    word: '',
    originalResult: '',      // 收藏的原始 result
    originalHtml: '',         // 渲染后的 HTML
    streamingText: '',        // 重新生成中累积的流式文本
    streamingHtml: '',        // 渲染后的 HTML
    isRegenerating: false,    // 是否正在重新查询
    isShowingNew: false,      // 是否展示流式新结果（未完成时）
    statusBarHeight: 20
  },

  onLoad: function(options) {
    const word = (options.word || '').trim();
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
    this.setData({
      word: word,
      originalResult: item.result || '',
      originalHtml: markdown.markdownToHtml(item.result || ''),
      statusBarHeight: getApp().globalData.statusBarHeight
    });
  },

  onUnload: function() {
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
      streamingHtml: ''
    });
    wx.showLoading({ title: '正在重新查询...', mask: true });

    const that = this;
    let wsStartTime = null;

    // 双层 watchdog（同 index.js / translate.js）
    let watchdog = null;
    function clearWatchdog() {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    }
    function armIdleWatchdog() {
      clearWatchdog();
      watchdog = setTimeout(() => {
        log.warn('[collection-detail] idle watchdog 触发');
        if (!that.data.isRegenerating) return;
        wsClient.close();
        that.setData({ isRegenerating: false, isShowingNew: false });
        wx.hideLoading();
        errorUi.showRetryError('查询超时，请重试', () => that.regenerate());
      }, 15000);
    }

    auth.fetchWsTicket().then((ticket) => {
      if (!ticket) {
        wx.hideLoading();
        that.setData({ isRegenerating: false });
        errorUi.showRetryError('网络错误，请稍后重试', () => that.regenerate());
        return;
      }
      wsClient.connect('/ws/query?ticket=' + encodeURIComponent(ticket), {
        onOpen: function() {
          wsStartTime = Date.now();
          wsClient.send({ text: that.data.word });
          log.info('[collection-detail] 已发送 word=' + that.data.word);
          // onOpen 后 10s 内若无任何消息视为握手后异常
          clearWatchdog();
          watchdog = setTimeout(() => {
            log.warn('[collection-detail] connect-wait watchdog 触发');
            if (!that.data.isRegenerating) return;
            wsClient.close();
            that.setData({ isRegenerating: false, isShowingNew: false });
            wx.hideLoading();
            errorUi.showRetryError('查询无响应，请重试', () => that.regenerate());
          }, 10000);
        },
        onMessage: function(data) {
          if (data.error) {
            wx.hideLoading();
            clearWatchdog();
            wsClient.close();
            that.setData({ isRegenerating: false, isShowingNew: false });
            errorUi.showRetryError(data.error, () => that.regenerate());
            return;
          }
          if (data.type === 'content') {
            wx.hideLoading();
            const newText = that.data.streamingText + data.content;
            that.setData({
              streamingText: newText,
              streamingHtml: markdown.markdownToHtml(newText),
              isShowingNew: true
            });
            armIdleWatchdog();
          }
          if (data.type === 'done') {
            wx.hideLoading();
            clearWatchdog();
            wsClient.close();
            // 自动替换收藏的 result 字段（保留原 time）
            const updated = storage.updateCollection(that.data.word, that.data.streamingText);
            if (updated) {
              that.setData({
                isRegenerating: false,
                originalResult: that.data.streamingText,
                originalHtml: markdown.markdownToHtml(that.data.streamingText),
                streamingText: '',
                streamingHtml: '',
                isShowingNew: false
              });
              wx.showToast({ title: '已更新收藏', icon: 'success' });
            } else {
              that.setData({ isRegenerating: false, isShowingNew: false });
              wx.showToast({ title: '更新失败', icon: 'none' });
            }
          }
        },
        onError: function(res) {
          log.error('连接错误:', res);
          wx.hideLoading();
          clearWatchdog();
          wsClient.close();
          that.setData({ isRegenerating: false, isShowingNew: false });
          errorUi.showRetryError('网络错误，请稍后重试', () => that.regenerate());
        },
        onClose: function() {
          // 由 wsClient 处理重连
        }
      });
    });
  }
});