// pages/index/index.js
const constants = require('../../utils/services/constants');
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');
const wsClient = require('../../utils/services/websocket.js');
const auth = require('../../utils/services/auth.js');

const { API_BASE_URL, REAL_WORDS, HIGH_FREQ_REAL_WORDS } = constants;

Page({
  data: {
    inputText: '',
    currentQuery: '',
    quickWords: ['之', '其', '而', '以', '何', '于'],
    showResult: false,
    isLoading: false,
    showError: false,
    errorMessage: '',
    result: {},
    resultHtml: '',
    isCollected: false,
    hasHistory: false,
    showQuickWords: true,
    inputCollapsed: false,
    resultAnimation: {},
    realWords: REAL_WORDS,
    highFreqRealWords: HIGH_FREQ_REAL_WORDS,
    showRealWordsSection: true,
    showRealWordsPicker: false,
    pickerIndex: -1,
    streamingText: '',
    statusBarHeight: 20
  },

  onLoad: function(options) {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
    this.checkHistory();
  },

  onShow: function() {
    // 检查是否有待查询的字
    var pendingQuery = storage.getPendingQuery();
    storage.clearPendingQuery();

    this.setData({
      inputText: '',
      showResult: false,
      result: {},
      resultHtml: '',
      streamingText: '',
      showQuickWords: true,
      inputCollapsed: false,
      showRealWordsSection: true,
      showRealWordsPicker: false,
      pickerIndex: -1,
      isCollected: false
    });

    // 如果有待查询，执行查询
    if (pendingQuery) {
      this.setData({ inputText: pendingQuery });
      this.searchWord();
    }
    this.checkHistory();
  },

  onInputChange: function(e) {
    this.setData({
      inputText: e.detail.value
    });
  },

  clearInput: function() {
    this.setData({
      inputText: '',
      showQuickWords: true,
      inputCollapsed: false,
      showRealWordsSection: true,
      showRealWordsPicker: false,
      pickerIndex: -1
    });
  },

  onQuickWordTap: function(e) {
    const word = e.currentTarget.dataset.word;
    this.setData({ inputText: word });
    // setData 后 this.data 已同步更新，直接调用无需 setTimeout
    this.searchWord();
  },

  goToRealWords: function() {
    wx.navigateTo({
      url: '/pages/realwords/realwords'
    });
  },

  onRealWordSelect: function(e) {
    const index = e.detail.value;
    const word = this.data.realWords[index];
    this.setData({
      inputText: word,
      pickerIndex: index,
      showRealWordsPicker: false
    });
    this.searchWord(word);
  },

  toggleRealWordsPicker: function() {
    this.setData({
      showRealWordsPicker: !this.data.showRealWordsPicker
    });
  },

  closeRealWords: function() {
    this.setData({
      showRealWordsSection: false
    });
  },

  searchWord: function() {
    let query = this.data.inputText.trim();
    console.log('query:', query);

    if (!query) {
      wx.showToast({
        title: '请输入要查询的字词',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 关闭之前的 WebSocket
    wsClient.close();

    this.setData({
      isLoading: true,
      showResult: false,
      showError: false,
      inputCollapsed: true,
      showQuickWords: false,
      streamingText: '',
      resultParsed: null
    });

    wx.showLoading({ title: '正在查询...', mask: true });

    const that = this;
    console.log('发送数据: text=' + query);

    // WebSocket 协议不支持自定义 header，token 只能通过 URL query 传递
    const token = auth.getToken() || '';
    wsClient.connect('/ws/query?token=' + encodeURIComponent(token), {
      onOpen: function() {
        wsClient.send({ text: query });
      },
      onMessage: function(data) {
        console.log('收到:', data);

        if (data.error) {
          wx.hideLoading();
          that.showErrorMessage(data.error);
          return;
        }

        if (data.type === 'content') {
          wx.hideLoading();
          const newText = that.data.streamingText + data.content;
          that.setData({
            streamingText: newText,
            resultHtml: markdown.markdownToHtml(newText),
            showResult: true,
            isLoading: false
          });
        }

        if (data.type === 'done') {
          that.handleQueryResult(that.data.streamingText);
        }
      },
      onError: function() {
        wx.hideLoading();
        that.showErrorMessage('网络错误');
      },
      onClose: function() {
        // 由 wsClient 处理重连
      }
    });
  },

  handleQueryResult: function(content) {
    const animation = wx.createAnimation({
      duration: 400,
      timingFunction: 'ease-out'
    });
    animation.opacity(1).translateY(0).step();

    const html = markdown.markdownToHtml(content);

    this.setData({
      isLoading: false,
      showResult: true,
      result: { content },
      resultHtml: html,
      streamingText: content,
      inputCollapsed: true,
      showQuickWords: false,
      resultAnimation: animation.export()
    });

    storage.saveHistory(this.data.inputText, content);
    this.checkCollectStatus();

    wsClient.close();
  },

  showErrorMessage: function(message) {
    wx.hideLoading();
    this.setData({
      isLoading: false,
      showError: true,
      errorMessage: message,
      inputCollapsed: false,
      showQuickWords: true
    });
    wsClient.close();
    setTimeout(() => {
      this.setData({ showError: false });
    }, 5000);
  },

  playAudio: function() {
    wx.showToast({ title: '音频功能开发中', icon: 'none' });
  },

  toggleCollect: function() {
    const word = this.data.inputText;
    const result = storage.toggleCollection(word, this.data.streamingText);
    this.setData({ isCollected: result.collected });
    wx.showToast({ title: result.collected ? '收藏成功' : '已取消收藏', icon: 'success' });
  },

  copyContent: function() {
    wx.setClipboardData({
      data: this.data.streamingText,
      success: function() {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' });
      }
    });
  },

  checkCollectStatus: function() {
    const word = this.data.inputText;
    const isCollected = storage.isCollected(word);
    this.setData({ isCollected });
  },

  checkHistory: function() {
    const history = storage.getHistory();
    this.setData({ hasHistory: history.length > 0 });
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
        inputCollapsed: false,
        showQuickWords: true
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
        streamingText: '',
        showQuickWords: true,
        inputCollapsed: false,
        isCollected: false
      });
    }
  },

  onPullDownRefresh: function() {
    wsClient.close();
    this.setData({
      inputText: '',
      showResult: false,
      result: {},
      resultHtml: '',
      streamingText: '',
      showQuickWords: true,
      inputCollapsed: false,
      showRealWordsSection: true,
      showRealWordsPicker: false,
      pickerIndex: -1
    });
    wx.stopPullDownRefresh();
  },

  onUnload: function() {
    wsClient.close();
  }
});