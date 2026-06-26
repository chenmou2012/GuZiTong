// WebSocket 服务

const constants = require('./constants');
const logger = require('./logger.js');
const log = logger.for('WS');

let socketTask = null;
let currentHandlers = null;
let currentEndpoint = null;
let reconnectAttempts = 0;
let manualClosed = false;
let reconnectTimer = null;
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
    if (manualClosed || !currentHandlers || !currentEndpoint) return;
    doConnect(currentEndpoint, currentHandlers);
  }, delay);
}

/**
 * 创建 WebSocket 连接
 * @param {string} endpoint - 端点，如 '/ws/query'
 * @param {object} handlers - 回调处理器
 *   - onOpen(data)
 *   - onMessage(data)
 *   - onError(error)
 *   - onClose()
 */
function connect(endpoint, handlers) {
  manualClosed = false;
  reconnectAttempts = 0;
  currentEndpoint = endpoint;
  return doConnect(endpoint, handlers);
}

function doConnect(endpoint, handlers) {
  // 关闭之前的连接
  if (socketTask) {
    socketTask.close();
    socketTask = null;
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
    if (handlers.onOpen) {
      handlers.onOpen(res);
    }
  });

  socketTask.onMessage(function(res) {
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
    if (handlers.onError) {
      handlers.onError(res);
    }
  });

  socketTask.onClose(function(res) {
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
    currentEndpoint = null;
  }
}

/**
 * 获取当前连接状态
 */
function isConnected() {
  return socketTask !== null;
}

/**
 * 通用查询方法
 */
function query(word, onContent, onDone, onError) {
  const host = constants.API_BASE_URL.replace('http://', '').replace('https://', '');
  const wsUrl = (constants.API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://') + host + '/ws/query';

  close();

  let streamingText = '';

  socketTask = wx.connectSocket({
    url: wsUrl,
    header: {},
    method: 'GET',
    protocols: []
  });

  socketTask.onOpen(function() {
    send({ text: word });
  });

  socketTask.onMessage(function(res) {
    try {
      const data = JSON.parse(res.data);

      if (data.error) {
        if (onError) onError(data.error);
        close();
        return;
      }

      if (data.type === 'content') {
        streamingText += data.content;
        if (onContent) onContent(streamingText);
        return;
      }

      if (data.type === 'done') {
        if (onDone) onDone(streamingText);
        close();
        return;
      }
    } catch (e) {
      log.error('query 消息解析失败:', e);
    }
  });

  socketTask.onError(function(res) {
    if (onError) onError('网络错误');
    close();
  });

  socketTask.onClose(function() {
    if (streamingText && onDone) {
      onDone(streamingText);
    }
  });

  return {
    close: close,
    getText: function() { return streamingText; }
  };
}

/**
 * 通用翻译方法
 */
function translate(text, onContent, onDone, onError) {
  const host = constants.API_BASE_URL.replace('http://', '').replace('https://', '');
  const wsUrl = (constants.API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://') + host + '/ws/translate';

  close();

  let streamingText = '';

  socketTask = wx.connectSocket({
    url: wsUrl,
    header: {},
    method: 'GET',
    protocols: []
  });

  socketTask.onOpen(function() {
    send({ text: text });
  });

  socketTask.onMessage(function(res) {
    try {
      const data = JSON.parse(res.data);

      if (data.error) {
        if (onError) onError(data.error);
        close();
        return;
      }

      if (data.type === 'start') {
        streamingText = '';
        return;
      }

      if (data.type === 'content') {
        streamingText += data.content;
        if (onContent) onContent(streamingText);
        return;
      }

      if (data.type === 'done') {
        if (onDone) onDone(streamingText);
        close();
        return;
      }
    } catch (e) {
      log.error('translate 消息解析失败:', e);
    }
  });

  socketTask.onError(function(res) {
    if (onError) onError('网络错误');
    close();
  });

  socketTask.onClose(function() {
    if (streamingText && onDone) {
      onDone(streamingText);
    }
  });

  return {
    close: close,
    getText: function() { return streamingText; }
  };
}

module.exports = {
  connect,
  send,
  close,
  isConnected,
  query,
  translate
};