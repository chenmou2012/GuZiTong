// pages/learn/learn.js
const { REAL_WORDS_DATA } = require('../../utils/services/realWords.js');
const storage = require('../../utils/services/storage.js');
const QUIZ_DATA = require('../../utils/data/quiz_questions.json');

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

const GROUP_SIZE = 5;
const TOTAL_PRACTICE = 4;
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
    quizType: 'context',      // context(语境选意思), sentence(根据意思选句子)
    quizOptions: [],
    optionDisplays: [],
    selectedIndex: -1,
    showResult: false,
    isCorrect: false,
    quiz: {},

    // 按钮状态
    showMarkKnown: false,    // 显示"标熟"按钮
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
    loadFont();
    this.loadData();
  },

  onShow: function() {
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
    const learned = storage.getLearnedWords() || [];

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
    const intervals = [1, 3, 7, 15, 30];  // 天数
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
    this.setData({
      learning: true,
      phase: 'review'
    });
  },

  // 回到首页
  goHome: function() {
    this.setData({
      learning: false,
      phase: 'intro'
    });
  },

  // 进入字音跟读页
  goPronounce: function() {
    wx.navigateTo({ url: '/pages/pronounce/pronounce' });
  },

  exitLearn: function() {
    wx.showModal({
      title: '退出学习',
      content: '确定要退出当前学习吗？\n\n进度将被保存，下次可继续。',
      success: (res) => {
        if (res.confirm) {
          // 保存进度后再退出
          this.saveProgress();
          this.setData({
            learning: false,
            phase: 'intro'
          });
        }
      }
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

    // 确定测验类型
    // 偶数次(0,2)：sentence_meaning（根据句子选意思）
    // 奇数次(1,3)：select_meanings（选择全部释义）
    const targetType = practiceCount % 2 === 0 ? 'sentence_meaning' : 'select_meanings';

    // 从预生成数据中查找题目
    const wordQuestions = QUIZ_DATA.filter(q => q.word === currentWord.word && q.type === targetType);

    if (wordQuestions.length > 0) {
      // 使用预生成的题目
      const q = wordQuestions[0];
      const shuffledOptions = [...q.options];
      this.shuffleArray(shuffledOptions);

      // 查找正确选项索引
      let correctIndex = -1;
      if (targetType === 'sentence_meaning') {
        correctIndex = shuffledOptions.findIndex(o => o.correct);
      } else {
        // select_meanings: 多个正确答案
        correctIndex = shuffledOptions.findIndex(o => o.correct);
      }

      this.setData({
        quizType: targetType,
        quiz: q,
        quizOptions: shuffledOptions.map(o => o.text),
        optionDisplays: shuffledOptions.map(o => ({ text: o.text, parts: null })),
        selectedIndex: -1,
        showResult: false,
        showMarkKnown: false,
        showGiveUp: false,
        lastWord: currentWord.word
      });
      return;
    }

    // 降级：使用本地生成逻辑（如果没有预生成数据）
    // ... 原有的本地生成逻辑保持不变 ...

    // Fisher-Yates 洗牌算法
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    const correctIdx = options.indexOf(quiz.correctAnswer);
    quiz.correctIndex = correctIdx;

    // 生成选项的显示文本（加粗）
    const optionDisplays = options.map(opt => {
      if (quizType === 'sentence') {
        // 根据意思选句子：选项是句子，需要加粗词
        return {
          text: opt,
          parts: this.boldWordInSentence(opt, currentWord.word)
        };
      } else {
        // 语境选意思：选项是意思，不需要加粗
        return { text: opt, parts: null };
      }
    });

    this.setData({
      quizType: quizType,
      quiz: quiz,
      quizOptions: options,
      optionDisplays: optionDisplays,
      selectedIndex: -1,
      showResult: false,
      showMarkKnown: false,
      showGiveUp: false,
      lastWord: currentWord.word
    });
  },

  // 选择答案
  selectAnswer: function(e) {
    const { showResult } = this.data;
    if (showResult) return;

    const index = e.currentTarget.dataset.index;
    const { quiz, currentWord, practiceCount } = this.data;

    const correct = index === quiz.correctIndex;

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
      showMarkKnown: true,
      showGiveUp: true
    });

    // 更新复习统计
    storage.updateReviewStats(correct, currentWord.word);

    if (!correct) {
      // 错一道：重置 practiceCount = 0，重新练习4次
      setTimeout(() => {
        this.setData({
          practiceCount: 0  // 重置为0，重新练习
        });
        this.generateQuiz();
      }, 1500);
    }
  },

  // 下一题
  nextQuestion: function() {
    const { currentWordIndex, practiceCount, groupWords, groupIndex, totalGroups, lastWord } = this.data;

    let newPracticeCount = practiceCount + 1;
    let newWordIndex = currentWordIndex;

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
      // 进入下一组
      const nextGroupIndex = groupIndex + 1;
      if (nextGroupIndex >= totalGroups) {
        // 没有更多组了
        wx.showModal({
          title: '恭喜！',
          content: '本轮学习完成！',
          showCancel: false,
          success: () => {
            this.setData({
              learning: false,
              phase: 'intro'
            });
          }
        });
        return;
      }

      // 进入下一组
      this.setData({ groupIndex: nextGroupIndex });
      this.startLearn();
      return;
    }

    this.setData({
      currentWordIndex: newWordIndex,
      practiceCount: newPracticeCount,
      currentWord: groupWords[newWordIndex]
    });

    this.generateQuiz();
  },

  // 标熟 - 标记已掌握，跳过此词
  markKnown: function() {
    const { currentWord, groupWords, currentWordIndex, practiceCount, groupIndex, totalGroups } = this.data;

    // 标记为已掌握
    storage.markWordLearned(currentWord.word);

    // 实时更新已学数量
    const learned = storage.getLearnedWords() || [];
    this.setData({ learnedCount: learned.length });

    // 跳到下一个词
    let newWordIndex = currentWordIndex + 1;
    let newPracticeCount = 0;

    if (newWordIndex >= groupWords.length) {
      const nextGroupIndex = groupIndex + 1;
      if (nextGroupIndex >= totalGroups) {
        wx.showModal({
          title: '恭喜！',
          content: '本轮学习完成！',
          showCancel: false,
          success: () => {
            this.setData({
              learning: false,
              phase: 'intro'
            });
          }
        });
        return;
      }
      this.setData({ groupIndex: nextGroupIndex });
      this.startLearn();
      return;
    }

    this.setData({
      currentWordIndex: newWordIndex,
      practiceCount: newPracticeCount,
      currentWord: groupWords[newWordIndex]
    });

    this.generateQuiz();
  },

  // 我不会 - 显示答案，跳过此题
  giveUp: function() {
    const { quiz, currentWord, practiceCount } = this.data;

    this.setData({
      selectedIndex: -1,
      showResult: true,
      isCorrect: false,
      showMarkKnown: true,
      showGiveUp: false
    });

    // 记录错误次数
    storage.incrementErrorCount(currentWord.word);

    // 错误：这个词重来
    setTimeout(() => {
      this.setData({
        practiceCount: practiceCount
      });
      this.generateQuiz();
    }, 1500);
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