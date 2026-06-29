// pages/learn/learn.js
const { REAL_WORDS_DATA } = require('../../utils/services/realWords.js');
const storage = require('../../utils/services/storage.js');
const sm2 = require('../../utils/services/sm2.js');
const logger = require('../../utils/services/logger.js');
const log = logger.for('learn');
const QUIZ_DATA = require('../../utils/data/quiz_questions.js');

// 出题/答题纯函数（与 review.js 共用）
const quiz = require('../../utils/services/quiz.js');

// 模块级缓存：distractorPool 一次性构建，避免每次 buildQuizQueue 都 flatMap 全量词库
// 单字 mean 全量约 600+，每次答题错误都会重入 buildQuizQueue
let _DISTRACTOR_POOL = null;
function getDistractorPool() {
  if (!_DISTRACTOR_POOL) {
    _DISTRACTOR_POOL = REAL_WORDS_DATA.flatMap(w => (w.meanings || []).map(m => m.meaning));
  }
  return _DISTRACTOR_POOL;
}

// 学习页不暴露三按钮，根据答对状态和连续答对次数推断 quality
function inferQuality(isCorrect, consecutiveCorrect) {
  if (!isCorrect) return sm2.QUALITY.HARD;     // 答错 → 不认识 (2)
  if (consecutiveCorrect === 0) return sm2.QUALITY.GOOD;  // 首次答对 → 模糊 (3)
  return sm2.QUALITY.EASY;                     // 连续答对 → 认识 (5)
}

// 获取已学词的字面量数组（从 wordStates 派生）
function getLearnedWordList() {
  const states = sm2.getAllWordStates();
  return Object.values(states).map(s => ({
    word: s.word,
    learnedTime: s.learnedAt,
    reviewCount: s.totalReviews
  }));
}

let GROUP_SIZE = 0;  // 动态获取
const STORAGE_KEY = 'learnProgress';

Page({
  data: {
    // 学习状态
    learning: false,           // 是否已开始学习
    phase: 'intro',          // intro(展示), practice(练习), done(完成)

    // 词组
    groupWords: [],          // 当前组的词
    groupSize: 0,           // 每组字数（动态设置）
    groupIndex: 0,          // 当前组索引
    introIndex: 0,         // 当前展示的词索引
    totalGroups: 0,          // 总组数

    // 当前练习的词
    currentWordIndex: 0,     // 当前练习的词在组内的索引
    currentWord: null,         // 当前词数据
    lastWord: '',            // 上一道题的词
    quizQueue: [],           // 当前词的题目队列（所有单选打乱 + 1道多选）
    quizIndex: 0,            // 当前题目在队列中的索引
    consecutiveCorrect: 0,   // 当前词连续答对次数（用于推断 quality）

    // 测验
    quizType: 'sentence_meaning',
    quizOptions: [],
    optionDisplays: [],
    sentenceParts: null,   // 句子的高亮部分
    selectedIndex: -1,
    selectedIndexes: [],     // 多选已选中的索引
    pendingNext: false,     // 多选是否待提交
    showResult: false,
    isCorrect: false,
    quiz: {},
    correctIndex: -1,
    correctAnswers: [],
    correctCount: 0,

    // 按钮状态
        showGiveUp: false,     // 显示"我不会"按钮

    // 统计
    learnedCount: 0,
    totalCount: 0,
    currentLearningWord: '',  // 正在学习的字（字符串）

    // 复习
    reviewWords: [],

    // 自定义导航栏顶部留白
    statusBarHeight: 20
  },

  onLoad: function() {
    const groupSize = storage.getGroupSize() || 5;
    GROUP_SIZE = groupSize;
    this.setData({
      statusBarHeight: getApp().globalData.statusBarHeight,
      groupSize: groupSize
    });
    // 保存到全局
    getApp().globalData.groupSize = groupSize;
    quiz.loadFont();
    this.loadData();
  },

  // 切后台时兜底落盘进度（onUnload 不一定触发：强杀、微信被系统回收等）
  onHide: function() {
    if (this.data.learning && this.data.phase !== 'done') {
      this.saveProgress();
    }
  },

  onShow: function() {
    // 检查全局状态，如果被重置则同步
    const app = getApp();
    if (app.globalData && app.globalData.learning === false) {
      this.setData({ learning: false });
      app.globalData.learning = null; // 重置
    }

    // 每次显示时检查 groupSize 是否变化
    const currentGroupSize = getApp().globalData.groupSize || storage.getGroupSize() || 5;
    if (currentGroupSize !== this.data.groupSize) {
      GROUP_SIZE = currentGroupSize;
      this.setData({ groupSize: GROUP_SIZE });
    }

    const progress = wx.getStorageSync(STORAGE_KEY);

    // 有保存进度才恢复，否则显示主界面
    if (this.data.learning && progress && progress.learning) {
      // 非学习状态但有保存的进度，加载数据后再恢复
      this.loadData();
      setTimeout(() => {
        if (this.restoreProgress()) {
          wx.showModal({
            title: '继续学习',
            content: '检测到上次学习进度，是否继续？',
            success: (res) => {
              if (res.confirm) {
                this.setData({ learning: true });
                this.startPractice();
                wx.removeStorageSync(STORAGE_KEY);
              }
              // 取消时保留进度，下次进入仍可恢复
            }
          });
        }
      }, 500);
    } else {
      // 正常显示主界面
      this.data.learning = false;
      this.loadData();
    }
  },

  loadData: async function() {
    // 如果正在学习，不更新 learning 状态
    if (this.data.learning === true) {
      return;
    }

    // 强制设置 learning 为 false
    this.setData({ learning: false });

    const words = REAL_WORDS_DATA || [];

    // 已学词（从 wordStates 派生）
    let learned = getLearnedWordList();
    if (learned.length === 0) {
      const serverData = await storage.restoreFromServer();
      if (serverData) {
        learned = getLearnedWordList();
      }
    }

    // 同步学习列表（优先云端，本地兜底）
    let learnList = await storage.syncLearnList(words);

    // 过滤掉已掌握的词
    const learnedSet = new Set(learned.map(l => l.word));
    const toLearn = learnList.filter(w => !learnedSet.has(w.word));

    // 当前学习进度 = 已掌握数
    const currentIndex = learned.length;

    const totalGroups = Math.ceil(learnList.length / (this.data.groupSize || GROUP_SIZE || 5));

    // 计算需要复习的词（SM-2 到期字）
    const meaningsByWord = {};
    words.forEach(w => { meaningsByWord[w.word] = w.meanings; });
    const reviewWords = sm2.getWordsToReview(Date.now(), meaningsByWord).map(r => ({
      word: r.word,
      times: r.state.totalReviews,
      errors: r.state.wrongCount
    }));

    this.setData({
      totalCount: words.length,
      learnedCount: learned.length,
      currentIndex: currentIndex,
      totalGroups: totalGroups,
      allWords: toLearn,
      reviewWords: reviewWords,
      // 进度百分比
      learnProgress: Math.round((learned.length / words.length) * 100) || 0,
      reviewCount: reviewWords.length,
      // 当前正在学习的词（下一个待学习的词）
      currentLearningWord: toLearn.length > 0 ? toLearn[0].word : ''
    });
  },

  /**
   * 构造某词的练习队列：
   * 1) 所有单选（sentence_meaning）打乱
   * 2) 末尾追加 1 道多选（select_meanings）：
   *    - QUIZ_DATA 里有该字的 select_meanings 题 → 直接用
   *    - 否则按该字的所有 meaning 自动生成（正确选项 + 3 个干扰项）
   *    - 单意思词语也能保证有 1 道多选题
   */
  buildQuizQueue: function(word) {
    const singles = QUIZ_DATA.filter(q => q.word === word && q.type === 'sentence_meaning');
    const shuffled = quiz.shuffleArray([...singles]);

    const wordData = REAL_WORDS_DATA.find(w => w.word === word);
    const wordMeanings = wordData ? wordData.meanings.map(m => m.meaning) : [];
    const distractorPool = getDistractorPool();

    const multi = quiz.getOrGenerateMultiSelectQuestion(word, QUIZ_DATA, wordMeanings, distractorPool);
    if (multi) {
      return [...shuffled, multi.quiz];
    }
    return shuffled;
  },

  /**
   * 某词的题目总数（用于在 startLearn 阶段预计算本组总题数）。
   * 现在每个词都保证至少 1 道多选题，所以总数 ≥ sentence_meaning 题数 + 1
   */
  queueLengthFor: function(word) {
    const singles = QUIZ_DATA.filter(q => q.word === word && q.type === 'sentence_meaning').length;
    return singles + 1;
  },

  // 从全局词库获取额外选项（解决选项不足问题）
  getExtraOptions: function(correctAnswer, type) {
    const allWords = this.data.allWords;
    if (!allWords || allWords.length === 4) return [];

    let pool = [];
    if (type === 'context') {
      // 语境选意思：从所有词的意思中获取
      pool = allWords.flatMap(w => (w.meanings || []).map(m => m.meaning));
    } else {
      // 根据意思选句子：从所有词的例句中获取
      pool = allWords.flatMap(w => (w.meanings || []).map(m => m.example).filter(e => e));
    }

    // 过滤掉正确答案和已选选项
    const currentOptions = this.data.quizOptions || [];
    pool = pool.filter(o => o !== correctAnswer && !currentOptions.includes(o));

    quiz.shuffleArray(pool);
    return pool.slice(0, 4 - currentOptions.length);
  },

  // 保存学习进度
  saveProgress: function() {
    const { groupIndex, currentWordIndex, quizIndex, quizQueue, phase, learning } = this.data;
    const progress = {
      groupIndex,
      currentWordIndex,
      quizIndex,
      quizQueue,
      phase,
      learning,
      savedAt: Date.now()
    };
    wx.setStorageSync(STORAGE_KEY, progress);
  },

  // 恢复学习进度
  restoreProgress: function() {
    const progress = wx.getStorageSync(STORAGE_KEY);
    if (!progress) return false;

    // 检查是否在合理时间内（24小时内）
    if (Date.now() - progress.savedAt > 24 * 60 * 60 * 1000) {
      wx.removeStorageSync(STORAGE_KEY);
      return false;
    }

    // quizQueue 是题目对象数组，跨进程可能不可靠：仅恢复 quizIndex，
    // 实际题目在 startPractice 里基于 currentWord 重建。
    this.setData({
      groupIndex: progress.groupIndex || 0,
      currentWordIndex: progress.currentWordIndex || 0,
      quizIndex: progress.quizIndex || 0,
      phase: progress.phase || 'intro',
      learning: progress.learning || false
    });

    return true;
  },

  // 解析句子并返回加粗HTML
  boldWordInSentence: function(sentence, word) {
    if (!sentence || !word) return [{ text: sentence, isBold: false }];

    const parts = [];
    const regex = new RegExp(word, 'g');
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(sentence)) !== null) {
      // 添加匹配前的普通文本
      if (match.index > lastIndex) {
        parts.push({ text: sentence.slice(lastIndex, match.index), isBold: false });
      }
      // 添加匹配的加粗文本
      parts.push({ text: word, isBold: true });
      lastIndex = regex.lastIndex;
    }

    // 添加剩余文本
    if (lastIndex < sentence.length) {
      parts.push({ text: sentence.slice(lastIndex), isBold: false });
    }

    return parts;
  },

  // 展示：上一个
  prevIntro: function() {
    const { introIndex } = this.data;
    if (introIndex > 0) {
      this.setData({ introIndex: introIndex - 1 });
    }
  },

  // 展示：下一个
  nextIntro: function() {
    const { introIndex, groupSize } = this.data;
    if (introIndex < groupSize - 1) {
      this.setData({ introIndex: introIndex + 1 });
    }
  },

  // 开始学习
  startLearn: function() {
    const { allWords, groupIndex, groupSize } = this.data;
    const size = groupSize || storage.getGroupSize() || 5;

    // 获取当前组的词并随机打乱
    const startIdx = groupIndex * size;
    const groupWords = allWords.slice(startIdx, startIdx + size);
    quiz.shuffleArray(groupWords);

    if (!groupWords.length || groupWords.length < size) {
      // 词不够，重新开始
      this.loadData();
      if (this.data.allWords.length < size) {
        wx.showToast({ title: '没有更多词了', icon: 'none' });
        return;
      }
      this.setData({ groupIndex: 0 });
      return this.startLearn();
    }

    this.setData({
      learning: true,
      phase: 'intro',
      groupWords: groupWords,
      groupIndex: groupIndex,
      introIndex: 0
    });
  },

  // 开始复习
  startReview: function() {
    wx.navigateTo({
      url: '/pages/review/review'
    });
  },

  // 回到首页
  goHome: function() {
    this.setData({
      learning: false,
      phase: 'intro'
    });
  },

  // 继续学习
  continueLearn: function() {
    this.loadData();
    this.setData({
      groupIndex: 0,
      phase: 'intro'
    });
    this.startLearn();
  },

  // 进入字音跟读页
  goPronounce: function() {
    wx.navigateTo({ url: '/pages/pronounce/pronounce' });
  },

  exitLearn: function() {
    // 清除学习进度
    wx.removeStorageSync(STORAGE_KEY);
    // 重置状态 - 使用 phase 来控制显示
    this.setData({
      learning: false,
      phase: 'intro',
      groupIndex: 0,
      introIndex: 0,
      currentWordIndex: 0,
      quizIndex: 0,
      quizQueue: [],
      consecutiveCorrect: 0
    });
    // 刷新数据
    setTimeout(() => {
      this.loadData();
    }, 50);
  },

  // 复习：认识
  markReviewKnown: function(e) {
    const word = e.currentTarget.dataset.word;
    sm2.recordReview(word, sm2.QUALITY.EASY);
    this.loadData();
  },

  // 复习：不认识
  markReviewForget: function(e) {
    const word = e.currentTarget.dataset.word;
    sm2.recordReview(word, sm2.QUALITY.HARD);
    this.loadData();
  },

  // 开始练习环节
  startPractice: function() {
    const { groupWords, currentWordIndex } = this.data;
    const word = groupWords[currentWordIndex || 0];
    const quizQueue = this.buildQuizQueue(word.word);

    this.setData({
      phase: 'practice',
      currentWordIndex: currentWordIndex || 0,
      currentWord: word,
      quizQueue: quizQueue,
      quizIndex: 0,
      consecutiveCorrect: 0
    });

    this.saveProgress();
    this.generateQuiz();
  },

  // 生成测验题目
  generateQuiz: function() {
    const { currentWord, quizQueue, quizIndex } = this.data;
    if (!currentWord || !quizQueue || quizQueue.length === 0) return;

    const q = quizQueue[quizIndex];
    if (!q) return;

    const targetType = q.type;

    // 打乱选项
    const shuffledOptions = [...q.options];
    quiz.shuffleArray(shuffledOptions);

    // 记录正确答案（文本数组），用于显示
    const correctAnswers = q.options.filter(o => o.correct).map(o => o.text);

    // 单选：记录正确选项的索引（多选不依赖 correctIndex 比较）
    const correctIndex = shuffledOptions.findIndex(o => o.correct);

    // 为句子生成带高亮的 parts
    let sentenceParts = null;
    if (targetType === 'sentence_meaning' && q.sentence) {
      sentenceParts = this.boldWordInSentence(q.sentence, q.word);
    }

    const optionDisplaysWithSelected = shuffledOptions.map(o => ({
      text: o.text,
      selected: false,
      correct: o.correct
    }));

    this.setData({
      quizType: targetType,
      quiz: q,
      quizOptions: shuffledOptions.map(o => o.text),
      optionDisplays: optionDisplaysWithSelected,
      sentenceParts: sentenceParts,
      correctIndex: correctIndex,
      correctAnswers: correctAnswers,
      correctCount: correctAnswers.length,
      selectedIndex: -1,
      selectedIndexes: [],
      showResult: false,
      showGiveUp: false,
      lastWord: currentWord.word
    });
  },

  // 选择答案
  selectAnswer: function(e) {
    const { showResult, quizType, selectedIndexes, selectedIndex, correctIndex } = this.data;
    if (showResult) return;

    const index = Number(e.currentTarget.dataset.index);
    const { currentWord } = this.data;

    let newSelectedIndexes;
    let isCorrect;

    if (quizType === 'select_meanings') {
      // 多选：切换选中状态（用 quiz.js 纯函数）
      const newSelectedIndexes = quiz.toggleMultiOption(this.data.selectedIndexes, index);
      // 更新 optionDisplays 的 selected 属性
      const optionDisplays = this.data.optionDisplays.map((opt, i) => ({
        ...opt,
        selected: newSelectedIndexes.includes(i)
      }));
      this.setData({
        selectedIndexes: newSelectedIndexes,
        optionDisplays: optionDisplays
      });
      return;
    } else {
      // 单选：选择后直接跳转下一题
      const { correctIndex } = this.data;
      const correct = index === correctIndex;
      isCorrect = correct;

      // 播放音效反馈
      if (correct) {
        wx.vibrateShort({ success: () => {} });
      } else {
        wx.vibrateLong({ success: () => {} });
      }

      this.setData({
        selectedIndex: index,
        showResult: true,
        isCorrect: correct,
        showGiveUp: true
      });

      // SM-2：按连续答对次数推断 quality 记录复习
      sm2.recordReview(currentWord.word, inferQuality(correct, this.data.consecutiveCorrect));

      // 实时更新已学数量和进度
      const learnedCount = Object.keys(sm2.getAllWordStates()).length;
      const words = storage.getLearnList() || [];
      this.setData({
        learnedCount: learnedCount,
        learnProgress: Math.round((learnedCount / (words.length || 150)) * 100) || 0
      });

      this.saveProgress();

      // 单选：不自动跳转，等待用户点击下一题
    }
  },

  // 自动提交多选
  autoSubmitMultiSelect: function(selectedIndexes) {
    const { correctAnswers, optionDisplays, currentWord } = this.data;

    // 用 quiz.js 纯函数评分（顺序无关、长度必须相等）
    const selectedTexts = selectedIndexes.map(i => optionDisplays[i].text);
    const isCorrect = quiz.gradeMultiAnswer(correctAnswers, selectedTexts);

    if (isCorrect) {
      wx.vibrateShort({ success: () => {} });
    } else {
      wx.vibrateLong({ success: () => {} });
    }

    this.setData({
      showResult: true,
      isCorrect: isCorrect,
      showGiveUp: true
    });

    // SM-2：按连续答对次数推断 quality 记录复习
    sm2.recordReview(currentWord.word, inferQuality(isCorrect, this.data.consecutiveCorrect));

    // 实时更新已学数量和进度
    const learnedCount = Object.keys(sm2.getAllWordStates()).length;
    const words = storage.getLearnList() || [];
    this.setData({
      learnedCount: learnedCount,
      learnProgress: Math.round((learnedCount / (words.length || 150)) * 100) || 0
    });

    this.saveProgress();
  },

  // 确认多选答案（保留兼容）
  confirmMultiSelect: function() {
    const { selectedIndexes } = this.data;
    this.autoSubmitMultiSelect(selectedIndexes);
  },

  // 下一题
  nextQuestion: function() {
    const { quizType, showResult, selectedIndexes, pendingNext } = this.data;

    // 多选题：第一次点击提交显示结果，第二次点击跳转
    if (quizType === 'select_meanings') {
      if (selectedIndexes.length > 0 && !showResult) {
        // 第一次点击，提交并标记，显示结果
        this.autoSubmitMultiSelect(selectedIndexes);
        this.setData({ pendingNext: true });
        return;
      } else if (showResult && pendingNext) {
        // 第二次点击，直接跳转
        this.setData({ pendingNext: false });
        return this.goToNextQuestion();
      }
    }

    return this.goToNextQuestion();
  },

  goToNextQuestion: function() {
    const {
      currentWordIndex, quizIndex, quizQueue, groupWords,
      groupIndex, totalGroups, lastWord, isCorrect, currentWord
    } = this.data;

    // 1) 答错：重新打乱当前字的题库，从头开始
    if (!isCorrect) {
      const reshuffled = this.buildQuizQueue(currentWord.word);
      this.setData({
        quizQueue: reshuffled,
        quizIndex: 0,
        consecutiveCorrect: 0
      });
      this.saveProgress();
      this.generateQuiz();
      return;
    }

    // 2) 答对且还有未做的题：推进到下一题
    if (quizIndex < quizQueue.length - 1) {
      this.setData({
        quizIndex: quizIndex + 1,
        consecutiveCorrect: this.data.consecutiveCorrect + 1
      });
      this.saveProgress();
      this.generateQuiz();
      return;
    }

    // 3) 当前字的所有题已答完，进入下一个字
    let newWordIndex = currentWordIndex + 1;

    // 避免连续出现同一道词（虽然 groupWords 已经 shuffle 过，这里保留保险）
    while (newWordIndex < groupWords.length && groupWords[newWordIndex].word === lastWord) {
      newWordIndex++;
    }

    // 当前组做完，标记本组词为已学习
    if (newWordIndex >= groupWords.length) {
      groupWords.forEach(w => {
        sm2.markWordLearned(w.word);
      });

      // 检查是否还有下一组
      const nextGroupIndex = groupIndex + 1;
      if (nextGroupIndex >= totalGroups) {
        // 没有更多组了，跳转到完成页面
        // 先重置 learning 状态，否则 done 页 navigateBack 回 learn 时
        // data.learning 仍为 true，会阻止 loadData 刷新数据
        this.setData({ learning: false });
        wx.navigateTo({
          url: '/pages/done/done?count=' + this.data.learnedCount
        });
        return;
      }

      // 跳转到本组完成页面
      const learnedCount = groupWords.length;
      this.setData({ groupIndex: nextGroupIndex, learning: false });
      wx.navigateTo({
        url: '/pages/groupdone/groupdone?groupIndex=' + groupIndex + '&count=' + learnedCount
      });
      return;
    }

    // 跳到下一字
    const nextWord = groupWords[newWordIndex];
    this.setData({
      currentWordIndex: newWordIndex,
      currentWord: nextWord,
      quizQueue: this.buildQuizQueue(nextWord.word),
      quizIndex: 0,
      consecutiveCorrect: 0
    });

    this.generateQuiz();
  },

  // 我不会 - 显示答案
  giveUp: function() {
    const { currentWord } = this.data;

    this.setData({
      selectedIndex: -1,
      showResult: true,
      isCorrect: false,
      showGiveUp: false
    });

    // SM-2：放弃视为不认识
    sm2.recordReview(currentWord.word, sm2.QUALITY.HARD);

    this.saveProgress();
  },

  // 重新学习当前词（重新打乱当前字的题库）
  retryWord: function() {
    const { currentWord } = this.data;
    if (!currentWord) return;
    this.setData({
      quizQueue: this.buildQuizQueue(currentWord.word),
      quizIndex: 0,
      consecutiveCorrect: 0
    });
    this.generateQuiz();
  },

  onPullDownRefresh: function() {
    this.loadData();
    wx.stopPullDownRefresh();
  }
});