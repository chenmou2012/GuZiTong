// pages/translate/translate.js
const constants = require('../../utils/services/constants');
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');

const { API_BASE_URL } = constants;

Page({
  data: {
    inputText: '',
    showResult: false,
    isLoading: false,
    result: {},
    inputCollapsed: false,
    resultAnimation: {},
    streamingText: '',
    resultHtml: ''
  },

  onLoad: function() {
  },

  onShow: function() {
    // 每次切换回来时重置到初始界面
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
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

    // 关闭之前的 WebSocket 连接
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }

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
    const host = API_BASE_URL.replace('http://', '').replace('https://', '');
    const wsUrl = (API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://') + host;

    // 连接 WebSocket
    this.socketTask = wx.connectSocket({
      url: wsUrl + '/ws/translate',
      header: {},
      method: 'GET',
      protocols: []
    });

    this.socketTask.onOpen(function(res) {
      console.log('WebSocket 连接 open');
      // 发送翻译请求
      const sendData = JSON.stringify({
        text: text
      });
      that.socketTask.send({
        data: sendData
      });
    });

    this.socketTask.onMessage(function(res) {
      try {
        const data = JSON.parse(res.data);
        console.log('收到消息:', data);

        if (data.error) {
          that.showErrorMessage(data.error);
          return;
        }

        if (data.type === 'start') {
          that.setData({
            streamingText: ''
          });
          return;
        }

        if (data.type === 'content') {
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
          // 完成
          wx.hideLoading();
          that.handleTranslateResult(that.data.streamingText);
          return;
        }
      } catch (e) {
        console.error('解析消息失败:', e);
      }
    });

    this.socketTask.onError(function(res) {
      console.error('WebSocket 错误:', res);
      that.showErrorMessage('网络错误');
    });

    this.socketTask.onClose(function(res) {
      console.log('WebSocket 关闭');
      if (that.data.isLoading && that.data.streamingText) {
        wx.hideLoading();
        that.handleTranslateResult(that.data.streamingText);
      }
    });
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
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
  },

  showErrorMessage: function(message) {
    wx.hideLoading();

    this.setData({
      isLoading: false,
      inputCollapsed: false
    });

    wx.showToast({
      title: message,
      icon: 'none'
    });

    // 关闭 WebSocket
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
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
      if (this.socketTask) {
        this.socketTask.close();
        this.socketTask = null;
      }
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
      if (this.socketTask) {
        this.socketTask.close();
        this.socketTask = null;
      }
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
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }

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
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
  }
});