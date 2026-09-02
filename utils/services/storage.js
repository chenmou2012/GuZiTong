// Storage 服务
// 学习进度/复习相关统一由 sm2.js 负责，本文件只保留检索记录、收藏、翻译、学习列表等
// 云开发已彻底移除：所有云同步走 FastAPI 后端
const sm2 = require('./sm2.js');
const logger = require('./logger.js');
const log = logger.for('storage');
const fullSyncLog = logger.for('fullSync');

const STORAGE_KEYS = {
  SEARCH_HISTORY: 'searchHistory',
  COLLECTIONS: 'collections',
  TRANSLATIONS: 'translations',
  PENDING_QUERY: 'pendingQuery',
  PENDING_TRANSLATION: 'pendingTranslation',
  LEARN_LIST: 'learnList',  // 学习列表（随机排列）
  WORD_CACHE: 'wordCache',  // 查词结果缓存（避免重复调 AI）
  TRANSLATION_CACHE: 'translationCache'  // 翻译结果缓存（避免重复调 AI）
};

const MAX_ITEMS = 50;
const MAX_CACHE_ENTRIES = 60;          // 查词/翻译缓存条目上限（防止无限膨胀撞 1MB 白名单）
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天未使用即淘汰

// ==================== 检索历史 ====================

function getHistory() {
  return wx.getStorageSync(STORAGE_KEYS.SEARCH_HISTORY) || [];
}

function saveHistory(word, content) {
  let history = getHistory();
  history = history.filter(item => item.word !== word);
  history.unshift({ word: word, content: content, time: Date.now() });
  if (history.length > MAX_ITEMS) {
    history = history.slice(0, MAX_ITEMS);
  }
  wx.setStorageSync(STORAGE_KEYS.SEARCH_HISTORY, history);

  // 云开发已移除：历史记录只存本地，需要时由后端接口统一拉取
  syncDataToServer('search', 'history', history);
  return history;
}

function clearHistory() {
  wx.setStorageSync(STORAGE_KEYS.SEARCH_HISTORY, []);
  syncDataToServer('search', 'history', []);
}

function removeHistory(word) {
  let history = getHistory();
  history = history.filter(item => item.word !== word);
  wx.setStorageSync(STORAGE_KEYS.SEARCH_HISTORY, history);
  syncDataToServer('search', 'history', history);
  return history;
}

// ==================== 收藏 ====================

function getCollections() {
  return wx.getStorageSync(STORAGE_KEYS.COLLECTIONS) || [];
}

function addCollection(word, result) {
  let collections = getCollections();
  collections.push({ word: word, result: result, time: Date.now() });
  wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, collections);
  syncDataToServer('learn', 'collections', collections);
  return collections;
}

function removeCollection(word) {
  let collections = getCollections();
  const index = collections.findIndex(item => item.word === word);
  if (index > -1) {
    collections.splice(index, 1);
  }
  wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, collections);
  syncDataToServer('learn', 'collections', collections);
  return collections;
}

function isCollected(word) {
  let collections = getCollections();
  return collections.some(item => item.word === word);
}

// 更新已收藏字的 result（保留原 time），用于「重新生成」功能
function updateCollection(word, result) {
  let collections = getCollections();
  const index = collections.findIndex(item => item.word === word);
  if (index === -1) return null;
  collections[index] = { ...collections[index], result: result };
  wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, collections);
  syncDataToServer('learn', 'collections', collections);
  return collections[index];
}

function toggleCollection(word, result) {
  let collections = getCollections();
  const index = collections.findIndex(item => item.word === word);

  if (index > -1) {
    collections.splice(index, 1);
  } else {
    collections.push({ word: word, result: result, time: Date.now() });
  }
  wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, collections);
  syncDataToServer('learn', 'collections', collections);
  return { collected: index === -1, collections };
}

/**
 * 一键清空收藏：单次落盘 + 单次云端同步。
 * （之前页面循环 removeCollection 会产生 N 次 storage 写入和 N 次网络 PUT）
 */
function clearCollections() {
  wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, []);
  syncDataToServer('learn', 'collections', []);
  return [];
}

// ==================== 查词结果缓存 ====================
//
// 缓存结构：{ word: { result, time } }
// - 命中：searchWord 直接展示缓存，不调 AI
// - 写：handleQueryResult（done 时）写入

function getWordCache() {
  return wx.getStorageSync(STORAGE_KEYS.WORD_CACHE) || {};
}

function getCachedWord(word) {
  const cache = getWordCache();
  return cache[word] || null;
}

function setCachedWord(word, result) {
  const cache = getWordCache();
  cache[word] = { result: result, time: Date.now() };
  pruneCache(cache);
  wx.setStorageSync(STORAGE_KEYS.WORD_CACHE, cache);
  // 异步推云端（fire-and-forget，失败不阻塞）
  syncDataToServer('learn', 'wordCache', cache);
  return cache[word];
}

function getWordCacheMeta(word) {
  const cached = getCachedWord(word);
  if (!cached) return null;
  return { hasCache: true, time: cached.time, ageMs: Date.now() - (cached.time || 0) };
}

// 删除单条查词缓存（"重查"功能用：清掉缓存后下次会调 AI）
function invalidateCachedWord(word) {
  if (!word) return;
  const cache = getWordCache();
  if (!cache[word]) return;
  delete cache[word];
  wx.setStorageSync(STORAGE_KEYS.WORD_CACHE, cache);
  syncDataToServer('learn', 'wordCache', cache);
}

/** 一键清空查词缓存（单次落盘 + 单次同步） */
function clearWordCache() {
  wx.setStorageSync(STORAGE_KEYS.WORD_CACHE, {});
  syncDataToServer('learn', 'wordCache', {});
}

// ==================== 翻译结果缓存 ====================
//
// 缓存结构：{ text: { result, time } }
// - 命中：translateText 直接展示缓存，不调 AI
// - 写：handleTranslateResult（done 时）写入
// （与 wordCache 完全对称的设计）

function getTranslationCache() {
  return wx.getStorageSync(STORAGE_KEYS.TRANSLATION_CACHE) || {};
}

function getCachedTranslation(text) {
  const cache = getTranslationCache();
  return cache[text] || null;
}

function setCachedTranslation(text, result) {
  const cache = getTranslationCache();
  cache[text] = { result: result, time: Date.now() };
  pruneCache(cache);
  wx.setStorageSync(STORAGE_KEYS.TRANSLATION_CACHE, cache);
  // 异步推云端（fire-and-forget，失败不阻塞）
  syncDataToServer('learn', 'translationCache', cache);
  return cache[text];
}

/**
 * 缓存淘汰：超过 30 天的条目先删；仍超上限时删最旧的，保证总大小可控。
 */
function pruneCache(cache) {
  const now = Date.now();
  let entries = Object.keys(cache).map(key => ({ key, time: cache[key].time || 0 }));
  const expired = entries.filter(e => e.time && now - e.time > MAX_CACHE_AGE_MS);
  expired.forEach(e => delete cache[e.key]);
  entries = entries.filter(e => !expired.includes(e));
  if (entries.length <= MAX_CACHE_ENTRIES) return;
  entries.sort((a, b) => a.time - b.time);
  entries.slice(0, entries.length - MAX_CACHE_ENTRIES).forEach(e => delete cache[e.key]);
}

function getTranslationCacheMeta(text) {
  const cached = getCachedTranslation(text);
  if (!cached) return null;
  return { hasCache: true, time: cached.time, ageMs: Date.now() - (cached.time || 0) };
}

// 删除单条翻译缓存（"重译"功能用：清掉缓存后下次会调 AI）
function invalidateCachedTranslation(text) {
  if (!text) return;
  const cache = getTranslationCache();
  if (!cache[text]) return;
  delete cache[text];
  wx.setStorageSync(STORAGE_KEYS.TRANSLATION_CACHE, cache);
  syncDataToServer('learn', 'translationCache', cache);
}

/** 一键清空翻译缓存（单次落盘 + 单次同步） */
function clearTranslationCache() {
  wx.setStorageSync(STORAGE_KEYS.TRANSLATION_CACHE, {});
  syncDataToServer('learn', 'translationCache', {});
}

// ==================== 翻译记录 ====================

function getTranslations() {
  return wx.getStorageSync(STORAGE_KEYS.TRANSLATIONS) || [];
}

function addTranslation(original, translated) {
  let translations = getTranslations();
  translations.unshift({ original: original, translated: translated, time: Date.now() });
  if (translations.length > MAX_ITEMS) {
    translations = translations.slice(0, MAX_ITEMS);
  }
  wx.setStorageSync(STORAGE_KEYS.TRANSLATIONS, translations);
  syncDataToServer('search', 'translations', translations);
  return translations;
}

function removeTranslation(original) {
  let translations = getTranslations();
  translations = translations.filter(item => item.original !== original);
  wx.setStorageSync(STORAGE_KEYS.TRANSLATIONS, translations);
  syncDataToServer('search', 'translations', translations);
  return translations;
}

function clearTranslations() {
  wx.setStorageSync(STORAGE_KEYS.TRANSLATIONS, []);
  syncDataToServer('search', 'translations', []);
}

// 翻译收藏状态判断（参考 isCollected）
function isTranslationCollected(original) {
  if (!original) return false;
  const translations = getTranslations();
  return translations.some(item => item.original === original);
}

// 切换翻译收藏（参考 toggleCollection）
// 命中则删除、未命中则添加，返回 { collected, translations }
function toggleTranslation(original, translated) {
  let translations = getTranslations();
  const index = translations.findIndex(item => item.original === original);

  if (index > -1) {
    translations.splice(index, 1);
  } else {
    translations.unshift({ original: original, translated: translated, time: Date.now() });
    if (translations.length > MAX_ITEMS) {
      translations = translations.slice(0, MAX_ITEMS);
    }
  }
  wx.setStorageSync(STORAGE_KEYS.TRANSLATIONS, translations);
  syncDataToServer('search', 'translations', translations);
  return { collected: index === -1, translations };
}

// 更新单条翻译的 translated 字段（保留原 time）
// 用于"翻译详情页 → 重新翻译"完成后替换原译文
function updateTranslation(original, translated) {
  if (!original) return null;
  const translations = getTranslations();
  const index = translations.findIndex(item => item.original === original);
  if (index === -1) return null;
  translations[index] = { ...translations[index], translated: translated };
  wx.setStorageSync(STORAGE_KEYS.TRANSLATIONS, translations);
  syncDataToServer('search', 'translations', translations);
  return translations[index];
}

// ==================== 待查询 ====================

function getPendingQuery() {
  return wx.getStorageSync(STORAGE_KEYS.PENDING_QUERY);
}

function setPendingQuery(word) {
  wx.setStorageSync(STORAGE_KEYS.PENDING_QUERY, word);
}

function clearPendingQuery() {
  wx.removeStorageSync(STORAGE_KEYS.PENDING_QUERY);
}

function getPendingTranslation() {
  return wx.getStorageSync(STORAGE_KEYS.PENDING_TRANSLATION);
}

function setPendingTranslation(text) {
  wx.setStorageSync(STORAGE_KEYS.PENDING_TRANSLATION, text);
}

function clearPendingTranslation() {
  wx.removeStorageSync(STORAGE_KEYS.PENDING_TRANSLATION);
}

// ==================== 统计 ====================

function getStats() {
  const history = getHistory();
  const collections = getCollections();
  const translations = getTranslations();
  return {
    words: history.length,
    collections: collections.length,
    translations: translations.length
  };
}

/**
 * 列表预览：截断长文本，避免把完整 AI 结果全量塞进 setData。
 * 详情页仍从 storage 读完整内容。
 */
function previewText(text, maxLen) {
  const limit = maxLen || 60;
  if (!text) return '';
  const trimmed = String(text).trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit) + '…';
}

// ==================== 学习列表 ====================

function getLearnList() {
  return wx.getStorageSync(STORAGE_KEYS.LEARN_LIST) || [];
}

function initLearnList(words) {
  const list = [...words];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  wx.setStorageSync(STORAGE_KEYS.LEARN_LIST, list);
  // 云开发已移除：学习列表只存本地，通过 FastAPI 后端 syncLearnList 同步
  return list;
}


async function syncLearnList(words) {
  const localList = getLearnList();

  if (!localList || localList.length === 0) {
    // 云开发已移除：只从 FastAPI 后端同步学习列表
    const auth = require('./auth.js');
    const token = auth.getToken();
    if (token) {
      try {
        const data = await auth.getUserData('learn');
        if (data && data.learnOrder) {
          const serverList = typeof data.learnOrder === 'string'
            ? JSON.parse(data.learnOrder)
            : data.learnOrder;
          if (Array.isArray(serverList) && serverList.length > 0) {
            wx.setStorageSync(STORAGE_KEYS.LEARN_LIST, serverList);
            return serverList;
          }
        }
      } catch (e) {
        log.warn('syncLearnList 获取服务器学习列表失败:', e);
      }
    }

    return initLearnList(words);
  }

  return localList;
}

// ==================== 学习进度 ====================

function getLearnProgress() {
  return wx.getStorageSync('learnProgress') || 0;
}

function setLearnProgress(index) {
  wx.setStorageSync('learnProgress', index);
}

// ==================== 服务器同步 ====================

function syncDataToServer(dataType, dataKey, data) {
  const auth = require('./auth.js');
  const token = auth.getToken();
  if (!token) return;
  auth.saveUserData(dataType, dataKey, data).catch(() => {});
}

/**
 * 按 key 合并两个记录数组（按 word 去重，时间戳新的优先）。
 * - 不同 word：合并保留
 * - 相同 word：time 较大的胜出（容许多设备各自编辑）
 * - 都没有 time 的视为相等，按 local 优先
 *
 * P1-11: 用 Number.isFinite 显式判断时间戳有效性，避免 undefined 被误判。
 */
function _mergeByTime(local, cloud, keyOf) {
  const map = new Map();
  for (const item of (local || [])) {
    map.set(keyOf(item), item);
  }
  for (const item of (cloud || [])) {
    const cur = map.get(keyOf(item));
    if (!cur) {
      map.set(keyOf(item), item);
      continue;
    }
    // 仅当 cloud.time 是有效数字且 >= local.time 时覆盖
    // local 无 time / cloud 无 time → 保留 local
    const curTimeValid = Number.isFinite(cur.time);
    const itemTimeValid = Number.isFinite(item.time);
    if (!curTimeValid && itemTimeValid) {
      map.set(keyOf(item), item);
    } else if (curTimeValid && itemTimeValid && item.time >= cur.time) {
      map.set(keyOf(item), item);
    }
    // 否则保留 cur（local 优先）
  }
  return Array.from(map.values());
}

function mergeCollectionsByTime(local, cloud) {
  return _mergeByTime(local, cloud, item => item.word);
}

function mergeHistoryByTime(local, cloud) {
  // history 条目形如 { word, content, time }，与 collections 同构，按 word 去重
  return _mergeByTime(local, cloud, item => item.word);
}

/** 比较两个记录列表是否一致（按 word + time，忽略顺序） */
function _recordsChanged(local, merged) {
  if (local.length !== merged.length) return true;
  const keyOf = item => item.word + '|' + (Number.isFinite(item.time) ? item.time : '');
  const localKeys = new Set(local.map(keyOf));
  return merged.some(item => !localKeys.has(keyOf(item)));
}

/**
 * 全量同步（先拉取合并，再推送）。
 * 静默运行：不弹 UI、不抛错给调用方（失败仅 console.warn）。
 * 适用场景：登录成功后自动同步、"我的"页手动同步按钮。
 *
 * 顺序至关重要：必须"先拉后推"。
 * - 若先推本地，新设备（本地为空）会把云端 collections/history 覆盖成空；
 * - 离线期间本地产生的新复习数据也会在下次同步时被旧云端覆盖。
 * 正确流程：拉取 → 按时间戳合并（collections / history / wordStates / reviewStats）
 * → 把合并结果推回云端，保证两端一致。
 *
 * @returns {Promise<{pushed: boolean, pulled: boolean}>} 推送和拉取是否都成功
 */
async function fullSync() {
  const auth = require('./auth.js');
  if (!auth.checkLogin()) return { pushed: false, pulled: false };

  // 1) 拉取并合并
  let pulled = true;

  // learnList + sm2 wordStates/reviewStats（内部按时间戳合并，不覆盖）
  try {
    await restoreFromServer();
  } catch (e) {
    pulled = false;
    fullSyncLog.warn('restore learnList/sm2 failed:', e.message);
  }

  // collections：云端可能有多设备新增
  try {
    const cloudData = await auth.getUserData('learn');
    if (cloudData && Array.isArray(cloudData.collections)) {
      const merged = mergeCollectionsByTime(getCollections(), cloudData.collections);
      if (_recordsChanged(getCollections(), merged)) {
        wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, merged);
      }
    }
  } catch (e) {
    pulled = false;
    fullSyncLog.warn('merge collections failed:', e.message);
  }

  // history：云端可能有多设备新增（同样先合并，避免被本地空数组覆盖）
  try {
    const cloudSearch = await auth.getUserData('search');
    if (cloudSearch && Array.isArray(cloudSearch.history)) {
      const merged = mergeHistoryByTime(getHistory(), cloudSearch.history);
      if (_recordsChanged(getHistory(), merged)) {
        wx.setStorageSync(STORAGE_KEYS.SEARCH_HISTORY, merged);
      }
    }
  } catch (e) {
    pulled = false;
    fullSyncLog.warn('merge history failed:', e.message);
  }

  // 2) 合并完成后推送（全量覆盖 = 云端与本地一致）
  let pushed = true;
  try {
    const results = await Promise.allSettled([
      auth.saveUserData('learn', 'collections', getCollections()),
      auth.saveUserData('search', 'history', getHistory()),
      sm2.pushToServer(),  // wordStates → reviewStats 顺序由 sm2 内部队列保证
    ]);
    if (results.some(r => r.status === 'rejected' || r.value === false)) {
      pushed = false;
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          fullSyncLog.warn(`push[${i}] failed:`, r.reason && r.reason.message);
        } else if (r.value === false) {
          fullSyncLog.warn(`push[${i}] returned false`);
        }
      });
    }
  } catch (e) {
    pushed = false;
    fullSyncLog.warn('push failed:', e.message);
  }

  return { pushed, pulled };
}

/**
 * 从服务器恢复用户数据（统一入口）。
 * wordStates / reviewStats 由 sm2 处理；learnList 由本文件处理。
 */
async function restoreFromServer() {
  const auth = require('./auth.js');
  const token = auth.getToken();
  if (!token) return null;

  // 学习列表
  let learnList = null;
  try {
    const data = await auth.getUserData('learn');
    if (data && data.learnOrder) {
      learnList = typeof data.learnOrder === 'string'
        ? JSON.parse(data.learnOrder)
        : data.learnOrder;
      if (Array.isArray(learnList) && learnList.length > 0) {
        wx.setStorageSync(STORAGE_KEYS.LEARN_LIST, learnList);
      }
    }
  } catch (e) {
    log.warn('restoreFromServer 恢复学习列表失败:', e);
  }

  // wordStates + reviewStats
  await sm2.restoreFromServer();

  return learnList;
}

// ==================== 用户设置 ====================

const DEFAULT_GROUP_SIZE = 5;
const SETTING_KEYS = {
  GROUP_SIZE: 'groupSize'
};

function getGroupSize() {
  return wx.getStorageSync(SETTING_KEYS.GROUP_SIZE) || DEFAULT_GROUP_SIZE;
}

function setGroupSize(size) {
  wx.setStorageSync(SETTING_KEYS.GROUP_SIZE, size);
}

function getSettings() {
  return {
    groupSize: getGroupSize()
  };
}

module.exports = {
  STORAGE_KEYS,
  // 检索/收藏/翻译
  getHistory,
  saveHistory,
  clearHistory,
  removeHistory,
  getCollections,
  addCollection,
  removeCollection,
  clearCollections,
  isCollected,
  updateCollection,
  toggleCollection,
  // 查词缓存
  getWordCache,
  getCachedWord,
  setCachedWord,
  getWordCacheMeta,
  invalidateCachedWord,
  clearWordCache,
  // 翻译缓存
  getTranslationCache,
  getCachedTranslation,
  setCachedTranslation,
  getTranslationCacheMeta,
  invalidateCachedTranslation,
  clearTranslationCache,
  getTranslations,
  addTranslation,
  removeTranslation,
  clearTranslations,
  isTranslationCollected,
  toggleTranslation,
  updateTranslation,
  // 待查询
  getPendingQuery,
  setPendingQuery,
  clearPendingQuery,
  getPendingTranslation,
  setPendingTranslation,
  clearPendingTranslation,
  // 统计
  getStats,
  previewText,
  // 学习列表
  getLearnList,
  initLearnList,
  syncLearnList,
  // 学习进度
  getLearnProgress,
  setLearnProgress,
  // 服务器同步
  restoreFromServer,
  syncDataToServer,
  fullSync,
  mergeCollectionsByTime,
  mergeHistoryByTime,
  // 设置
  getGroupSize,
  setGroupSize,
  getSettings,
  // SM-2 算法（页面可直接 require('./sm2')，这里也透传一份方便迁移）
  sm2
};
