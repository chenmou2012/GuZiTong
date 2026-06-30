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
    setTimeout(() => {
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
      setTimeout(() => {
        this.setData({ loadingTip: '已缓存 · ' + ageStr });
        this.handleQueryResult(cached.result, { fromCache: true });
      }, 400);
      return;
    }

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
      }, 45000);  // GLM-4.5-Air 推理慢，留更多时间
    }

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
        wsClient.send({ text: query, example: example, context: context });
        log.info('[query] 请求已发送');
        // P0-6：兜底 connect-wait watchdog —— onOpen 后 N 秒内若没收到任何消息，
        // 视为后端握手后异常，强制收尾
        clearWatchdog();
        watchdog = setTimeout(() => {
          log.warn('[query] connect-wait watchdog 触发，强制收尾');
          if (!that.data.isLoading) return;
          wsClient.close();
          that.setData({ isLoading: false });
          wx.hideLoading();
          errorUi.showRetryError('查询无响应，请重试', () => that.searchWord());
        }, 30000);  // GLM-4.5-Air 首token 可能 10-20s，留 30s 余量
      },
      onMessage: function(data) {
        const elapsed = wsStartTime ? Date.now() - wsStartTime : -1;
        log.info(`[query] 收到 ${data.type} (${elapsed}ms)`);
        if (data.error) {
          wx.hideLoading();
          clearWatchdog();
          wsClient.close();
          that.setData({ isLoading: false });
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
          // 流式中累积式结构化解析：每解析出一个完整义项就立即多一张卡片
          // 关键：永不回退（parsedResult 取 max(已有, 新)），避免 fallback 闪烁
          const parsed = markdown.parseMarkdown(newText);
          const existing = that.data.parsedResult || { pinyin: '', meanings: [], raw: '' };
          let finalParsed = existing;
          if (parsed && parsed.meanings.length >= existing.meanings.length) {
            // 新解析的义项更多（或首次解析）→ 采用新的
            finalParsed = parsed;
          }
          // 否则保留 existing（避免回退导致的卡片消失/闪烁）
          that.setData({
            streamingText: newText,
            resultHtml: markdown.markdownToHtml(newText),
            parsedResult: finalParsed,
            showResult: true,
            isLoading: false
          });
          // P0-6：收到 content，重置 idle watchdog
          armIdleWatchdog();
        }

        if (data.type === 'done') {
          log.info(`完成: ${Date.now() - wsStartTime}ms`);
          clearWatchdog();
          that.handleQueryResult(that.data.streamingText);
        }
      },
      onError: function(res) {
        log.error('连接错误:', res);
        wx.hideLoading();
        clearWatchdog();
        wsClient.close();
        that.setData({ isLoading: false });
        errorUi.showRetryError('网络错误，请稍后重试', () => that.searchWord());
      },
      onClose: function(res) {
        log.info('连接关闭:', res);
        // 由 wsClient 处理重连
      }
    });
    });  // P0-3: 闭合 fetchWsTicket().then
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

  onPullDownRefresh: function() {
    wsClient.close();
    this.setData({
      inputText: '',
      showResult: false,
      result: {},
      resultHtml: '',
      streamingText: '',
      inputCollapsed: false,
      showRealWordsSection: true,
      showRealWordsPicker: false,
      pickerIndex: -1
    });
    wx.stopPullDownRefresh();
  },

  onUnload: function() {
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