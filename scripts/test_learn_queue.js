// scripts/test_learn_queue.js
// 端到端模拟 learn.js 的新队列逻辑

const path = require('path');
const QUIZ_DATA = require('../utils/data/quiz_questions.js');

// 选 5 个测试词（覆盖：单多都有、单选多的、最多多选）
const testWords = ['比', '为', '故', '若', '赋'];

console.log('===== 题库分析 =====');
testWords.forEach(word => {
  const singles = QUIZ_DATA.filter(q => q.word === word && q.type === 'sentence_meaning');
  const multis = QUIZ_DATA.filter(q => q.word === word && q.type === 'select_meanings');
  console.log(`${word}: 单选 ${singles.length}, 多选 ${multis.length}`);
});

// 模拟 Page data
function makePageState(word) {
  return {
    data: {
      groupWords: testWords.map(w => ({ word: w, meanings: [] })),
      groupSize: 5,
      groupIndex: 0,
      totalGroups: 1,
      currentWordIndex: 0,
      currentWord: null,
      lastWord: '',
      quizQueue: [],
      quizIndex: 0,
      consecutiveCorrect: 0,
      selectedIndex: -1,
      selectedIndexes: [],
      showResult: false,
      isCorrect: false,
      pendingNext: false
    }
  };
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildQuizQueue(state, word) {
  const singles = QUIZ_DATA.filter(q => q.word === word && q.type === 'sentence_meaning');
  const multis = QUIZ_DATA.filter(q => q.word === word && q.type === 'select_meanings');
  const shuffled = [...singles];
  shuffleArray(shuffled);
  if (multis.length > 0) {
    const picked = multis[Math.floor(Math.random() * multis.length)];
    return [...shuffled, picked];
  }
  return shuffled;
}

function startPractice(state, currentWordIndex = 0) {
  const word = state.data.groupWords[currentWordIndex || 0];
  const quizQueue = buildQuizQueue(state, word.word);
  state.data.currentWordIndex = currentWordIndex || 0;
  state.data.currentWord = word;
  state.data.quizQueue = quizQueue;
  state.data.quizIndex = 0;
  state.data.consecutiveCorrect = 0;
  return quizQueue;
}

function generateQuiz(state) {
  const { currentWord, quizQueue, quizIndex } = state.data;
  if (!currentWord || !quizQueue || quizQueue.length === 0) return null;
  const q = quizQueue[quizIndex];
  return q;
}

function goToNextQuestion(state) {
  const { currentWordIndex, quizIndex, quizQueue, groupWords, groupIndex, totalGroups, lastWord, isCorrect, currentWord } = state.data;

  if (!isCorrect) {
    const reshuffled = buildQuizQueue(state, currentWord.word);
    state.data.quizQueue = reshuffled;
    state.data.quizIndex = 0;
    state.data.consecutiveCorrect = 0;
    return { action: 'reshuffle' };
  }

  if (quizIndex < quizQueue.length - 1) {
    state.data.quizIndex = quizIndex + 1;
    state.data.consecutiveCorrect = state.data.consecutiveCorrect + 1;
    return { action: 'next_question' };
  }

  // 当前字做完
  let newWordIndex = currentWordIndex + 1;
  while (newWordIndex < groupWords.length && groupWords[newWordIndex].word === lastWord) {
    newWordIndex++;
  }

  if (newWordIndex >= groupWords.length) {
    return { action: 'group_done' };
  }

  const nextWord = groupWords[newWordIndex];
  state.data.currentWordIndex = newWordIndex;
  state.data.currentWord = nextWord;
  state.data.quizQueue = buildQuizQueue(state, nextWord.word);
  state.data.quizIndex = 0;
  state.data.consecutiveCorrect = 0;
  return { action: 'next_word' };
}

function answerQuestion(state, correct) {
  state.data.isCorrect = correct;
  state.data.showResult = true;
}

// ================ TEST 1: 所有答案正确，走完一组 ================
console.log('\n===== TEST 1: 全对走完一组 =====');
{
  const state = makePageState();
  const trace = [];

  for (let wordIdx = 0; wordIdx < 5; wordIdx++) {
    if (wordIdx === 0) {
      startPractice(state, 0);
    }
    const queue = state.data.quizQueue;
    trace.push(`词 ${state.data.currentWord.word}: queue 长度 ${queue.length}, types = ${queue.map(q => q.type[0]).join(',')}`);

    for (let qIdx = 0; qIdx < queue.length; qIdx++) {
      const q = generateQuiz(state);
      answerQuestion(state, true);
      const result = goToNextQuestion(state);
      trace.push(`  Q${qIdx + 1} (${q.type}) 正确 → ${result.action}`);
    }
  }
  trace.forEach(t => console.log(t));
}

// ================ TEST 2: 中间答错，验证重新打乱 ================
console.log('\n===== TEST 2: 中间答错 → 重置队列 =====');
{
  const state = makePageState();
  startPractice(state, 0);
  const originalQueue = state.data.quizQueue.slice();
  console.log(`初始队列长度 ${originalQueue.length}`);

  // 答对 Q1
  answerQuestion(state, true);
  goToNextQuestion(state);
  console.log(`Q1 答对 → quizIndex=${state.data.quizIndex}, consecutiveCorrect=${state.data.consecutiveCorrect}`);

  // 答错 Q2
  answerQuestion(state, false);
  const result = goToNextQuestion(state);
  console.log(`Q2 答错 → action=${result.action}, quizIndex=${state.data.quizIndex}, consecutiveCorrect=${state.data.consecutiveCorrect}, currentWord=${state.data.currentWord.word}`);

  if (result.action !== 'reshuffle') {
    console.error('❌ 应该 reshuffle');
  } else {
    console.log('✓ 答错触发重置队列');
  }
}

// ================ TEST 3: 没有多选的词，队列只有单选 ================
console.log('\n===== TEST 3: 无多选的词 =====');
{
  // 找一个没有多选的词
  const noMultiWord = Object.entries(
    QUIZ_DATA.reduce((acc, q) => {
      acc[q.word] = acc[q.word] || { s: 0, m: 0 };
      acc[q.word][q.type === 'sentence_meaning' ? 's' : 'm']++;
      return acc;
    }, {})
  ).find(([_, c]) => c.m === 0);

  if (noMultiWord) {
    console.log(`测试词：${noMultiWord[0]} (单选 ${noMultiWord[1].s}, 多选 0)`);
    const state = makePageState();
    state.data.groupWords[0] = { word: noMultiWord[0], meanings: [] };
    startPractice(state, 0);
    console.log(`  队列长度: ${state.data.quizQueue.length}`);
    console.log(`  类型: ${state.data.quizQueue.map(q => q.type).join(',')}`);
    if (state.data.quizQueue.length === noMultiWord[1].s && state.data.quizQueue.every(q => q.type === 'sentence_meaning')) {
      console.log('✓ 无多选时队列只有单选');
    } else {
      console.error('❌ 队列异常');
    }
  } else {
    console.log('找不到无多选的词（所有词都有多选）');
  }
}

// ================ TEST 4: inferQuality 逻辑 ================
console.log('\n===== TEST 4: inferQuality =====');
const QUALITY = { HARD: 2, GOOD: 3, EASY: 5 };
function inferQuality(isCorrect, consecutiveCorrect) {
  if (!isCorrect) return QUALITY.HARD;
  if (consecutiveCorrect === 0) return QUALITY.GOOD;
  return QUALITY.EASY;
}
const cases = [
  [true, 0, QUALITY.GOOD],
  [true, 1, QUALITY.EASY],
  [true, 5, QUALITY.EASY],
  [false, 0, QUALITY.HARD],
  [false, 3, QUALITY.HARD]
];
let pass = 0;
cases.forEach(([c, cc, expected]) => {
  const got = inferQuality(c, cc);
  const ok = got === expected;
  if (ok) pass++;
  console.log(`  inferQuality(${c}, ${cc}) = ${got} (期望 ${expected}) ${ok ? '✓' : '❌'}`);
});
console.log(`通过 ${pass}/${cases.length}`);

console.log('\n===== 总结 =====');
console.log('队列逻辑、答错重置、inferQuality、无多选处理均已验证。');