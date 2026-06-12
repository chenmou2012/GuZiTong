// Storage 服务
const cloudStorage = require('./cloudStorage.js');

const STORAGE_KEYS = {
  SEARCH_HISTORY: 'searchHistory',
  COLLECTIONS: 'collections',
  TRANSLATIONS: 'translations',
  PENDING_QUERY: 'pendingQuery',
  LEARNED_WORDS: 'learnedWords',
  REVIEW_RECORDS: 'reviewRecords'
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

  // 同步到云端
  if (wx.cloud) {
    cloudStorage.saveCloudSearchHistory('auto', history).catch(() => {});
  }
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

// ==================== 学习相关 ====================

// 获取已学会的词
function getLearnedWords() {
  return wx.getStorageSync(STORAGE_KEYS.LEARNED_WORDS) || [];
}

// 标记词已学会
function markWordLearned(word) {
  let learned = getLearnedWords();
  const index = learned.findIndex(item => item.word === word);
  if (index === -1) {
    learned.push({
      word: word,
      learnedTime: Date.now(),
      reviewCount: 0
    });
    wx.setStorageSync(STORAGE_KEYS.LEARNED_WORDS, learned);

    // 同步到云端
    syncToCloud(learned);
  }
  return learned;
}

// 同步到云端
function syncToCloud(data) {
  if (wx.cloud) {
    cloudStorage.saveCloudLearnedWords('auto', data).catch(() => {});
  }
}

// 启用云端存储
function enableCloudSync() {
  if (wx.cloud) {
    cloudStorage.syncLearnedWords();
  }
}

// 获取复习记录
function getReviewRecords() {
  return wx.getStorageSync(STORAGE_KEYS.REVIEW_RECORDS) || [];
}

// 更新复习时间
function updateReviewTime(wordId, isKnown) {
  let records = getReviewRecords();
  const index = records.findIndex(item => item.wordId === wordId);

  if (index === -1) {
    records.push({
      wordId: wordId,
      lastReview: Date.now(),
      reviewCount: 1
    });
  } else {
    const record = records[index];
    if (isKnown) {
      record.reviewCount += 1;
    } else {
      record.reviewCount = 0; // 忘记则重置
    }
    record.lastReview = Date.now();
    records[index] = record;
  }

  wx.setStorageSync(STORAGE_KEYS.REVIEW_RECORDS, records);
  return records;
}

// 获取上次复习时间
function getLastReviewTime(word) {
  const records = getReviewRecords();
  const record = records.find(item => item.word === word);
  return record ? record.lastReview : 0;
}

// 学习进度
function getLearnProgress() {
  return wx.getStorageSync('learnProgress') || 0;
}

function setLearnProgress(index) {
  wx.setStorageSync('learnProgress', index);
}

// 复习历史记录
function getReviewHistory() {
  return wx.getStorageSync('reviewHistory') || [];
}

function addReviewHistory(count) {
  const history = getReviewHistory();
  const today = new Date().toLocaleDateString('zh-CN');
  const todayRecord = history.find(h => h.date === today);

  if (todayRecord) {
    todayRecord.count += count;
  } else {
    history.unshift({ date: today, count: count });
  }

  // 只保留30天记录
  if (history.length > 30) history.pop();
  wx.setStorageSync('reviewHistory', history);
  return history;
}

// 错误次数记录
function getErrorCount(word) {
  const records = wx.getStorageSync('errorCountRecords') || {};
  return records[word] || 0;
}

function incrementErrorCount(word) {
  const records = wx.getStorageSync('errorCountRecords') || {};
  records[word] = (records[word] || 0) + 1;
  wx.setStorageSync('errorCountRecords', records);
  return records[word];
}

function resetErrorCount(word) {
  const records = wx.getStorageSync('errorCountRecords') || {};
  records[word] = 0;
  wx.setStorageSync('errorCountRecords', records);
  return records;
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
  getStats,
  // 学习相关
  getLearnedWords,
  markWordLearned,
  getReviewRecords,
  updateReviewTime,
  getLastReviewTime,
  getLearnProgress,
  setLearnProgress,
  getReviewHistory,
  addReviewHistory,
  // 错误次数
  getErrorCount,
  incrementErrorCount,
  resetErrorCount,
  // 云端同步
  enableCloudSync
};