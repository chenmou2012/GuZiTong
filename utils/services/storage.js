// Storage 服务
// 学习进度/复习相关统一由 sm2.js 负责，本文件只保留检索记录、收藏、翻译、学习列表等
const cloudStorage = require('./cloudStorage.js');
const sm2 = require('./sm2.js');

const STORAGE_KEYS = {
  SEARCH_HISTORY: 'searchHistory',
  COLLECTIONS: 'collections',
  TRANSLATIONS: 'translations',
  PENDING_QUERY: 'pendingQuery',
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

  if (wx.cloud) {
    cloudStorage.saveCloudSearchHistory('auto', history).catch(() => {});
  }
  syncDataToServer('search', 'history', history);
  return history;
}

function clearHistory() {
  wx.setStorageSync(STORAGE_KEYS.SEARCH_HISTORY, []);
}

// ==================== 收藏 ====================

function getCollections() {
  return wx.getStorageSync(STORAGE_KEYS.COLLECTIONS) || [];
}

function addCollection(word, result) {
  let collections = getCollections();
  collections.push({ word: word, result: result, time: Date.now() });
  wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, collections);
  return collections;
}

function removeCollection(word) {
  let collections = getCollections();
  const index = collections.findIndex(item => item.word === word);
  if (index > -1) {
    collections.splice(index, 1);
  }
  wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, collections);
  return collections;
}

function isCollected(word) {
  let collections = getCollections();
  return collections.some(item => item.word === word);
}

function toggleCollection(word, result) {
  let collections = getCollections();
  const index = collections.findIndex(item => item.word === word);

  if (index > -1) {
    collections.splice(index, 1);
    wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, collections);
    return { collected: false, collections };
  } else {
    collections.push({ word: word, result: result, time: Date.now() });
    wx.setStorageSync(STORAGE_KEYS.COLLECTIONS, collections);
    return { collected: true, collections };
  }
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
  if (wx.cloud) {
    cloudStorage.saveCloudLearnList('auto', list).catch(() => {});
  }
  return list;
}

function enableCloudSync() {
  if (wx.cloud) {
    cloudStorage.syncLearnedWords();
  }
}

async function syncLearnList(words) {
  const localList = getLearnList();

  if (!localList || localList.length === 0) {
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
        console.log('获取服务器学习列表失败', e);
      }
    }

    if (wx.cloud) {
      try {
        const openId = await cloudStorage.getOpenId();
        if (openId) {
          const cloudList = await cloudStorage.getCloudLearnList(openId);
          if (cloudList && cloudList.length > 0) {
            wx.setStorageSync(STORAGE_KEYS.LEARN_LIST, cloudList);
            return cloudList;
          }
        }
      } catch (e) {
        console.log('获取云端学习列表失败', e);
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
    console.log('恢复学习列表失败', e);
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
  getCollections,
  addCollection,
  removeCollection,
  isCollected,
  toggleCollection,
  getTranslations,
  addTranslation,
  // 待查询
  getPendingQuery,
  setPendingQuery,
  clearPendingQuery,
  // 统计
  getStats,
  // 学习列表
  getLearnList,
  initLearnList,
  enableCloudSync,
  syncLearnList,
  // 学习进度
  getLearnProgress,
  setLearnProgress,
  // 服务器同步
  restoreFromServer,
  syncDataToServer,
  // 设置
  getGroupSize,
  setGroupSize,
  getSettings,
  // SM-2 算法（页面可直接 require('./sm2')，这里也透传一份方便迁移）
  sm2
};