// utils/services/quiz.js
// 出题/答题纯函数模块，供 learn.js 和 review.js 共同使用
// 提取自 learn.js 原有的 selectAnswer / autoSubmitMultiSelect / generateQuiz / buildQuizQueue
// 关键：所有函数均为无状态纯函数（不依赖 wx.* / Page 实例），便于测试

// ==================== 工具函数 ====================

/**
 * Fisher-Yates 洗牌（in-place）
 * @param {Array} arr
 * @returns {Array} 原数组（已打乱）
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 切换多选选中状态（纯函数）
 * @param {number[]} selectedIndexes
 * @param {number} idx
 * @returns {number[]} 新的索引数组
 */
function toggleMultiOption(selectedIndexes, idx) {
  if (selectedIndexes.includes(idx)) {
    return selectedIndexes.filter(i => i !== idx);
  }
  return [...selectedIndexes, idx];
}

/**
 * 评分多选题（顺序无关、长度必须相等）
 * @param {string[]} correctAnswers - 正确答案文本数组
 * @param {string[]} selectedTexts - 用户选中的文本数组
 * @returns {boolean}
 */
function gradeMultiAnswer(correctAnswers, selectedTexts) {
  if (correctAnswers.length !== selectedTexts.length) return false;
  return selectedTexts.every(t => correctAnswers.includes(t));
}

// ==================== 出题函数 ====================

/**
 * 题库索引：QUIZ_DATA 约 200KB，逐字 filter 是 O(N)。
 * 按 word 建一次 Map 后 O(1) 取题（WeakMap 按 QUIZ_DATA 引用缓存）。
 */
const _quizIndexCache = new WeakMap();

function getQuestionsByWord(word, QUIZ_DATA) {
  let index = _quizIndexCache.get(QUIZ_DATA);
  if (!index) {
    index = new Map();
    QUIZ_DATA.forEach(q => {
      if (!index.has(q.word)) index.set(q.word, []);
      index.get(q.word).push(q);
    });
    _quizIndexCache.set(QUIZ_DATA, index);
  }
  return index.get(word) || [];
}

/**
 * 拿一个字的一道多选题
 * - 从 QUIZ_DATA 中找 type='select_meanings' 的题目
 * - 找到则打乱选项、生成 optionDisplays
 * - 找不到返回 null（调用方应回退三档自评）
 *
 * @param {string} word - 关联的古字
 * @param {Array} QUIZ_DATA - 题目数据数组
 * @returns {object|null} 多选题状态对象（供 setData 写入）
 */
function getMultiSelectQuestion(word, QUIZ_DATA) {
  const candidates = getQuestionsByWord(word, QUIZ_DATA).filter(q => q.type === 'select_meanings');
  if (candidates.length === 0) return null;

  // 同字多道 multi 时随机抽一道
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const shuffledOptions = shuffleArray([...picked.options]);
  const correctAnswers = picked.options.filter(o => o.correct).map(o => o.text);

  // 记录打乱后正确答案的索引，便于 WXML 绑定 .correct/.wrong 样式
  const correctIndexes = [];
  shuffledOptions.forEach((o, i) => {
    if (o.correct) correctIndexes.push(i);
  });

  // optionDisplays 保留 correct 标志，WXML 直接用 opt.correct 渲染 .correct 类
  return {
    quiz: picked,
    options: shuffledOptions.map(o => o.text),
    optionDisplays: shuffledOptions.map((o, i) => ({
      idx: i,
      text: o.text,
      selected: false,
      correct: o.correct
    })),
    correctAnswers: correctAnswers,
    correctAnswersText: correctAnswers.join('；'),
    correctCount: correctAnswers.length,
    correctIndexes: correctIndexes,  // 索引数组（备用）
    selectedIndexes: [],
    showResult: false,
    isCorrect: false,
    pendingNext: false
  };
}

/**
 * 拿或生成一个字的多选题
 * - 优先从 QUIZ_DATA 找 type='select_meanings' 的题（多意思字原本就有）
 * - 找不到时按 wordMeanings 自动生成：所有正确选项 + 3 个干扰项（解决「只有一个意思的词语」没有选择题的问题）
 *
 * @param {string} word - 关联的古字
 * @param {Array} QUIZ_DATA - 题目数据数组
 * @param {string[]} wordMeanings - 当前字的所有意思（用于构造正确选项）
 * @param {string[]} distractorPool - 干扰项候选池（不含当前字的意思）
 * @returns {object|null} 多选题状态对象；wordMeanings 为空时返回 null
 */
function getOrGenerateMultiSelectQuestion(word, QUIZ_DATA, wordMeanings, distractorPool) {
  const existing = getMultiSelectQuestion(word, QUIZ_DATA);
  if (existing) return existing;

  if (!wordMeanings || wordMeanings.length === 0) return null;

  // 1) 正确选项
  const correctOptions = wordMeanings.map(m => ({ text: m, correct: true }));

  // 2) 干扰项：排除当前字的所有意思后随机抽 N 个，N 保证总选项 ≤ 6
  //    - 含义 < 6 时补足到 6
  //    - 含义 ≥ 6 时不加干扰项（避免选项爆炸）
  const distractorCount = Math.max(0, 6 - wordMeanings.length);
  const pool = (distractorPool || []).filter(t => !wordMeanings.includes(t));
  const distractorCopy = shuffleArray(pool.slice());
  const pickedDistractors = distractorCopy.slice(0, distractorCount).map(d => ({ text: d, correct: false }));

  // 3) 合并打乱
  const options = shuffleArray([...correctOptions, ...pickedDistractors]);

  const correctAnswers = options.filter(o => o.correct).map(o => o.text);
  const correctIndexes = [];
  options.forEach((o, i) => {
    if (o.correct) correctIndexes.push(i);
  });

  return {
    quiz: { word: word, type: 'select_meanings', options: options },
    options: options.map(o => o.text),
    optionDisplays: options.map((o, i) => ({
      idx: i,
      text: o.text,
      selected: false,
      correct: o.correct
    })),
    correctAnswers: correctAnswers,
    correctAnswersText: correctAnswers.join('；'),
    correctCount: correctAnswers.length,
    correctIndexes: correctIndexes,
    selectedIndexes: [],
    showResult: false,
    isCorrect: false,
    pendingNext: false
  };
}

module.exports = {
  shuffleArray,
  toggleMultiOption,
  gradeMultiAnswer,
  getMultiSelectQuestion,
  getOrGenerateMultiSelectQuestion,
  getQuestionsByWord
};
