// Storage 服务

const STORAGE_KEYS = {
  SEARCH_HISTORY: 'searchHistory',
  COLLECTIONS: 'collections',
  TRANSLATIONS: 'translations',
  PENDING_QUERY: 'pendingQuery'
};

const MAX_ITEMS = 50;

// 历史记录
function getHistory() {
  return wx.getStorageSync(STORAGE_KEYS.SEARCH_HISTORY) || [];
}

function saveHistory(word, content) {
  let history = getHistory();
  // 去重
  history = history.filter(item => item.word !== word);
  history.unshift({ word: word, content: content, time: Date.now() });
  if (history.length > MAX_ITEMS) {
    history = history.slice(0, MAX_ITEMS);
  }
  wx.setStorageSync(STORAGE_KEYS.SEARCH_HISTORY, history);
  return history;
}

function clearHistory() {
  wx.setStorageSync(STORAGE_KEYS.SEARCH_HISTORY, []);
}

// 收藏
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

// 翻译记录
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
  return translations;
}

// 待查询
function getPendingQuery() {
  return wx.getStorageSync(STORAGE_KEYS.PENDING_QUERY);
}

function setPendingQuery(word) {
  wx.setStorageSync(STORAGE_KEYS.PENDING_QUERY, word);
}

function clearPendingQuery() {
  wx.removeStorageSync(STORAGE_KEYS.PENDING_QUERY);
}

// 统计
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

module.exports = {
  STORAGE_KEYS,
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
  getPendingQuery,
  setPendingQuery,
  clearPendingQuery,
  getStats
};