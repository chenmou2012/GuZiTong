// utils/services/streamQuery.js
// 流式 WS 查询的统一封装：消除 index / translate / collection-detail /
// translation-detail 四个页面各自 ~150 行的重复逻辑（watchdog、ticket 换取、
// 首包处理、throttle 生命周期、错误/超时收尾），避免行为四处漂移。
//
// 用法（页面内）：
//   this._streamQuery = startStreamQuery({
//     path: '/ws/query',
//     tag: 'query',
//     send: () => wsClient.send({ text: query }),
//     onDelta: (delta) => { /* 增量文本 → setData 渲染 */ },
//     onDone: (tail) => { /* 完成：tail 是未刷新的尾包，页面拼进 streamingText */ },
//     onRetry: () => this.searchWord(),
//     isActive: () => this.data.isLoading,
//     finish: () => this.setData({ isLoading: false }),
//     idleTimeoutMs: 45000,
//     connectWaitTimeoutMs: 30000,
//     retryMessage: '查询超时，请重试',
//     throttleMode: 'frame',          // 'frame' | 'interval'
//     onFirstContent: (wsStartTime) => {},  // 可选：首个 content 时
//     onStartMsg: () => {},                // 可选：收到 type=start 时
//   });
//   // 页面 onUnload / stopOrClear 里：
//   if (this._streamQuery) { this._streamQuery.dispose(); this._streamQuery = null; }

const wsClient = require('./websocket.js');
const errorUi = require('./error.js');
const logger = require('./logger.js');
const { createThrottle, createFrameThrottle } = require('./streamThrottle.js');

/**
 * 启动一次带双层 watchdog 的 WS 流式查询。
 * 统一负责：ticket 换取（websocket.connect 内部）、idle + connect-wait 双 watchdog、
 * 首包 hideLoading 与计时、throttle 生命周期、错误/超时收尾与重试弹窗。
 *
 * @returns {{throttle, reset, close, dispose}}
 */
function startStreamQuery(opts) {
  const {
    path,                 // WS 路径，如 '/ws/query'
    tag,                  // 日志前缀，如 'query'
    send,                 // function(): onOpen 时发送请求
    onDelta,              // function(delta): 节流回调（增量文本 → 渲染）
    onDone,               // function(tail): 收到 done 时（tail 为未刷新的尾包）
    onRetry,              // function(): 重试函数（searchWord / translateText / regenerate）
    isActive,             // function(): 当前是否进行中（watchdog 据此决定是否收尾）
    finish,               // function(): 收尾动作（把 isLoading / isRegenerating 置 false）
    idleTimeoutMs = 15000,
    connectWaitTimeoutMs = 10000,
    retryMessage = '查询超时，请重试',
    throttleMode = 'interval',   // 'frame' | 'interval'
    throttleInterval = 100,
    onFirstContent,       // 可选 function(wsStartTime)
    onStartMsg,           // 可选 function(): 收到 type=start 时
  } = opts;

  const log = logger.for('stream');
  let watchdog = null;
  let gotFirstContent = false;
  let wsStartTime = null;

  function clearWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  }

  function armIdleWatchdog() {
    clearWatchdog();
    watchdog = setTimeout(function() {
      log.warn('[' + tag + '] idle watchdog 触发，强制收尾');
      if (!isActive()) return;
      throttle.reset();
      wsClient.close();
      finish();
      wx.hideLoading();
      errorUi.showRetryError(retryMessage, onRetry);
    }, idleTimeoutMs);
  }

  function cleanup() {
    clearWatchdog();
    throttle.reset();
  }

  // 流式渲染节流：GLM chunk 几十毫秒一个，逐块全文解析 + setData 是 O(n²)。
  // 帧级（wx.nextTick）/ 固定间隔两种模式，与各页原有体验保持一致。
  const throttle = throttleMode === 'frame'
    ? createFrameThrottle(function(delta) {
        onDelta(delta);
        armIdleWatchdog();
      })
    : createThrottle(throttleInterval, function(delta) {
        onDelta(delta);
        armIdleWatchdog();
      });

  wsClient.connect(path, {
    onOpen: function() {
      wsStartTime = Date.now();
      send();
      // connect-wait watchdog：onOpen 后 N 秒内无任何消息视为后端握手后异常
      clearWatchdog();
      watchdog = setTimeout(function() {
        log.warn('[' + tag + '] connect-wait watchdog 触发，强制收尾');
        if (!isActive()) return;
        throttle.reset();
        wsClient.close();
        finish();
        wx.hideLoading();
        errorUi.showRetryError(retryMessage, onRetry);
      }, connectWaitTimeoutMs);
    },
    onMessage: function(data) {
      // 兼容旧后端的 message 字段；新协议统一使用 error。
      const errorMessage = data.error || (data.type === 'error' && data.message);
      if (errorMessage) {
        cleanup();
        wsClient.close();
        wx.hideLoading();
        finish();
        errorUi.showRetryError(errorMessage, onRetry);
        return;
      }
      if (data.type === 'start') {
        if (onStartMsg) onStartMsg();
        return;
      }
      if (data.type === 'content') {
        if (!gotFirstContent) {
          gotFirstContent = true;
          wx.hideLoading();
          if (onFirstContent) onFirstContent(wsStartTime);
        }
        throttle.push(data.content);
        return;
      }
      if (data.type === 'done') {
        wx.hideLoading();
        // 先取尾包再收尾：cleanup 内的 throttle.reset 会清空 pending，
        // 顺序反了的话 onDone 的 tail 恒为 null（尾包丢失）
        const tail = throttle.flushNow();
        cleanup();
        if (onDone) onDone(tail);
        return;
      }
    },
    onError: function(res) {
      log.error('[' + tag + '] 连接错误:', res);
      cleanup();
      wsClient.close();
      wx.hideLoading();
      finish();
      if (opts.onError) opts.onError(res);
      else errorUi.showRetryError('网络错误，请稍后重试', onRetry);
    },
    onClose: function() {
      // 重连由 websocket.js 内部处理（自动换新 ticket）
    },
    onAuthFail: function() {
      log.warn('[' + tag + '] 换取 ticket 失败');
      wx.hideLoading();
      finish();
      errorUi.showRetryError('网络错误，请稍后重试', onRetry);
    }
  });

  return {
    throttle: throttle,
    reset: cleanup,
    close: wsClient.close,
    dispose: function() {
      cleanup();
      wsClient.close();
    }
  };
}

module.exports = { startStreamQuery };
