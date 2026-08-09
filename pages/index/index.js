// pages/index/index.js
const constants = require('../../utils/services/constants');
const storage = require('../../utils/services/storage');
const markdown = require('../../utils/services/markdown');
const wsClient = require('../../utils/services/websocket.js');
const auth = require('../../utils/services/auth.js');
const errorUi = require('../../utils/services/error.js');
const logger = require('../../utils/services/logger.js');
const { startStreamQuery } = require('../../utils/services/streamQuery.js');
const log = logger.for('query');

const { REAL_WORDS, HIGH_FREQ_REAL_WORDS } = constants;

Page({
  data: {
    inputText: '',
    contextText: '',     // 上下文（可选）：短文本当例句、长文本当原句/出处
    currentQuery: '',
    showResult: false,
    isLoading: false,
    showError: false,
    errorMessage: '',
    result: {},
    resultHtml: '',
    parsedResult: null,     // 结构化解析结果：{ pinyin, meanings: [{pos, meaning, example, source}] }
    isCollected: false,
    loadingTip: '正在查询...',  // loading 文案，10s 后切换为「AI 思考中...」
    fromCache: false,       // 当前结果是否来自缓存
    hasHistory: false,
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
    try {
      this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
      this.checkHistory();
    } catch (e) {
      log.error('[index.onLoad] failed:', e);
    }
  },

  onShow: function() {
    try {
      // 保留当前结果（从收藏详情/历史页返回时不清空，避免已查内容消失）
      const pendingQuery = storage.getPendingQuery();
      storage.clearPendingQuery();

      if (pendingQuery) {
        this.setData({ inputText: pendingQuery });
        this.searchWord();
        return;
      }
      // 有结果时刷新收藏状态（跨页取消收藏后回到本页也能正确显示）
      if (this.data.showResult && this.data.inputText) {
        this.setData({ isCollected: storage.isCollected(this.data.inputText.trim()) });
      }
      this.checkHistory();
    } catch (e) {
      log.error('[index.onShow] failed:', e);
    }
  },

  onInputChange: function(e) {
    this.setData({
      inputText: e.detail.value
    });
  },

  // 上下文输入：短文本当例句（优先按此释义），长文本当原句/出处（多音字消歧）
  onContextChange: function(e) {
    this.setData({
      contextText: e.detail.value
    });
  },

  clearInput: function() {
    this.setData({
      inputText: '',
      contextText: '',
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
    // 上一轮未清掉的流式查询先复位，避免旧回调污染新一轮
    if (this._streamQuery) {
      this._streamQuery.dispose();
      this._streamQuery = null;
    }
    // 清掉上一轮未触发的缓存展示 / loading 文案 timer：
    // 用户快速连查时，旧 timer 触发会把上一轮的缓存结果写进 UI 甚至掐断新 WS 连接
    if (this._cacheTimer) { clearTimeout(this._cacheTimer); this._cacheTimer = null; }
    if (this._loadingTipTimer) { clearTimeout(this._loadingTipTimer); this._loadingTipTimer = null; }

    let query = this.data.inputText.trim();
    // 上下文（可选，maxlength 200）：自动按长度归类
    // - 短文本（≤ 50 字）：当例句，发 example 字段，AI 优先按此释义
    // - 长文本（> 50 字）：当原句/出处，发 context 字段，AI 用于多音字消歧 + 出处定位
    const rawContext = (this.data.contextText || '').trim().slice(0, 200);
    const isShort = rawContext.length > 0 && rawContext.length <= 50;
    const example = isShort ? rawContext : '';
    const context = isShort ? '' : rawContext;
    log.debug('query:', query, 'rawContext:', rawContext, 'classified as:', isShort ? 'example' : 'context');

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

    // 上下文一致性检查：用户填了来源/出处但查的字不在里面，提示一下
    // _forceSearch 是用户点「继续查询」的标记，避免递归弹 modal
    if (rawContext && query && !rawContext.includes(query) && !this._forceSearch) {
      const that = this;
      wx.showModal({
        title: '提示',
        content: '您查询的字「' + query + '」不在输入的来源/出处中，是否仍要查询？',
        confirmText: '继续查询',
        cancelText: '重新输入',
        success: (res) => {
          if (res.confirm) {
            that._forceSearch = true;
            that.searchWord();
          }
        }
      });
      return;
    }
    this._forceSearch = false;  // 走完正常流程后重置标志

    // 关闭之前的 WebSocket
    wsClient.close();

    // 每次开始生成前清空上一轮的内容，避免义项卡片/缓存标记/计时残留
    this._isQueryActive = true;  // 流式进行中标志（watchdog 收尾判断用，isLoading 首包后会变 false）
    this.setData({
      isLoading: true,
      showResult: false,
      showError: false,
      inputCollapsed: true,
      streamingText: '',
      resultHtml: '',
      parsedResult: null,        // 清空上次的义项卡片
      elapsedTime: 0,           // 清空上次的耗时
      fromCache: false,         // 清空上次的缓存标记
      loadingTip: '正在查询...'
    });

    // 5s 后切换 loading 文案（GLM-4.5-Air 慢，提示用户 AI 在思考）
    this._loadingTipTimer = setTimeout(() => {
      this._loadingTipTimer = null;
      if (this.data.isLoading) {
        this.setData({ loadingTip: 'AI 思考中...' });
      }
    }, 5000);

    // 查缓存：命中 → 直接展示（不调 AI，秒级响应）
    // 缓存键：word（不含 example/context，因为缓存的 result 是普通解释，例句/上下文场景需要重新生成）
    const cached = storage.getCachedWord(query);
    if (cached) {
      log.info('[query] 命中缓存，跳过 AI 生成', { word: query, cacheTime: cached.time });
      const ageStr = this._formatCacheAge(Date.now() - cached.time);
      this.setData({
        loadingTip: '已缓存（' + ageStr + '前查过）'
      });
      // 短暂显示缓存提示，再展示结果
      this._cacheTimer = setTimeout(() => {
        this._cacheTimer = null;
        this.setData({ loadingTip: '已缓存 · ' + ageStr });
        this.handleQueryResult(cached.result, { fromCache: true });
      }, 400);
      return;
    }

    wx.showLoading({ title: '正在查询...', mask: true });

    const that = this;
    log.debug('发送数据: text=' + query);

    // P0-3/P0-6: 统一流式查询封装（ticket 换取、双层 watchdog、帧级节流、错误收尾）
    that._streamQuery = startStreamQuery({
      path: '/ws/query',
      tag: 'query',
      throttleMode: 'frame',          // 查词对流畅度敏感，用帧级节流
      idleTimeoutMs: 45000,           // GLM-4.5-Air 推理慢，idle 留更多时间
      connectWaitTimeoutMs: 30000,    // 首 token 可能 10-20s，留 30s 余量
      retryMessage: '查询超时，请重试',
      send: () => wsClient.send({ text: query, example: example, context: context }),
      isActive: () => that._isQueryActive,
      finish: () => {
        that._isQueryActive = false;
        that.setData({ isLoading: false });
      },
      onStartMsg: () => that.setData({ streamingText: '', resultHtml: '', parsedResult: null }),  // 重连后清空旧内容，避免两轮拼接重复
      onDelta: (delta) => {
        const newText = that.data.streamingText + delta;
        const parsed = markdown.parseMarkdown(newText);
        const existing = that.data.parsedResult || { pinyin: '', meanings: [], raw: '' };
        const finalParsed = (parsed && parsed.meanings.length >= existing.meanings.length)
          ? parsed
          : existing;
        const hasCards = !!(finalParsed && finalParsed.meanings.length > 0);
        const patch = {
          streamingText: newText,
          parsedResult: finalParsed,
          showResult: true,
          isLoading: false
        };
        // 结构化卡片已就绪时 fallback HTML 用不上，不再每块重算
        if (!hasCards) {
          patch.resultHtml = markdown.markdownToHtml(newText);
        }
        that.setData(patch);
      },
      onDone: (tail) => {
        // 先取回未刷新的尾包，保证 streamingText 完整
        if (tail) {
          that.data.streamingText += tail;
        }
        log.info('[query] 完成');
        that.handleQueryResult(that.data.streamingText);
      },
      onRetry: () => that.searchWord(),
      onFirstContent: (wsStartTime) => {
        log.info(`[query] 首token: ${Date.now() - wsStartTime}ms`);
      }
    });
  },

  handleQueryResult: function(content, options) {
    const animation = wx.createAnimation({
      duration: 400,
      timingFunction: 'ease-out'
    });
    animation.opacity(1).translateY(0).step();

    // 结构化解析：读音 + 义项列表
    const parsed = markdown.parseMarkdown(content) || { pinyin: '', meanings: [], raw: content };
    const html = markdown.markdownToHtml(content);

    // 写缓存（只有非缓存来源、AI 真实生成时才写；缓存命中时跳过）
    const fromCache = options && options.fromCache;
    if (!fromCache) {
      const cached = storage.setCachedWord(this.data.inputText.trim(), content);
      log.info('[query] 已写入缓存', { word: this.data.inputText.trim() });
    }

    this.setData({
      isLoading: false,
      showResult: true,
      result: { content },
      resultHtml: html,
      parsedResult: parsed.meanings && parsed.meanings.length > 0 ? parsed : null,
      streamingText: content,
      fromCache: !!fromCache,
      inputCollapsed: true,
      resultAnimation: animation.export(),
      // 查完后同步收藏状态（跨页取消收藏后回到本页也能正确显示）
      isCollected: storage.isCollected(this.data.inputText.trim())
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
    const word = this.data.inputText.trim();
    const result = this.data.streamingText;
    // 必须先查询（有结果）才能收藏
    if (!word || !result) {
      wx.showToast({ title: '请先查询后再收藏', icon: 'none' });
      return;
    }
    const ret = storage.toggleCollection(word, result);
    this.setData({ isCollected: ret.collected });
    wx.showToast({ title: ret.collected ? '收藏成功' : '已取消收藏', icon: 'success' });
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
    if (this._streamQuery) {
      this._streamQuery.dispose();
      this._streamQuery = null;
    }
    // 缓存命中 400ms 窗口内点「停止/清空」也要取消 timer，否则旧缓存结果仍会写回 UI
    if (this._cacheTimer) { clearTimeout(this._cacheTimer); this._cacheTimer = null; }
    if (this._loadingTipTimer) { clearTimeout(this._loadingTipTimer); this._loadingTipTimer = null; }
    if (this.data.isLoading) {
      // 停止输出
      wsClient.close();
      wx.hideLoading();
      this.setData({
        isLoading: false,
        showResult: false,
        streamingText: '',
        inputCollapsed: false,

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
        inputCollapsed: false,
        isCollected: false
      });
    }
  },

  onUnload: function() {
    if (this._cacheTimer) { clearTimeout(this._cacheTimer); this._cacheTimer = null; }
    if (this._loadingTipTimer) { clearTimeout(this._loadingTipTimer); this._loadingTipTimer = null; }
    if (this._streamQuery) {
      this._streamQuery.dispose();
      this._streamQuery = null;
    }
    wsClient.close();
  },

  // 格式化缓存时长：「刚刚 / X 分钟前 / X 小时前 / X 天前」
  _formatCacheAge: function(ms) {
    if (!ms || ms < 0) return '';
    if (ms < 60 * 1000) return '刚刚';
    if (ms < 60 * 60 * 1000) return Math.floor(ms / 60000) + ' 分钟前';
    if (ms < 24 * 60 * 60 * 1000) return Math.floor(ms / 3600000) + ' 小时前';
    return Math.floor(ms / 86400000) + ' 天前';
  }
});
