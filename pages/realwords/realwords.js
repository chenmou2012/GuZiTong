// pages/realwords/realwords.js
const constants = require('../../utils/services/constants');
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');

const { API_BASE_URL, REAL_WORDS } = constants;

Page({
  data: {
    realWords: REAL_WORDS,
    isLoading: false,
    result: {},
    resultParsed: null,
    streamingText: ''
  },

  onLoad: function() {},

  onShow: function() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
    this.setData({
      isLoading: false,
      result: {},
      resultParsed: null,
      streamingText: ''
    });
  },

  // 点击实词查询
  onWordTap: function(e) {
    const word = e.currentTarget.dataset.word;
    // 保存到全局数据，跳转后查询
    storage.setPendingQuery(word);
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  queryWord: function(word) {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }

    this.setData({
      isLoading: true,
      result: {},
      resultParsed: null,
      streamingText: ''
    });

    wx.showLoading({
      title: '正在查询...',
      mask: true
    });

    const that = this;
    const host = API_BASE_URL.replace('http://', '').replace('https://', '');
    const wsUrl = (API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://') + host;

    this.socketTask = wx.connectSocket({
      url: wsUrl + '/ws/query',
      header: {},
      method: 'GET',
      protocols: []
    });

    this.socketTask.onOpen(function(res) {
      that.socketTask.send({
        data: JSON.stringify({ text: word })
      });
    });

    this.socketTask.onMessage(function(res) {
      try {
        const data = JSON.parse(res.data);

        if (data.error) {
          wx.hideLoading();
          wx.showToast({ title: data.error, icon: 'none' });
          that.setData({ isLoading: false });
          return;
        }

        if (data.type === 'content') {
          const newText = that.data.streamingText + data.content;
          that.setData({
            streamingText: newText
          });
          return;
        }

        if (data.type === 'done') {
          wx.hideLoading();
          const parsed = markdown.parseMarkdown(that.data.streamingText);
          that.setData({
            isLoading: false,
            result: { content: that.data.streamingText },
            resultParsed: parsed
          });
          if (that.socketTask) {
            that.socketTask.close();
            that.socketTask = null;
          }
          return;
        }
      } catch (e) {
        console.error('解析失败:', e);
      }
    });

    this.socketTask.onError(function(res) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
      that.setData({ isLoading: false });
    });

    this.socketTask.onClose(function(res) {
      if (that.data.isLoading && that.data.streamingText) {
        wx.hideLoading();
        const parsed = markdown.parseMarkdown(that.data.streamingText);
        that.setData({
          isLoading: false,
          resultParsed: parsed
        });
      }
    });
  },

  // 关闭结果
  closeResult: function() {
    this.setData({
      result: {},
      resultParsed: null,
      streamingText: ''
    });
  },

  // 收藏
  toggleCollect: function() {
    const word = this.data.resultParsed?.pinyin ? this.data.streamingText : '';
    if (!word) return;

    let collections = storage.getCollections();
    const index = collections.findIndex(item => item.word === word);

    if (index > -1) {
      storage.removeCollection(word);
      wx.showToast({ title: '已取消收藏', icon: 'success' });
    } else {
      storage.addCollection(word, this.data.streamingText);
      wx.showToast({ title: '收藏成功', icon: 'success' });
    }
  },

  onPullDownRefresh: function() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
    this.setData({
      result: {},
      resultParsed: null,
      streamingText: ''
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