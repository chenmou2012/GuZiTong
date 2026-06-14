// pages/profile/profile.js
const storage = require('../../utils/services/storage');
const auth = require('../../utils/services/auth');

Page({
  data: {
    loggedIn: false,
    userInfo: null,
    stats: {
      words: 0,
      collections: 0,
      translations: 0
    },
    reviewStats: {
      todayReview: 0,
      todayDone: 0,
      streakDays: 0,
      totalCorrect: 0,
      totalWrong: 0,
      stageCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    },
    pieChart: {
      unlearned: 0,
      reviewing: 0,
      reviewed: 0,
      unlearnedPercent: 0,
      reviewingPercent: 0,
      reviewedPercent: 0
    },
    statusBarHeight: 20,
    settings: {},
    showSettingsModal: false
  },

  onLoad: function() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
    this.checkLogin();
    this.loadSettings();
  },

  loadSettings: function() {
    const settings = storage.getSettings();
    this.setData({ settings });
  },

  // 修改每组字数
  changeGroupSize: function(e) {
    const size = parseInt(e.currentTarget.dataset.size);
    storage.setGroupSize(size);
    this.setData({
      settings: Object.assign(this.data.settings, { groupSize: size })
    });
    wx.showToast({ title: '已更新', icon: 'success' });
  },

  // 显示设置弹窗
  showSettings: function() {
    this.setData({ showSettingsModal: true });
  },

  // 关闭设置弹窗
  hideSettings: function() {
    this.setData({ showSettingsModal: false });
  },

  onShow: function() {
    this.checkLogin();
    this.loadStats();
    // 尝试从服务器恢复复习统计
    storage.restoreReviewStatsFromServer();
  },

  checkLogin: function() {
    const loggedIn = auth.checkLogin();
    const userInfo = auth.getUserInfo();
    this.setData({
      loggedIn: loggedIn,
      userInfo: userInfo
    });
  },

  loadStats: function() {
    const stats = storage.getStats();
    const reviewStats = storage.getEbbinghausStats();
    const learned = storage.getLearnedWords() || [];

    // 计算饼图数据
    const totalWords = 150;
    const learnedCount = learned.length;

    // 根据艾宾浩斯阶段计算复习状态
    // 阶段: 1, 2, 4, 7, 15, 30 天 (最大阶段为 6)
    const stage = reviewStats?.ebbinghausStage || {};
    let reviewing = 0;
    let reviewed = 0;

    learned.forEach(w => {
      const wordStage = stage[w.word] || 0;
      if (wordStage >= 6) {
        reviewed++; // 阶段6（30天）已完成
      } else {
        reviewing++; // 未完成复习
      }
    });

    // 未学习 = 总数 - 已学习
    const unlearned = Math.max(0, totalWords - learnedCount);

    // 计算角度
    const total = unlearned + reviewing + reviewed || 1;
    const unlearnedAngle = (unlearned / total) * 360;
    const reviewingAngle = (reviewing / total) * 360;

    const pieChart = {
      unlearned,
      reviewing,
      reviewed,
      unlearnedPercent: unlearnedAngle,
      reviewingPercent: reviewingAngle,
      reviewedPercent: 360 - unlearnedAngle - reviewingAngle
    };

    this.setData({ stats, reviewStats, pieChart });
  },

  // 登录/登出
  handleLogin: function() {
    if (this.data.loggedIn) {
      // 登出
      wx.showModal({
        title: '提示',
        content: '确定要退出登录吗？',
        success: (res) => {
          if (res.confirm) {
            auth.logout();
            this.setData({ loggedIn: false, userInfo: null });
            wx.showToast({ title: '已退出', icon: 'success' });
          }
        }
      });
    } else {
      // 登录
      wx.showLoading({ title: '登录中...' });
      auth.login()
        .then(() => {
          return auth.fetchUserInfo();
        })
        .then(() => {
          this.checkLogin();
          wx.hideLoading();
          wx.showToast({ title: '登录成功', icon: 'success' });
        })
        .catch((err) => {
          wx.hideLoading();
          wx.showToast({ title: err.message || '登录失败', icon: 'none' });
        });
    }
  },

  // 同步数据（上传并下载合并）
  syncData: function() {
    if (!this.data.loggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '同步中...' });

    // 先上传本地数据到云端
    const collections = storage.getCollections();
    const history = storage.getHistory();

    auth.saveUserData('learn', 'collections', collections)
      .then(() => auth.saveUserData('learn', 'history', history))
      .then(() => auth.getUserData('learn'))
      .then((cloudData) => {
        // 合并云端数据
        if (cloudData && cloudData.collections) {
          const local = storage.getCollections();
          const cloud = cloudData.collections;
          const merged = [...local];
          cloud.forEach(item => {
            if (!local.some(l => l.word === item.word)) {
              merged.push(item);
            }
          });
          merged.forEach(item => storage.addCollection(item));
        }

        if (cloudData && cloudData.history) {
          const local = storage.getHistory();
          const cloud = cloudData.history;
          cloud.forEach(item => {
            if (!local.some(l => l.word === item.word)) {
              storage.addHistory(item);
            }
          });
        }

        wx.hideLoading();
        wx.showToast({ title: '同步成功', icon: 'success' });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: '同步失败', icon: 'none' });
      });
  },

  viewHistory: function() {
    const history = storage.getHistory();
    if (history.length === 0) {
      wx.showToast({
        title: '暂无学习记录',
        icon: 'none'
      });
      return;
    }
    wx.showModal({
      title: '学习记录',
      content: history.slice(0, 10).map((item, i) => `${i + 1}. ${item.word}`).join('\n'),
      showCancel: false
    });
  },

  viewCollections: function() {
    const collections = storage.getCollections();
    if (collections.length === 0) {
      wx.showToast({
        title: '暂无收藏',
        icon: 'none'
      });
      return;
    }
    wx.showModal({
      title: '我的收藏',
      content: collections.slice(0, 10).map((item, i) => `${i + 1}. ${item.word}`).join('\n'),
      showCancel: false
    });
  },

  viewTranslations: function() {
    const translations = storage.getTranslations();
    if (translations.length === 0) {
      wx.showToast({
        title: '暂无翻译记录',
        icon: 'none'
      });
      return;
    }
    wx.showModal({
      title: '翻译历史',
      content: translations.slice(0, 5).map((item, i) => `${i + 1}. ${item.original}`).join('\n'),
      showCancel: false
    });
  },

  viewAbout: function() {
    wx.showModal({
      title: '关于',
      content: '古字通 v1.0.0\n\n为初中生打造的文言文学习工具。\n\n联系我们：chenmou2012@outlook.com',
      showCancel: false
    });
  }
});