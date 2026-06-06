// WebSocket 服务

const constants = require('./constants');

let socketTask = null;
let currentHandlers = null;

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
  // 关闭之前的连接
  if (socketTask) {
    socketTask.close();
    socketTask = null;
  }

  currentHandlers = handlers;

  const that = this;
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
      console.error('WebSocket 消息解析失败:', e);
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
  if (socketTask) {
    socketTask.close();
    socketTask = null;
    currentHandlers = null;
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
      console.error('解析失败:', e);
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
      console.error('解析失败:', e);
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