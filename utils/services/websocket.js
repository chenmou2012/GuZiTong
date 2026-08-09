// WebSocket 服务

const constants = require('./constants');
const auth = require('./auth.js');
const logger = require('./logger.js');
const log = logger.for('WS');

let socketTask = null;
let currentHandlers = null;
let currentPath = null;
let reconnectAttempts = 0;
let manualClosed = false;
let reconnectTimer = null;
// 代际计数器：每次 doConnect 递增。被替换关闭的旧连接，其 onClose 回调
// 通过 gen !== generation 识别出自己已过期，不再触发重连（避免双连接并存）。
let generation = 0;
const MAX_RECONNECT = 3;
const BASE_DELAY = 1000;

function getReconnectDelay() {
  return BASE_DELAY * Math.pow(2, reconnectAttempts - 1);
}

function scheduleReconnect() {
  if (manualClosed || reconnectAttempts >= MAX_RECONNECT || reconnectTimer) return;
  reconnectAttempts++;
  const delay = getReconnectDelay();
  log.info('重连第', reconnectAttempts, '/', MAX_RECONNECT, '次，', delay, 'ms 后');
  reconnectTimer = setTimeout(function() {
    reconnectTimer = null;
    if (manualClosed || !currentHandlers || !currentPath) return;
    // 重连必须重新换 ticket：ticket 是一次性消费的，复用旧 ticket 必被后端拒绝
    doConnectWithTicket();
  }, delay);
}

/**
 * 创建 WebSocket 连接（内部负责换取一次性 ticket，URL 里不出现 token）
 * @param {string} path - 路径，如 '/ws/query'
 * @param {object} handlers - 回调处理器
 *   - onOpen(data)
 *   - onMessage(data)
 *   - onError(error)
 *   - onClose()
 *   - onAuthFail() 可选：ticket 换取失败时调用
 * @returns {Promise} 连接建立流程（不阻塞调用方，页面在 onOpen 里 send）
 */
function connect(path, handlers) {
  manualClosed = false;
  reconnectAttempts = 0;
  currentPath = path;
  currentHandlers = handlers;
  return doConnectWithTicket();
}

// 换 ticket → 拼 endpoint → 建立连接。
// 放在本模块：ticket 30s 一次性消费，重连时必须重新换取，页面无需关心。
function doConnectWithTicket() {
  return auth.fetchWsTicket().then(function(ticket) {
    if (manualClosed || !currentHandlers || !currentPath) return null;
    if (!ticket) {
      log.warn('获取 WS ticket 失败');
      if (currentHandlers.onAuthFail) {
        currentHandlers.onAuthFail();
      }
      return null;
    }
    const sep = currentPath.indexOf('?') >= 0 ? '&' : '?';
    const endpoint = currentPath + sep + 'ticket=' + encodeURIComponent(ticket);
    return doConnect(endpoint, currentHandlers);
  });
}

function doConnect(endpoint, handlers) {
  // 代际 +1：让旧连接的所有回调（onClose 等）失效
  const gen = ++generation;

  // 关闭之前的连接
  if (socketTask) {
    const old = socketTask;
    socketTask = null;
    old.close();  // 旧 onClose 触发时 gen 已过期，会被忽略
  }

  currentHandlers = handlers;

  const host = constants.API_BASE_URL.replace('http://', '').replace('https://', '');
  const wsUrl = (constants.API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://') + host + endpoint;

  socketTask = wx.connectSocket({
    url: wsUrl,
    header: {},
    method: 'GET',
    protocols: []
  });

  socketTask.onOpen(function(res) {
    // 被替换关闭的旧连接：忽略延迟回调
    if (gen !== generation) return;
    if (handlers.onOpen) {
      handlers.onOpen(res);
    }
  });

  socketTask.onMessage(function(res) {
    if (gen !== generation) return;
    try {
      const data = JSON.parse(res.data);
      if (handlers.onMessage) {
        handlers.onMessage(data);
      }
    } catch (e) {
      log.error('onMessage 消息解析失败:', e);
    }
  });

  socketTask.onError(function(res) {
    // 旧连接延迟派发的 onError 不得误杀新连接（会导致 wsClient.close + manualClosed）
    if (gen !== generation) return;
    if (handlers.onError) {
      handlers.onError(res);
    }
  });

  socketTask.onClose(function(res) {
    // 被替换关闭的旧连接：忽略，避免对已建立的新连接触发虚假重连
    if (gen !== generation) return;
    // 连接已关闭，清引用（isConnected 据此正确返回 false）
    socketTask = null;
    if (handlers.onClose) {
      handlers.onClose(res);
    }
    scheduleReconnect();
  });

  return socketTask;
}

/**
 * 发送消息
 */
function send(data) {
  if (socketTask) {
    socketTask.send({
      data: typeof data === 'string' ? data : JSON.stringify(data)
    });
  }
}

/**
 * 关闭连接
 */
function close() {
  manualClosed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  if (socketTask) {
    socketTask.close();
    socketTask = null;
    currentHandlers = null;
    currentPath = null;
  }
}

/**
 * 获取当前连接状态
 */
function isConnected() {
  return socketTask !== null;
}

module.exports = {
  connect,
  send,
  close,
  isConnected
};
