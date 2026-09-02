// 验证流式查询能处理新旧后端的错误字段。

const wsPath = require.resolve('../utils/services/websocket.js');
const errorPath = require.resolve('../utils/services/error.js');

let handlers;
let displayedError;

global.wx = {
  getStorageSync: () => true,
  nextTick: (fn) => fn(),
  hideLoading: () => {},
  showModal: () => {}
};

require.cache[wsPath] = {
  id: wsPath,
  filename: wsPath,
  loaded: true,
  exports: {
    connect: (_path, nextHandlers) => { handlers = nextHandlers; },
    close: () => {},
    send: () => {},
    isConnected: () => true
  }
};
require.cache[errorPath] = {
  id: errorPath,
  filename: errorPath,
  loaded: true,
  exports: {
    showRetryError: (message) => { displayedError = message; }
  }
};

const { startStreamQuery } = require('../utils/services/streamQuery.js');

function makeQuery() {
  startStreamQuery({
    path: '/ws/query',
    tag: 'test',
    send: () => {},
    onDelta: () => {},
    onDone: () => {},
    onRetry: () => {},
    isActive: () => true,
    finish: () => {}
  });
}

function assertErrorPayload(payload, expected) {
  displayedError = null;
  makeQuery();
  handlers.onMessage(payload);
  if (displayedError !== expected) {
    throw new Error(`错误未正确显示：expected=${expected}, actual=${displayedError}`);
  }
}

assertErrorPayload(
  { type: 'error', error: 'AI 服务暂不可用，请重试' },
  'AI 服务暂不可用，请重试'
);
assertErrorPayload(
  { type: 'error', message: '旧后端错误消息' },
  '旧后端错误消息'
);

console.log('STREAM_QUERY_ERROR_FIELDS_OK');
