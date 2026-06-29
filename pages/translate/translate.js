// pages/translate/translate.js
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');
const wsClient = require('../../utils/services/websocket.js');
const auth = require('../../utils/services/auth.js');
const errorUi = require('../../utils/services/error.js');
const logger = require('../../utils/services/logger.js');
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
    statusBarHeight: 20
  },

  onLoad: function() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
  },

  onShow: function() {
    // 检查是否有待翻译的文本（从收藏/翻译历史跳转过来）
    const pendingText = storage.getPendingTranslation();
    if (pendingText) {
      storage.clearPendingTranslation();
      this.setData({ inputText: pendingText });
      // 自动触发翻译
      this.translateText();
      return;
    }

    // 每次切换回来时重置到初始界面
    wsClient.close();
    this.setData({
      inputText: '',
      showResult: false,
      result: {},
      inputCollapsed: false,
      streamingText: ''
    });
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
      streamingText: ''
    });

    wx.showLoading({
      title: '正在翻译...',
      mask: true
    });

    const that = this;
    let wsStartTime = null;
    let wsFirstTokenAt = null;

    // P0-3: 先换一次性 ticket，避免 token 出现在 URL/Nginx 日志
    auth.fetchWsTicket().then((ticket) => {
      if (!ticket) {
        wx.hideLoading();
        errorUi.showRetryError('网络错误，请稍后重试', () => that.translateText());
        return;
      }
      const queryStr = '?ticket=' + encodeURIComponent(ticket);
      wsClient.connect('/ws/translate' + queryStr, {
      onOpen: function() {
        // 计时起点：WebSocket 已建立，真正发出请求这一刻
        wsStartTime = Date.now();
        log.info('[translate] WS 已连接 t=0');
        // 发送翻译请求
        wsClient.send({ text: text });
        log.info('[translate] 请求已发送');
      },
      onMessage: function(data) {
        const elapsed = wsStartTime ? Date.now() - wsStartTime : -1;
        log.info(`[translate] 收到 ${data.type} (${elapsed}ms)`);
        if (data.error) {
          wx.hideLoading();
          wsClient.close();
          errorUi.showRetryError(data.error, () => that.translateText());
          return;
        }

        if (data.type === 'start') {
          that.setData({
            streamingText: ''
          });
          return;
        }

        if (data.type === 'content') {
          if (wsFirstTokenAt === null) {
            wsFirstTokenAt = Date.now();
            log.info(`首token: ${wsFirstTokenAt - wsStartTime}ms`);
          }
          // 实时更新流式文本并渲染 Markdown
          const newText = that.data.streamingText + data.content;
          const html = markdown.markdownToHtml(newText);
          that.setData({
            streamingText: newText,
            resultHtml: html
          });
          return;
        }

        if (data.type === 'done') {
          log.info(`完成: ${Date.now() - wsStartTime}ms`);
          // 完成
          wx.hideLoading();
          that.handleTranslateResult(that.data.streamingText);
          return;
        }
      },
      onError: function(res) {
        log.error('连接错误:', res);
        wx.hideLoading();
        wsClient.close();
        errorUi.showRetryError('网络错误，请稍后重试', () => that.translateText());
      },
      onClose: function(res) {
        log.info('连接关闭:', res);
        // 由 wsClient 处理重连
      }
    });
    });  // P0-3: 闭合 fetchWsTicket().then
  },

  handleTranslateResult: function(content) {
    const animation = wx.createAnimation({
      duration: 400,
      timingFunction: 'ease-out'
    });
    animation.opacity(1).step();

    const html = markdown.markdownToHtml(content);

    this.setData({
      isLoading: false,
      showResult: true,
      result: { content: content },
      resultAnimation: animation.export(),
      resultHtml: html
    });

    // 关闭 WebSocket
    wsClient.close();
  },

  collectTranslation: function() {
    const content = this.data.streamingText;
    if (!content) {
      wx.showToast({
        title: '无翻译结果',
        icon: 'none'
      });
      return;
    }

    storage.addTranslation(this.data.inputText, content);
    wx.showToast({
      title: '已收藏',
      icon: 'success'
    });
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

  onPullDownRefresh: function() {
    // 关闭 WebSocket
    wsClient.close();

    this.setData({
      inputText: '',
      showResult: false,
      result: {},
      inputCollapsed: false,
      streamingText: ''
    });
    wx.stopPullDownRefresh();
  },

  onUnload: function() {
    // 页面卸载时关闭 WebSocket
    wsClient.close();
  }
});