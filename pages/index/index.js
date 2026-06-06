// pages/index/index.js
const constants = require('../../utils/services/constants');
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');

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
    streamingText: ''
  },

  onLoad: function(options) {
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

  closeRealWords: function() {
    this.setData({
      showRealWordsSection: false
    });
  },

  onQuickWordTap: function(e) {
    const word = e.currentTarget.dataset.word;
    this.setData({ inputText: word });
    // 延迟确保 setData 完成
    setTimeout(() => {
      this.searchWord();
    }, 100);
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

  goToRealWordsPage: function() {
    wx.switchTab({
      url: '/pages/realwords/realwords'
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
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }

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
    const sendData = JSON.stringify({ text: query });
    // 获取域名部分
    const host = API_BASE_URL.replace('http://', '').replace('https://', '');
    const wsUrl = (API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://') + host;
    console.log('发送数据:', sendData, 'wsUrl:', wsUrl);

    this.socketTask = wx.connectSocket({
      url: wsUrl + '/ws/query',
      header: {},
      method: 'GET',
      protocols: []
    });

    this.socketTask.onOpen(function() {
      that.socketTask.send({ data: sendData });
    });

    this.socketTask.onMessage(function(res) {
      try {
        const data = JSON.parse(res.data);
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
      } catch (e) {
        console.error('解析失败:', e);
      }
    });

    this.socketTask.onError(function() {
      wx.hideLoading();
      that.showErrorMessage('网络错误');
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

    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
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
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
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

  onPullDownRefresh: function() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
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
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
  }
});