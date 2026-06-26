// SM-2 改良版艾宾浩斯算法（参考 Anki 早期实现）
// 数据结构统一为 wordStates: { word: WordState }

const DAY_MS = 24 * 60 * 60 * 1000;

const QUALITY = {
  EASY: 5,      // 认识 —— 完全掌握，× EF × 1.2 + EF +0.15
  GOOD: 3,      // 模糊 —— 答对但有迟疑，按标准 × EF（无 1.2× 加成，EF 不变）
  HARD: 2       // 不认识 —— EF -0.20，interval 重置为 1
};

const CONFIG = {
  INITIAL_EF: 2.5,
  MIN_EF: 1.3,
  EF_DELTA_EASY: 0.15,
  EF_DELTA_FAIL: -0.20,
  GRADUATION_INTERVAL: 30,    // interval >= 30 视为毕业
  EASY_BONUS: 1.2,             // EASY 评分额外间隔乘数
  LEARNING_INTERVALS: [1, 3, 6] // repetition 1/2/3 对应的间隔
};

const PHASE = {
  LEARNING: 'learning',
  REVIEW: 'review',
  GRADUATED: 'graduated'
};

// ==================== 内部工具 ====================

function getStates() {
  return wx.getStorageSync('wordStates') || {};
}

function setStates(states) {
  wx.setStorageSync('wordStates', states);
}

function getStats() {
  return wx.getStorageSync('reviewStats') || {
    todayReview: 0,
    todayDone: 0,
    todayLearn: 0,
    streakDays: 0,
    lastReviewDate: null,
    totalCorrect: 0,
    totalWrong: 0
  };
}

function setStats(stats) {
  wx.setStorageSync('reviewStats', stats);
}

function syncWordStatesToServer(states) {
  const auth = require('./auth.js');
  const token = auth.getToken();
  if (!token) return;
  auth.saveUserData('learn', 'wordStates', states).catch(() => {});
}

function syncStatsToServer(stats) {
  const auth = require('./auth.js');
  const token = auth.getToken();
  if (!token) return;
  auth.saveUserData('learn', 'reviewStats', stats).catch(() => {});
}

function todayStr() {
  return new Date().toLocaleDateString('zh-CN');
}

function rollDailyStats(stats) {
  const today = todayStr();
  if (stats.lastReviewDate !== today) {
    stats.todayReview = 0;
    stats.todayDone = 0;
    if (stats.lastReviewDate) {
      const yesterday = new Date(Date.now() - DAY_MS).toLocaleDateString('zh-CN');
      stats.streakDays = (stats.lastReviewDate === yesterday) ? (stats.streakDays || 0) + 1 : 1;
    } else {
      stats.streakDays = stats.streakDays || 1;
    }
  }
  return stats;
}

function clampEf(ef) {
  return Math.max(CONFIG.MIN_EF, ef);
}

// ==================== 核心 API ====================

/**
 * 创建/获取某字的状态对象。
 * 已存在则返回现有状态；不存在则按"刚学完"初始化（rep=0, interval=0,
 * nextReviewAt=now，意味着立即可复习）。
 */
function getOrCreateState(word, now = Date.now()) {
  const states = getStates();
  if (states[word]) return states[word];

  const state = {
    word: word,
    ef: CONFIG.INITIAL_EF,
    interval: 0,
    repetition: 0,
    phase: PHASE.LEARNING,
    nextReviewAt: now,
    learnedAt: now,
    lastReviewedAt: 0,
    totalReviews: 0,
    correctCount: 0,
    wrongCount: 0
  };
  states[word] = state;
  setStates(states);
  syncWordStatesToServer(states);
  return state;
}

/**
 * 标记字为已学（初始化 SM-2 状态）。幂等。
 */
function markWordLearned(word, now = Date.now()) {
  const states = getStates();
  if (states[word]) return states[word];

  const state = {
    word: word,
    ef: CONFIG.INITIAL_EF,
    interval: 0,
    repetition: 0,
    phase: PHASE.LEARNING,
    nextReviewAt: now,         // 立即可复习
    learnedAt: now,
    lastReviewedAt: 0,
    totalReviews: 0,
    correctCount: 0,
    wrongCount: 0
  };
  states[word] = state;
  setStates(states);
  syncWordStatesToServer(states);

  // 同步复习统计：今日学习数
  const stats = rollDailyStats(getStats());
  stats.todayLearn = (stats.todayLearn || 0) + 1;
  stats.lastReviewDate = todayStr();
  setStats(stats);
  syncStatsToServer(stats);

  return state;
}

/**
 * 统一复习入口：记录一次评分结果并返回新状态。
 * quality ∈ {2, 4, 5}（参考 SM-2 原始质量分）
 */
function recordReview(word, quality, now = Date.now()) {
  const state = getOrCreateState(word, now);
  const states = getStates();
  let { ef, interval, repetition } = state;

  if (quality === QUALITY.HARD) {
    // 答错：完整重置，EF 同步扣减（避免 EF 虚高导致下次间隔爆炸）
    ef = clampEf(ef + CONFIG.EF_DELTA_FAIL);
    interval = 1;
    repetition = 0;
    state.wrongCount += 1;
  } else {
    repetition += 1;
    state.correctCount += 1;

    // 学习阶段：1 → 3 → 6 天
    if (repetition <= CONFIG.LEARNING_INTERVALS.length) {
      interval = CONFIG.LEARNING_INTERVALS[repetition - 1];
    } else {
      // 复习阶段：interval = round(prev × ef)
      interval = Math.round(state.interval * ef) || CONFIG.LEARNING_INTERVALS[CONFIG.LEARNING_INTERVALS.length - 1];
    }

    if (quality === QUALITY.EASY) {
      interval = Math.round(interval * CONFIG.EASY_BONUS);
      ef = ef + CONFIG.EF_DELTA_EASY; // 不封顶上限（用户选 EASY 是真实信号）
    }
  }

  state.ef = ef;
  state.interval = interval;
  state.repetition = repetition;
  state.phase = interval >= CONFIG.GRADUATION_INTERVAL
    ? PHASE.GRADUATED
    : (repetition < CONFIG.LEARNING_INTERVALS.length ? PHASE.LEARNING : PHASE.REVIEW);
  state.nextReviewAt = now + interval * DAY_MS;
  state.lastReviewedAt = now;
  state.totalReviews += 1;

  states[word] = state;
  setStates(states);
  syncWordStatesToServer(states);

  // 同步复习统计
  const stats = rollDailyStats(getStats());
  stats.todayReview += 1;
  stats.lastReviewDate = todayStr();
  if (quality === QUALITY.HARD) {
    stats.totalWrong += 1;
  } else {
    stats.todayDone += 1;
    stats.totalCorrect += 1;
  }
  setStats(stats);
  syncStatsToServer(stats);

  return state;
}

/**
 * 获取到期字列表，按 phase 优先级排序（learning > review > graduated），
 * 同 phase 内按 nextReviewAt 升序。
 * 返回 [{ word, state, meanings }]，meanings 由调用方补全。
 */
function getWordsToReview(now = Date.now(), meaningsByWord = {}) {
  const states = getStates();
  const phaseRank = { [PHASE.LEARNING]: 0, [PHASE.REVIEW]: 1, [PHASE.GRADUATED]: 2 };

  const due = [];
  for (const word in states) {
    const s = states[word];
    if (s.nextReviewAt <= now) {
      due.push({
        word: word,
        state: s,
        meanings: meaningsByWord[word] || [{ meaning: '' }]
      });
    }
  }
  due.sort((a, b) => {
    const r = phaseRank[a.state.phase] - phaseRank[b.state.phase];
    if (r !== 0) return r;
    return a.state.nextReviewAt - b.state.nextReviewAt;
  });
  return due;
}

/**
 * 获取所有字状态（{ word: state }）。
 */
function getAllWordStates() {
  return getStates();
}

/**
 * 获取单个字状态。
 */
function getWordState(word) {
  const states = getStates();
  return states[word] || null;
}

/**
 * 从服务器恢复 wordStates 和 reviewStats。
 */
async function restoreFromServer() {
  const auth = require('./auth.js');
  const token = auth.getToken();
  if (!token) return null;

  try {
    const data = await auth.getUserData('learn');
    if (!data) return null;

    if (data.wordStates) {
      const states = typeof data.wordStates === 'string' ? JSON.parse(data.wordStates) : data.wordStates;
      if (states && typeof states === 'object') {
        wx.setStorageSync('wordStates', states);
      }
    }

    if (data.reviewStats) {
      const stats = typeof data.reviewStats === 'string' ? JSON.parse(data.reviewStats) : data.reviewStats;
      if (stats && typeof stats === 'object') {
        // 兼容老数据：剥离 ebbinghausStage
        delete stats.ebbinghausStage;
        wx.setStorageSync('reviewStats', stats);
      }
    }

    return { wordStates: getStates(), reviewStats: getStats() };
  } catch (e) {
    console.log('恢复 SM-2 数据失败', e);
    return null;
  }
}

/**
 * 启动时迁移旧数据：
 * - learnedWords → wordStates（按"刚学完"处理，nextReviewAt=now）
 * - reviewStats.ebbinghausStage 字段剥离
 * - reviewStats.errorCountRecords / reviewRecords 不再需要
 *
 * 通过 sm2_migration_done flag 防止重复迁移。
 */
function migrateLegacyData(now = Date.now()) {
  const flag = wx.getStorageSync('sm2_migration_done');
  if (flag) return { migrated: 0, skipped: true };

  const states = getStates();
  const legacyLearned = wx.getStorageSync('learnedWords') || [];

  let migrated = 0;
  legacyLearned.forEach(item => {
    const word = item && item.word;
    if (!word || states[word]) return;
    states[word] = {
      word: word,
      ef: CONFIG.INITIAL_EF,
      interval: 0,
      repetition: 0,
      phase: PHASE.LEARNING,
      nextReviewAt: now,        // 立即可复习
      learnedAt: item.learnedTime || now,
      lastReviewedAt: 0,
      totalReviews: item.reviewCount || 0,
      correctCount: 0,
      wrongCount: 0
    };
    migrated += 1;
  });

  if (migrated > 0) {
    setStates(states);
    syncWordStatesToServer(states);
  }

  // 清理 reviewStats 中的旧字段
  const stats = getStats();
  delete stats.ebbinghausStage;
  setStats(stats);
  if (migrated > 0) syncStatsToServer(stats);

  wx.setStorageSync('sm2_migration_done', true);
  return { migrated, skipped: false };
}

/**
 * 统计接口：返回按 phase 分组的字数量及总统计。
 */
function getEbbinghausStats() {
  const states = getStates();
  const learningCount = 0, reviewCount = 0, graduatedCount = 0;
  let learningN = 0, reviewN = 0, graduatedN = 0;

  for (const word in states) {
    const s = states[word];
    if (s.phase === PHASE.GRADUATED) graduatedN += 1;
    else if (s.phase === PHASE.REVIEW) reviewN += 1;
    else learningN += 1;
  }

  const stats = rollDailyStats(getStats());
  return {
    todayReview: stats.todayReview,
    todayDone: stats.todayDone,
    todayLearn: stats.todayLearn || 0,
    streakDays: stats.streakDays,
    totalCorrect: stats.totalCorrect,
    totalWrong: stats.totalWrong,
    learningCount: learningN,
    reviewCount: reviewN,
    graduatedCount: graduatedN
  };
}

module.exports = {
  // 常量
  QUALITY,
  PHASE,
  CONFIG,
  // 状态
  getOrCreateState,
  getWordState,
  getAllWordStates,
  markWordLearned,
  recordReview,
  // 复习列表
  getWordsToReview,
  // 同步与迁移
  restoreFromServer,
  migrateLegacyData,
  // 统计
  getEbbinghausStats
};