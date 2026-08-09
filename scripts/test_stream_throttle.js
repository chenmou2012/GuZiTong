// scripts/test_stream_throttle.js
// streamThrottle 单元测试：chunk 合并、立即取回、reset 丢弃。

const { createThrottle, createFrameThrottle } = require('../utils/services/streamThrottle.js');

// 帧级节流需要 wx.nextTick（Node 下用队列模拟渲染帧）
let nextTickQueue = [];
global.wx = {
  nextTick: (fn) => nextTickQueue.push(fn)
};
function runNextTick() {
  const q = nextTickQueue;
  nextTickQueue = [];
  q.forEach(fn => fn());
}

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ❌ ' + msg);
  }
}

(async function main() {
  console.log('===== TEST 1: 窗口内多个 chunk 合并成一次 flush =====');
  const flushed = [];
  const t = createThrottle(50, (delta) => flushed.push(delta));
  t.push('a');
  t.push('b');
  t.push('c');
  await new Promise(r => setTimeout(r, 120));
  assert(flushed.length === 1, `只 flush 一次 (实际 ${flushed.length})`);
  assert(flushed[0] === 'abc', `合并内容正确 (实际 "${flushed[0]}")`);

  console.log('\n===== TEST 2: flushNow 立即取回未刷新内容 =====');
  const t2 = createThrottle(1000, () => {});
  t2.push('x');
  t2.push('y');
  const tail = t2.flushNow();
  assert(tail === 'xy', 'flushNow 返回累积内容');
  assert(t2.flushNow() === null, 'flushNow 二次调用返回 null');

  console.log('\n===== TEST 3: reset 丢弃未刷新内容且不再触发 =====');
  const flushed3 = [];
  const t3 = createThrottle(50, (delta) => flushed3.push(delta));
  t3.push('q');
  t3.reset();
  await new Promise(r => setTimeout(r, 80));
  assert(flushed3.length === 0, 'reset 后不再触发 flush');

  console.log('\n===== TEST 4: createFrameThrottle 按帧合并（wx.nextTick） =====');
  const frameFlushed = [];
  const ft = createFrameThrottle((delta) => frameFlushed.push(delta), 1000);
  ft.push('a');
  ft.push('b');
  runNextTick();
  assert(frameFlushed.length === 1, `帧合并只 flush 一次 (实际 ${frameFlushed.length})`);
  assert(frameFlushed[0] === 'ab', `帧合并内容正确 (实际 "${frameFlushed[0]}")`);

  console.log('\n===== TEST 5: createFrameThrottle flushNow / reset =====');
  ft.push('c');
  assert(ft.flushNow() === 'c', '帧节流 flushNow 返回累积内容');
  runNextTick();  // 消费 flushNow 遗留的 tick（无内容，no-op）
  ft.push('d');
  ft.reset();
  runNextTick();
  assert(frameFlushed.length === 1, '帧节流 reset 后不再触发');

  console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ❌`);
  process.exit(failed === 0 ? 0 : 1);
})();
