// utils/services/streamThrottle.js
// 流式渲染节流：GLM 流式 chunk 到达频率远高于渲染刷新率，
// 逐个 setData + 全文解析是 O(n²)。该工具按固定间隔合并 chunk，
// 只在 flush 时做一次「增量文本 → 解析/渲染」。
//
// 用法（页面内）：
//   const throttle = createThrottle(100, (delta) => {
//     const newText = that.data.streamingText + delta;
//     that.setData({ streamingText: newText, ... });
//   });
//   onMessage: throttle.push(data.content)
//   done:      const tail = throttle.flushNow(); if (tail) ...; handleDone()
//   stop/卸载: throttle.reset()

/**
 * @param {number} intervalMs 合并窗口（毫秒）
 * @param {function(string):void} flushFn 收到一批增量文本后的回调（delta）
 * @returns {{push: Function, flushNow: Function, reset: Function}}
 */
function createThrottle(intervalMs, flushFn) {
  let pending = '';
  let timer = null;

  function push(chunk) {
    if (!chunk) return;
    pending += chunk;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const delta = pending;
      pending = '';
      flushFn(delta);
    }, intervalMs);
  }

  /**
   * 立即取出未刷新的内容（done/error 前调用），返回 delta 或 null。
   */
  function flushNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return null;
    const delta = pending;
    pending = '';
    return delta;
  }

  function reset() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending = '';
  }

  return {
    push: push,
    flushNow: flushNow,
    reset: reset
  };
}

/**
 * 按渲染帧合并（wx.nextTick）：chunk 到达后尽可能在下一帧渲染前刷一次，
 * 观感接近逐字流动；maxLatencyMs 兜底，保证渲染被挂起时最迟也会刷一次。
 *
 * 与 createThrottle 的区别：createThrottle 固定间隔（可能掉帧/停顿），
 * 帧级节流跟渲染节奏走，适合"查词流式展示"这类对流畅度敏感的场景。
 */
function createFrameThrottle(flushFn, maxLatencyMs) {
  const MAX_LATENCY = maxLatencyMs || 80;
  let pending = '';
  let scheduled = false;
  let maxTimer = null;

  function doFlush() {
    scheduled = false;
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    if (!pending) return;
    const delta = pending;
    pending = '';
    flushFn(delta);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (typeof wx !== 'undefined' && wx.nextTick) {
      wx.nextTick(doFlush);
    } else {
      setTimeout(doFlush, 16);
    }
    maxTimer = setTimeout(() => {
      maxTimer = null;
      doFlush();
    }, MAX_LATENCY);
  }

  function push(chunk) {
    if (!chunk) return;
    pending += chunk;
    schedule();
  }

  function flushNow() {
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    // 重置调度标志：flushNow 后若再有 push（如 done 后残留消息）能重新调度，
    // 否则 pending 会滞留到旧 wx.nextTick 才顺带刷出
    scheduled = false;
    if (!pending) return null;
    const delta = pending;
    pending = '';
    return delta;
  }

  function reset() {
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    pending = '';
  }

  return {
    push: push,
    flushNow: flushNow,
    reset: reset
  };
}

module.exports = { createThrottle, createFrameThrottle };
