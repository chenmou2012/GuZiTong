// scripts/test_logger.js
// 验证 logger.js 的行为

const storage = {};
let devLogFlag = true;
let logCalls = [];

const mockWx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, val) => { storage[key] = val; },
  removeStorageSync: (key) => { delete storage[key]; },
};

global.wx = mockWx;

const _origConsole = {
  debug: console.debug,
  log: console.log,
  warn: console.warn,
  error: console.error,
};
console.debug = (...a) => logCalls.push(['debug', ...a]);
console.log    = (...a) => logCalls.push(['log', ...a]);
console.warn   = (...a) => logCalls.push(['warn', ...a]);
console.error  = (...a) => logCalls.push(['error', ...a]);

const logger = require('../utils/services/logger.js');

let pass = 0, fail = 0;
function assertEq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.error(`[OK] ${name}`);
  } else {
    fail++;
    console.error(`[FAIL] ${name}: expected ${e}, got ${a}`);
  }
}

function reset() { logCalls = []; }

// ===== TEST 1: debug 默认开 =====
logger.debug('test', 123);
assertEq('debug 默认开 → 走 console.debug',
  logCalls[0] && logCalls[0][0] === 'debug' && logCalls[0].slice(1).join(' '),
  '[app] test 123'
);
reset();

// ===== TEST 2: setDev(false) 后 debug 静默 =====
logger.setDev(false);
logger.debug('silent');
assertEq('setDev(false) 后 debug 静默', logCalls.length, 0);
logger.setDev(true);
reset();

// ===== TEST 3: 通过 wx.setStorageSync('__devLog', false) 关闭 debug =====
mockWx.setStorageSync('__devLog', false);
logger.debug('should be silent');
assertEq('__devLog=false 关闭 debug', logCalls.length, 0);
mockWx.setStorageSync('__devLog', true);
reset();

// ===== TEST 4: warn 永远走 console.warn =====
logger.warn('w');
assertEq('warn 走 console.warn', logCalls.map(c => c[0]), ['warn']);
reset();

// ===== TEST 5: error 永远走 console.error =====
logger.error('e');
assertEq('error 走 console.error', logCalls.map(c => c[0]), ['error']);
reset();

// ===== TEST 6: logger.for('foo').info('x') 输出 [foo] x =====
logger.for('foo').info('x');
assertEq('for(tag).info 输出 [foo] x',
  logCalls[0] && logCalls[0].slice(1).join(' '),
  '[foo] x'
);
reset();

// ===== TEST 7: 各 level 映射正确 =====
logger.for('t').debug('d');
logger.for('t').info('i');
logger.for('t').warn('w');
logger.for('t').error('e');
assertEq('4 level 全部映射',
  logCalls.map(c => c[0]),
  ['debug', 'log', 'warn', 'error']
);
reset();

console.error(`\n===== 通过 ${pass} / 失败 ${fail} =====`);
process.exit(fail === 0 ? 0 : 1);