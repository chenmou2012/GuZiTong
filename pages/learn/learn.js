// pages/learn/learn.js
const { REAL_WORDS_DATA } = require('../../utils/services/realWords.js');
const storage = require('../../utils/services/storage.js');
const QUIZ_DATA = require('../../utils/data/quiz_questions.js');

// 加载 EB Garamond 字体（小程序无法用相对路径加载包内字体，必须用网络地址或 base64 data URI）
const EB_GARAMOND_FONT = require('../../utils/fonts/ebGaramond.js');
let fontLoaded = false;

function loadFont() {
  if (fontLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    wx.loadFontFace({
      global: true,
      family: 'EB Garamond',
      source: 'url("' + EB_GARAMOND_FONT + '")',
      success: () => {
        fontLoaded = true;
        console.log('字体加载成功');
        resolve();
      },
      fail: (err) => {
        console.log('字体加载失败', err);
        resolve(); // 不阻塞
      }
    });
  });
}

let GROUP_SIZE = 5;
const TOTAL_PRACTICE = 2;  // 1次sentence_meaning + 1次select_meanings
const STORAGE_KEY = 'learnProgress';
const PRACTICE_CONTEXT = 2;  // 偶数次：语境选意思 (0, 2)
const PRACTICE_SENTENCE = 3; // 奇数次：根据意思选句子 (1, 3)

Page({
  data: {
    // 学习状态
    learning: false,           // 是否已开始学习
    phase: 'intro',          // intro(展示), practice(练习), done(完成)

    // 词组
    groupWords: [],          // 当前组的5个词
    groupIndex: 0,          // 当前组索引
    introIndex: 0,         // 当前展示的词索引
    totalGroups: 0,          // 总组数

    // 当前练习的词
    currentWordIndex: 0,     // 当前练习的词在组内的索引
    currentWord: null,         // 当前词数据
    lastWord: '',            // 上一道题的词
    practiceCount: 0,          // 当前词已练习次数

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
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
    GROUP_SIZE = storage.getGroupSize() || 5;
    loadFont();
    this.loadData();
  },

  // 刷新进度显示
  refreshProgress: function() {
    const learned = storage.getLearnedWords() || [];
    const words = storage.getLearnList() || [];
    this.setData({
      learnedCount: learned.length,
      learnProgress: Math.round((learned.length / (words.length || 150)) * 100) || 0
    });
  },

  onShow: function() {
    // 每次显示页面时刷新进度
    this.refreshProgress();

    const progress = wx.getStorageSync(STORAGE_KEY);

    if (this.data.learning) {
      this.loadData();
    } else if (progress && progress.learning) {
      // 非学习状态但有保存的进度，加载数据后再恢复
      this.loadData();
      // 延迟检查恢复（等待数据加载完成）
      setTimeout(() => {
        if (this.restoreProgress()) {
          wx.showModal({
            title: '继续学习',
            content: '检测到上次学习进度，是否继续？',
            success: (res) => {
              if (res.confirm) {
                this.setData({ learning: true });
                this.startPractice();
              }
              wx.removeStorageSync(STORAGE_KEY);
            }
          });
        }
      }, 500);
    }
  },

  loadData: async function() {
    const words = REAL_WORDS_DATA || [];

    // 先尝试从服务器恢复学习数据
    let learned = storage.getLearnedWords() || [];
    if (learned.length === 0) {
      const serverData = await storage.restoreFromServer();
      if (serverData && serverData.length > 0) {
        learned = serverData;
        console.log('从服务器恢复学习数据:', learned.length, '个词');
      }
    }

    // 尝试从云端同步数据
    if (wx.cloud) {
      storage.enableCloudSync();
    }

    // 同步学习列表（优先云端，本地兜底）
    let learnList = await storage.syncLearnList(words);

    // 过滤掉已掌握的词
    const toLearn = learnList.filter(w => !learned.some(l => l.word === w.word));

    // 当前学习进度 = 已掌握数
    const currentIndex = learned.length;

    const totalGroups = Math.ceil(learnList.length / GROUP_SIZE);

    // 计算需要复习的词
    const reviewWords = this.calculateReview(learned);

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

  // 计算需要复习的词（根据艾宾浩斯遗忘曲线）
  calculateReview: function(learned) {
    const now = Date.now();
    const result = [];
    const intervals = [1, 2, 4, 7, 15, 30];  // 天数
    const learnList = storage.getLearnList() || [];

    // 只复习 learnList 中学过的词
    const learnedWords = new Set(learned.map(l => l.word));

    learnList.forEach(w => {
      if (!learnedWords.has(w.word)) return;

      const lastReview = storage.getLastReviewTime(w.word) || w.learnedTime || 0;
      const errorCount = storage.getErrorCount(w.word) || 0;
      const reviewCount = w.reviewCount || 0;

      // 根据错误次数增加复习频率
      const baseInterval = intervals[Math.min(reviewCount, intervals.length - 1)];
      const interval = baseInterval * 24 * 60 * 60 * 1000 * (errorCount > 2 ? 0.5 : 1);

      if (now - lastReview >= interval) {
        result.push({ word: w.word, times: reviewCount, errors: errorCount });
      }
    });

    return result;
  },

  shuffleArray: function(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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

    this.shuffleArray(pool);
    return pool.slice(0, 4 - currentOptions.length);
  },

  // 保存学习进度
  saveProgress: function() {
    const { groupIndex, currentWordIndex, practiceCount, phase, learning } = this.data;
    const progress = {
      groupIndex,
      currentWordIndex,
      practiceCount,
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

    this.setData({
      groupIndex: progress.groupIndex || 0,
      currentWordIndex: progress.currentWordIndex || 0,
      practiceCount: progress.practiceCount || 0,
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
    const { introIndex } = this.data;
    if (introIndex < 4) {
      this.setData({ introIndex: introIndex + 1 });
    }
  },

  // 开始学习
  startLearn: function() {
    const { allWords, groupIndex } = this.data;

    // 获取当前组的5个词并随机打乱
    const startIdx = groupIndex * GROUP_SIZE;
    const groupWords = allWords.slice(startIdx, startIdx + GROUP_SIZE);
    this.shuffleArray(groupWords);

    if (!groupWords.length || groupWords.length < GROUP_SIZE) {
      // 词不够5个，重新开始
      this.loadData();
      if (this.data.allWords.length < GROUP_SIZE) {
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
    // 直接返回，不保存
    this.setData({
      learning: false,
      phase: 'intro'
    });
  },

  // 复习：认识
  markReviewKnown: function(e) {
    const word = e.currentTarget.dataset.word;
    storage.updateReviewTime(word, true);
    this.loadData();
  },

  // 复习：不认识
  markReviewForget: function(e) {
    const word = e.currentTarget.dataset.word;
    storage.updateReviewTime(word, false);
    this.loadData();
  },

  // 开始练习环节
  startPractice: function() {
    const { groupWords } = this.data;

    this.setData({
      phase: 'practice',
      currentWordIndex: 0,
      practiceCount: 0,
      currentWord: groupWords[0]
    });

    this.generateQuiz();
  },

  // 生成测验题目
  generateQuiz: function() {
    const { currentWord, practiceCount } = this.data;
    if (!currentWord) return;

    // 偶数次：sentence_meaning（单选），奇数次：select_meanings（多选）
    // 检查当前词有几个意思
    const wordMeanings = currentWord.meanings || [];
    const hasMultipleMeanings = wordMeanings.length >= 2;

    // 如果只有1个意思，只能做单选题
    const targetType = (!hasMultipleMeanings || practiceCount % 2 === 0) ? 'sentence_meaning' : 'select_meanings';
    console.log('generateQuiz:', { word: currentWord.word, targetType, practiceCount, hasMultipleMeanings });

    // 从预生成数据中查找题目
    const wordQuestions = QUIZ_DATA.filter(q => q.word === currentWord.word && q.type === targetType);

    // 如果没找到多选题（词只有1个意思），改用单选题
    if (wordQuestions.length === 0 && targetType === 'select_meanings') {
      console.log('没有多选题，改用单选');
      targetType = 'sentence_meaning';
    }

    console.log('found questions:', wordQuestions.length);

    if (wordQuestions.length > 0) {
      // 使用预生成的题目
      const q = wordQuestions[0];
      const shuffledOptions = [...q.options];
      this.shuffleArray(shuffledOptions);

      // 查找正确选项在打乱后的索引
      let correctIndex = -1;
      if (targetType === 'sentence_meaning') {
        correctIndex = shuffledOptions.findIndex(o => o.correct);
      } else {
        // select_meanings: 多个正确答案
        correctIndex = shuffledOptions.findIndex(o => o.correct);
      }

      // 记录正确答案的文本（用于显示）
      const correctAnswers = q.options.filter(o => o.correct).map(o => o.text);

      // 为句子生成带高亮的 parts
      let sentenceParts = null;
      if (targetType === 'sentence_meaning' && q.sentence) {
        sentenceParts = this.boldWordInSentence(q.sentence, q.word);
      }

      // 为每个选项添加 selected 属性
      const optionDisplaysWithSelected = shuffledOptions.map((o, i) => ({
        text: o.text,
        selected: false
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
      console.log('setData correctIndex:', correctIndex);
      return;
    }

    // 降级：如果没有预生成数据则显示空
    console.log('NO QUESTIONS FOUND for', currentWord.word, targetType);
  },

  // 选择答案
  selectAnswer: function(e) {
    const { showResult, quizType, selectedIndexes, selectedIndex, correctIndex } = this.data;
    if (showResult) return;

    const index = Number(e.currentTarget.dataset.index);
    console.log('selectAnswer:', { index, selectedIndex, correctIndex, quizType });
    const { quiz, currentWord } = this.data;

    let newSelectedIndexes;
    let isCorrect;

    if (quizType === 'select_meanings') {
      // 多选：切换选中状态
      if (selectedIndexes.includes(index)) {
        newSelectedIndexes = selectedIndexes.filter(i => i !== index);
      } else {
        newSelectedIndexes = [...selectedIndexes, index];
      }
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

      // 更新复习统计
      storage.updateReviewStats(correct, currentWord.word);

      // 实时更新已学数量和进度
      const learned = storage.getLearnedWords() || [];
      const words = storage.getLearnList() || [];
      this.setData({
        learnedCount: learned.length,
        learnProgress: Math.round((learned.length / (words.length || 150)) * 100) || 0
      });

      // 单选：不自动跳转，等待用户点击下一题
    }
  },

  // 自动提交多选
  autoSubmitMultiSelect: function(selectedIndexes) {
    const { correctAnswers, optionDisplays, currentWord } = this.data;

    const isCorrect = correctAnswers.length === selectedIndexes.length &&
      selectedIndexes.every(i => {
        const text = optionDisplays[i].text;
        return correctAnswers.includes(text);
      });

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

    storage.updateReviewStats(isCorrect, currentWord.word);

    // 实时更新已学数量和进度
    const learned = storage.getLearnedWords() || [];
    const words = storage.getLearnList() || [];
    this.setData({
      learnedCount: learned.length,
      learnProgress: Math.round((learned.length / (words.length || 150)) * 100) || 0
    });
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
    const { currentWordIndex, practiceCount, groupWords, groupIndex, totalGroups, lastWord, isCorrect } = this.data;

    let newPracticeCount = practiceCount + 1;
    let newWordIndex = currentWordIndex;

    // 答错了，重新练习当前词
    if (!isCorrect) {
      newPracticeCount = 0;
    }

    // 当前词4次用完了，进入下一个词
    if (newPracticeCount >= TOTAL_PRACTICE) {
      newPracticeCount = 0;
      newWordIndex = currentWordIndex + 1;

      // 避免连续出现同一道题
      while (newWordIndex < groupWords.length && groupWords[newWordIndex].word === lastWord) {
        newWordIndex++;
      }
    }

    // 当前组5个词都用完了或找不到不重复的词
    if (newWordIndex >= groupWords.length) {
      console.log('一组学完:', { groupIndex, totalGroups, groupWords: groupWords.length });
      // 标记当前组所有词为已学习
      groupWords.forEach(w => {
        storage.markWordLearned(w.word);
      });

      // 检查是否还有下一组
      const nextGroupIndex = groupIndex + 1;
      if (nextGroupIndex >= totalGroups) {
        console.log('没有更多组了');
        // 没有更多组了，跳转到完成页面
        wx.navigateTo({
          url: '/pages/done/done?count=' + this.data.learnedCount
        });
        return;
      }

      // 跳转到本组完成页面
      const learnedCount = groupWords.length;
      this.setData({ groupIndex: nextGroupIndex });
      wx.navigateTo({
        url: '/pages/groupdone/groupdone?groupIndex=' + groupIndex + '&count=' + learnedCount
      });
      return;
    }

    this.setData({
      currentWordIndex: newWordIndex,
      practiceCount: newPracticeCount,
      currentWord: groupWords[newWordIndex]
    });

    this.generateQuiz();
  },

  // 我不会 - 显示答案
  giveUp: function() {
    const { quiz, currentWord } = this.data;

    this.setData({
      selectedIndex: -1,
      showResult: true,
      isCorrect: false,
      showGiveUp: false
    });

    // 记录错误次数
    storage.incrementErrorCount(currentWord.word);
  },

  // 重新学习当前词
  retryWord: function() {
    const { practiceCount } = this.data;
    this.setData({
      practiceCount: practiceCount
    });
    this.generateQuiz();
  },

  onPullDownRefresh: function() {
    this.loadData();
    wx.stopPullDownRefresh();
  }
});