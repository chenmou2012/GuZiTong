// Storage 服务
const cloudStorage = require('./cloudStorage.js');

const STORAGE_KEYS = {
  SEARCH_HISTORY: 'searchHistory',
  COLLECTIONS: 'collections',
  TRANSLATIONS: 'translations',
  PENDING_QUERY: 'pendingQuery',
  LEARNED_WORDS: 'learnedWords',
  REVIEW_RECORDS: 'reviewRecords',
  LEARN_LIST: 'learnList'  // 学习列表（随机排列）
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

  // 同步到云端和服务器
  if (wx.cloud) {
    cloudStorage.saveCloudSearchHistory('auto', history).catch(() => {});
  }
  syncDataToServer('search', 'history', history);
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
  syncDataToServer('search', 'translations', translations);
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

    // 更新今日学习数
    const stats = getReviewStats();
    const today = new Date().toLocaleDateString('zh-CN');
    if (stats.lastReviewDate !== today) {
      stats.todayLearn = 0;
    }
    stats.todayLearn = (stats.todayLearn || 0) + 1;
    stats.lastReviewDate = today;
    wx.setStorageSync('reviewStats', stats);
    syncReviewStatsToServer(stats);

    // 同步到云端和服务器
    syncToCloud(learned);
    syncToServer(learned);
  }
  return learned;
}

// 同步到云端
function syncToCloud(data) {
  if (wx.cloud) {
    cloudStorage.saveCloudLearnedWords('auto', data).catch(() => {});
  }
}

// 同步到服务器
// 通用同步函数
function syncDataToServer(dataType, dataKey, data) {
  const auth = require('./auth.js');
  const token = auth.getToken();
  if (!token) return;

  auth.saveUserData(dataType, dataKey, data).catch(() => {});
}

function syncToServer(data) {
  const auth = require('./auth.js');
  const token = auth.getToken();
  console.log('syncToServer called, token:', token ? 'exists' : 'null');
  if (!token) {
    console.log('未登录，不能同步');
    return;
  }

  console.log('开始同步, data length:', data.length);
  auth.saveUserData('learn', 'learnedWords', data).then(success => {
    console.log('同步到服务器:', success ? '成功' : '失败');
  }).catch(err => {
    console.log('同步失败:', err);
  });
}

// 从服务器恢复学习数据
async function restoreFromServer() {
  const auth = require('./auth.js');
  const token = auth.getToken();
  if (!token) return null;

  try {
    const data = await auth.getUserData('learn');
    if (data && data.learnedWords) {
      const learned = typeof data.learnedWords === 'string' ? JSON.parse(data.learnedWords) : data.learnedWords;
      wx.setStorageSync(STORAGE_KEYS.LEARNED_WORDS, learned);
      return learned;
    }
  } catch (e) {
    console.log('恢复学习数据失败', e);
  }
  return null;
}

// 获取学习列表（随机排列的词序）
function getLearnList() {
  return wx.getStorageSync(STORAGE_KEYS.LEARN_LIST) || [];
}

// 初始化学习列表（首次学习时随机排列并存储）
function initLearnList(words) {
  const list = [...words];
  // 随机打乱
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  wx.setStorageSync(STORAGE_KEYS.LEARN_LIST, list);
  // 同步到云端
  if (wx.cloud) {
    cloudStorage.saveCloudLearnList('auto', list).catch(() => {});
  }
  return list;
}

// 启用云端存储
function enableCloudSync() {
  if (wx.cloud) {
    cloudStorage.syncLearnedWords();
  }
}

// 同步学习列表（从服务器获取或初始化）
async function syncLearnList(words) {
  const localList = getLearnList();

  if (!localList || localList.length === 0) {
    // 本地无列表，尝试从服务器获取
    const auth = require('./auth.js');
    const token = auth.getToken();
    if (token) {
      try {
        const response = await auth.request('/api/user/data?token=' + token + '&data_type=learn');
        if (response.data && response.data.learn && response.data.learn.learnOrder) {
          const serverList = JSON.parse(response.data.learn.learnOrder);
          wx.setStorageSync(STORAGE_KEYS.LEARN_LIST, serverList);
          return serverList;
        }
      } catch (e) {
        console.log('获取服务器学习列表失败', e);
      }
    }

    // 尝试从云端获取
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

    // 都没有，初始化本地列表
    return initLearnList(words);
  }

  return localList;
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

// ==================== 复习统计数据 ====================
const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30]; // 艾宾浩斯间隔（天）

function getReviewStats() {
  return wx.getStorageSync('reviewStats') || {
    todayReview: 0,
    todayDone: 0,
    todayLearn: 0,
    streakDays: 0,
    lastReviewDate: null,
    totalCorrect: 0,
    totalWrong: 0,
    ebbinghausStage: {} // { wordId: stage }
  };
}

// 同步复习统计到服务器
function syncReviewStatsToServer(stats) {
  const auth = require('./auth.js');
  const token = auth.getToken();
  if (!token) return;

  auth.saveUserData('learn', 'reviewStats', stats).then(success => {
    console.log('同步复习统计:', success ? '成功' : '失败');
  }).catch(() => {});
}

// 从服务器恢复复习统计
async function restoreReviewStatsFromServer() {
  const auth = require('./auth.js');
  const token = auth.getToken();
  if (!token) return null;

  try {
    const data = await auth.getUserData('learn');
    if (data && data.reviewStats) {
      const stats = typeof data.reviewStats === 'string' ? JSON.parse(data.reviewStats) : data.reviewStats;
      wx.setStorageSync('reviewStats', stats);
      return stats;
    }
  } catch (e) {
    console.log('恢复复习统计失败', e);
  }
  return null;
}

function updateReviewStats(isCorrect, wordId) {
  const stats = getReviewStats();
  const today = new Date().toLocaleDateString('zh-CN');

  // 更新今日复习数
  if (stats.lastReviewDate !== today) {
    stats.todayReview = 0;
    stats.todayDone = 0;
  }

  stats.todayReview++;
  if (isCorrect) {
    stats.todayDone++;
    stats.totalCorrect++;
    // 更新艾宾浩斯阶段
    const currentStage = stats.ebbinghausStage[wordId] || 0;
    if (currentStage < REVIEW_INTERVALS.length) {
      stats.ebbinghausStage[wordId] = currentStage + 1;
    }
  } else {
    stats.totalWrong++;
    // 错误重置到阶段1
    stats.ebbinghausStage[wordId] = 1;
  }

  // 更新连续学习天数
  if (stats.lastReviewDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('zh-CN');
    if (stats.lastReviewDate === yesterday) {
      stats.streakDays++;
    } else if (stats.lastReviewDate !== today) {
      stats.streakDays = 1;
    }
  }
  stats.lastReviewDate = today;

  wx.setStorageSync('reviewStats', stats);

  // 同步到服务器
  syncReviewStatsToServer(stats);

  return stats;
}

function getEbbinghausStats() {
  const stats = getReviewStats();
  const stageCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const stage = stats.ebbinghausStage || {};
  for (const wordId in stage) {
    const s = stage[wordId];
    if (s >= 1 && s <= 5) stageCounts[s]++;
  }
  return {
    todayReview: stats.todayReview,
    todayDone: stats.todayDone,
    todayLearn: stats.todayLearn || 0,
    streakDays: stats.streakDays,
    totalCorrect: stats.totalCorrect,
    totalWrong: stats.totalWrong,
    stageCounts
  };
}

// ==================== 用户设置 ====================
const DEFAULT_GROUP_SIZE = 3;
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
  getLearnList,
  initLearnList,
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
  // 复习统计
  getReviewStats,
  updateReviewStats,
  getEbbinghausStats,
  restoreReviewStatsFromServer,
  // 云端同步
  enableCloudSync,
  syncLearnList,
  restoreFromServer,
  // 设置
  getGroupSize,
  setGroupSize,
  getSettings
};