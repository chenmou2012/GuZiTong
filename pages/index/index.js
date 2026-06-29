// pages/index/index.js
const constants = require('../../utils/services/constants');
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');
const wsClient = require('../../utils/services/websocket.js');
const auth = require('../../utils/services/auth.js');
const errorUi = require('../../utils/services/error.js');
const logger = require('../../utils/services/logger.js');
const log = logger.for('query');

const { REAL_WORDS, HIGH_FREQ_REAL_WORDS } = constants;

Page({
  data: {
    inputText: '',
    contextText: '',     // 多音字消歧：原句/出处（可选）
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
    elapsedTime: 0,
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
      contextText: '',
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

  // 多音字消歧：原句/出处输入
  onContextChange: function(e) {
    this.setData({
      contextText: e.detail.value
    });
  },

  clearInput: function() {
    this.setData({
      inputText: '',
      contextText: '',
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
    // 多音字消歧：原句/出处（可选，长度上限 200 字防止滥用）
    const context = (this.data.contextText || '').trim().slice(0, 200);
    log.debug('query:', query, 'context:', context);

    if (!query) {
      wx.showToast({
        title: '请输入要查询的字词',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    // 未登录拦截：WebSocket 必须带 token，后端会拒绝未授权连接（403）
    // 不在这里直接弹"网络错误"，引导用户去登录页
    if (!auth.checkLogin()) {
      wx.showModal({
        title: '提示',
        content: '查词需要登录，是否前往"我的"页面登录？',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        }
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
      streamingText: ''
    });

    wx.showLoading({ title: '正在查询...', mask: true });

    const that = this;
    log.debug('发送数据: text=' + query);
    let wsStartTime = null;
    let wsFirstTokenAt = null;
    // P0-6 兜底 watchdog：WS 异常断开（onError 后只派发 onClose 但不发 done）
    // 会导致 isLoading 永远 true，loading 转圈不停。
    // - 收到第一条 content 时启动（idle 15s 无新内容视为卡死）
    // - 收到 done / error / 手动停止时清除
    let watchdog = null;
    function clearWatchdog() {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    }
    function armIdleWatchdog() {
      clearWatchdog();
      watchdog = setTimeout(() => {
        log.warn('[query] idle watchdog 触发，强制收尾');
        if (!that.data.isLoading) return;
        wsClient.close();
        that.setData({ isLoading: false });
        wx.hideLoading();
        errorUi.showRetryError('查询超时，请重试', () => that.searchWord());
      }, 15000);
    }
    // 实时 elapsed timer：onOpen 后每 200ms 刷新一次右上角耗时
    function stopElapsedTimer() {
      if (that._elapsedTimer) {
        clearInterval(that._elapsedTimer);
        that._elapsedTimer = null;
      }
    }
    // 进入 searchWord 先清掉旧的（防止用户反复点查询导致 timer 堆积）
    stopElapsedTimer();

    // P0-3: 先换一次性 ticket，避免 token 出现在 URL/Nginx 日志
    auth.fetchWsTicket().then((ticket) => {
      if (!ticket) {
        wx.hideLoading();
        errorUi.showRetryError('网络错误，请稍后重试', () => that.searchWord());
        return;
      }
      const queryStr = '?ticket=' + encodeURIComponent(ticket);
      wsClient.connect('/ws/query' + queryStr, {
      onOpen: function() {
        // 计时起点：WebSocket 已建立，真正发出请求这一刻
        wsStartTime = Date.now();
        log.info('[query] WS 已连接 t=0');
        // 发送查询：text 必填，context 可选（多音字消歧 / 出处定位）
        wsClient.send({ text: query, context: context });
        log.info('[query] 请求已发送');
        // 启动实时耗时显示
        that.setData({ elapsedTime: 0 });
        stopElapsedTimer();
        that._elapsedTimer = setInterval(() => {
          if (!wsStartTime) return;
          that.setData({ elapsedTime: Date.now() - wsStartTime });
        }, 200);
        // P0-6：兜底 connect-wait watchdog —— onOpen 后 10s 内若没收到任何消息，
        // 视为后端握手后异常，强制收尾
        clearWatchdog();
        watchdog = setTimeout(() => {
          log.warn('[query] connect-wait watchdog 触发，强制收尾');
          if (!that.data.isLoading) return;
          stopElapsedTimer();
          wsClient.close();
          that.setData({ isLoading: false, elapsedTime: 0 });
          wx.hideLoading();
          errorUi.showRetryError('查询无响应，请重试', () => that.searchWord());
        }, 10000);
      },
      onMessage: function(data) {
        const elapsed = wsStartTime ? Date.now() - wsStartTime : -1;
        log.info(`[query] 收到 ${data.type} (${elapsed}ms)`);
        if (data.error) {
          wx.hideLoading();
          stopElapsedTimer();
          clearWatchdog();
          wsClient.close();
          that.setData({ isLoading: false, elapsedTime: 0 });
          errorUi.showRetryError(data.error, () => that.searchWord());
          return;
        }

        if (data.type === 'content') {
          if (wsFirstTokenAt === null) {
            wsFirstTokenAt = Date.now();
            log.info(`首token: ${wsFirstTokenAt - wsStartTime}ms`);
          }
          wx.hideLoading();
          const newText = that.data.streamingText + data.content;
          that.setData({
            streamingText: newText,
            resultHtml: markdown.markdownToHtml(newText),
            showResult: true,
            isLoading: false
          });
          // P0-6：收到 content，重置 idle watchdog
          armIdleWatchdog();
        }

        if (data.type === 'done') {
          log.info(`完成: ${Date.now() - wsStartTime}ms`);
          // 保留最终耗时显示，停止 timer
          that.setData({ elapsedTime: Date.now() - wsStartTime });
          stopElapsedTimer();
          clearWatchdog();
          that.handleQueryResult(that.data.streamingText);
        }
      },
      onError: function(res) {
        log.error('连接错误:', res);
        wx.hideLoading();
        stopElapsedTimer();
        clearWatchdog();
        wsClient.close();
        that.setData({ isLoading: false, elapsedTime: 0 });
        errorUi.showRetryError('网络错误，请稍后重试', () => that.searchWord());
      },
      onClose: function(res) {
        log.info('连接关闭:', res);
        // 由 wsClient 处理重连
      }
    });
    });  // P0-3: 闭合 fetchWsTicket().then
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

  toggleCollect: function() {
    // P0-8：流式过程中 streamingText 是残缺文本，禁止收藏
    if (this.data.isLoading) {
      wx.showToast({ title: '查询完成后再收藏', icon: 'none' });
      return;
    }
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
      if (this._elapsedTimer) { clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
      wx.hideLoading();
      this.setData({
        isLoading: false,
        showResult: false,
        streamingText: '',
        elapsedTime: 0,
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
    if (this._elapsedTimer) { clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
    this.setData({
      inputText: '',
      showResult: false,
      result: {},
      resultHtml: '',
      streamingText: '',
      elapsedTime: 0,
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
    if (this._elapsedTimer) { clearInterval(this._elapsedTimer); this._elapsedTimer = null; }
  },

  // 格式化耗时显示：< 1s 显示 ms，< 60s 显示 X.Ys，>= 60s 显示 M:SS
  formatElapsed: function(ms) {
    if (!ms || ms < 0) return '';
    if (ms < 1000) return ms + 'ms';
    const s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    const m = Math.floor(s / 60);
    const rs = Math.floor(s % 60);
    return m + ':' + (rs < 10 ? '0' : '') + rs;
  }
});