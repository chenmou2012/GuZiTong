// scripts/test_translate_cache.js
// 回归测试：翻译命中缓存后 streamingText 必须写回。
// 之前缓存路径的 setData 漏写 streamingText，导致「复制」复制空串、
// 「收藏」提示"请先翻译后再收藏"。

const store = {};
const anim = { opacity: () => anim, step: () => anim, export: () => ({}) };

global.wx = {
  getStorageSync: (key) => store[key],
  setStorageSync: (key, val) => { store[key] = val; },
  removeStorageSync: (key) => { delete store[key]; },
  createAnimation: () => anim,
  showToast: () => {},
  showModal: () => {},
  request: () => {},
  connectSocket: () => ({ onOpen(){}, onMessage(){}, onError(){}, onClose(){}, close(){}, send(){} })
};
global.getApp = () => ({ globalData: { statusBarHeight: 20 } });

let pageInstance = null;
global.Page = function(obj) {
  pageInstance = {
    data: JSON.parse(JSON.stringify(obj.data)),
    setData(updates) {
      Object.assign(this.data, updates);
    },
    ...obj
  };
  return pageInstance;
};

require('../pages/translate/translate.js');

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.error('  ❌ ' + msg);
  }
}

// 模拟缓存命中：直接走 handleTranslateResult({ fromCache: true }) 分支
pageInstance.data.inputText = '学而时习之，不亦说乎';
pageInstance.handleTranslateResult('译文内容：学习并且时常复习，不也很愉快吗？', { fromCache: true });

assert(pageInstance.data.streamingText === '译文内容：学习并且时常复习，不也很愉快吗？', '命中缓存后 streamingText 已写回');
assert(pageInstance.data.fromCache === true, 'fromCache 标记正确');

// 复制功能依赖 streamingText（translate.js 复制时取 this.data.streamingText）
assert(pageInstance.data.streamingText.length > 0, '复制不会拿到空内容');

// 收藏功能依赖 streamingText（collectTranslation 里 !result 会拦截）
pageInstance.collectTranslation();
const translations = require('../utils/services/storage.js').getTranslations();
assert(translations.some(t => t.original === '学而时习之，不亦说乎'), '缓存命中后也能正常收藏');

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
