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
  LEARN_LIST: 'learnList'  // 学习列表（随机排列）
};

const MAX_ITEMS = 50;

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
 * 合并两个 collections 数组（按 word 去重，时间戳新的优先）。
 * - 不同 word：合并保留
 * - 相同 word：time 较大的胜出（容许多设备各自编辑）
 * - 都没有 time 的视为相等，按 local 优先
 *
 * P1-11: 用 Number.isFinite 显式判断时间戳有效性，避免 undefined 被误判。
 */
function mergeCollectionsByTime(local, cloud) {
  const map = new Map();
  for (const item of (local || [])) {
    map.set(item.word, item);
  }
  for (const item of (cloud || [])) {
    const cur = map.get(item.word);
    if (!cur) {
      map.set(item.word, item);
      continue;
    }
    // 仅当 cloud.time 是有效数字且 >= local.time 时覆盖
    // local 无 time / cloud 无 time → 保留 local
    const curTimeValid = Number.isFinite(cur.time);
    const itemTimeValid = Number.isFinite(item.time);
    if (!curTimeValid && itemTimeValid) {
      map.set(item.word, item);
    } else if (curTimeValid && itemTimeValid && item.time >= cur.time) {
      map.set(item.word, item);
    }
    // 否则保留 cur（local 优先）
  }
  return Array.from(map.values());
}

/**
 * 全量同步（推送本地变更 + 拉取云端 + 合并）。
 * 静默运行：不弹 UI、不抛错给调用方（失败仅 console.warn）。
 * 适用场景：登录成功后自动同步、"我的"页手动同步按钮。
 *
 * P1-10: 推送阶段用 Promise.all 并发，节省 ~50% 网络时间。
 *
 * @returns {Promise<{pushed: boolean, pulled: boolean}>} 推送和拉取是否都成功
 */
async function fullSync() {
  const auth = require('./auth.js');
  if (!auth.checkLogin()) return { pushed: false, pulled: false };

  // 1) 推送本地变更（幂等：服务端全量覆盖即可）
  //    collections 和 history 互相独立，并发推送；任一失败不影响另一个的结果记录
  let pushed = true;
  try {
    const results = await Promise.allSettled([
      auth.saveUserData('learn', 'collections', getCollections()),
      auth.saveUserData('search', 'history', getHistory()),
    ]);
    if (results.some(r => r.status === 'rejected' || r.value === false)) {
      pushed = false;
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          fullSyncLog.warn(`push[${i}] failed:`, r.reason && r.reason.message);
        }
      });
    }
  } catch (e) {
    pushed = false;
    fullSyncLog.warn('push failed:', e.message);
  }

  // 2) 拉取 learnList + sm2 数据
  let pulled = true;
  try {
    await restoreFromServer();
  } catch (e) {
    pulled = false;
    fullSyncLog.warn('restore learnList/sm2 failed:', e.message);
  }

  // 3) 拉取并合并 collections（云端可能有多设备新增的）
  try {
    const cloudData = await auth.getUserData('learn');
    if (cloudData && Array.isArray(cloudData.collections)) {
      const local = getCollections();
      const merged = mergeCollectionsByTime(local, cloudData.collections);
      const isDiff = merged.length !== local.length ||
        merged.some((m, i) => {
          const l = local[i];
          return !l || m.word !== l.word || m.time !== l.time;
        });
      if (isDiff) {
        wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, merged);
        // 合并后回写云端，保证两边一致
        await auth.saveUserData('learn', 'collections', merged);
      }
    }
  } catch (e) {
    pulled = false;
    fullSyncLog.warn('merge collections failed:', e.message);
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
  isCollected,
  updateCollection,
  toggleCollection,
  getTranslations,
  addTranslation,
  removeTranslation,
  clearTranslations,
  // 待查询
  getPendingQuery,
  setPendingQuery,
  clearPendingQuery,
  getPendingTranslation,
  setPendingTranslation,
  clearPendingTranslation,
  // 统计
  getStats,
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
  // 设置
  getGroupSize,
  setGroupSize,
  getSettings,
  // SM-2 算法（页面可直接 require('./sm2')，这里也透传一份方便迁移）
  sm2
};