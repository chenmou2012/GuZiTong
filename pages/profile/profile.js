// pages/profile/profile.js
const storage = require('../../utils/services/storage');
const sm2 = require('../../utils/services/sm2');
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
      todayLearn: 0,
      todayReview: 0,
      todayDone: 0,
      streakDays: 0,
      totalCorrect: 0,
      totalWrong: 0,
      learningCount: 0,
      reviewCount: 0,
      graduatedCount: 0
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

  changeGroupSize: function(e) {
    const size = parseInt(e.currentTarget.dataset.size);
    storage.setGroupSize(size);
    this.setData({
      settings: Object.assign(this.data.settings, { groupSize: size })
    });
    getApp().globalData = getApp().globalData || {};
    getApp().globalData.groupSize = size;
    wx.showToast({ title: '已更新', icon: 'success' });
  },

  showSettings: function() {
    this.setData({ showSettingsModal: true });
  },

  hideSettings: function() {
    this.setData({ showSettingsModal: false });
  },

  onShow: function() {
    this.checkLogin();
    this.loadSettings();
    this.loadStats();
    storage.restoreFromServer().then(() => this.loadStats());
  },

  checkLogin: function() {
    const loggedIn = auth.checkLogin();
    const userInfo = auth.getUserInfo();
    this.setData({ loggedIn, userInfo });
  },

  loadStats: function() {
    const stats = storage.getStats();
    const reviewStats = sm2.getEbbinghausStats();
    const states = sm2.getAllWordStates();

    const totalWords = 150;
    const learnedCount = Object.keys(states).length;

    let reviewing = 0;
    let reviewed = 0;
    for (const word in states) {
      const s = states[word];
      if (s.phase === sm2.PHASE.GRADUATED) {
        reviewed++;
      } else {
        reviewing++;
      }
    }

    const unlearned = Math.max(0, totalWords - learnedCount);
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

  // 头像点击：未登录 → 登录；已登录 → 编辑资料
  onAvatarTap: function() {
    if (!this.data.loggedIn) {
      this.doLogin();
    } else {
      this.authorizeProfile();
    }
  },

  doLogin: function() {
    wx.showLoading({ title: '登录中...' });
    auth.login()
      .then(() => auth.fetchUserInfo())
      .then((info) => {
        this.checkLogin();
        wx.hideLoading();
        wx.showToast({ title: '登录成功', icon: 'success' });
        if (info && !info.nickname) {
          this.authorizeProfile();
        }
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '登录失败', icon: 'none' });
      });
  },

  // 引导用户授权微信昵称/头像
  authorizeProfile: async function() {
    const result = await auth.requestAndSaveProfile();
    if (result) {
      const info = Object.assign({}, this.data.userInfo || {}, {
        nickname: result.nickname,
        avatar: result.avatar
      });
      this.setData({ userInfo: info });
      wx.showToast({ title: '已更新资料', icon: 'success' });
    } else {
      wx.showToast({ title: '已取消', icon: 'none' });
    }
  },

  // 退出登录
  doLogout: function() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          auth.logout();
          this.hideSettings();
          this.setData({ loggedIn: false, userInfo: null });
          wx.showToast({ title: '已退出', icon: 'success' });
        }
      }
    });
  },

  // 同步数据
  syncData: function() {
    if (!this.data.loggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '同步中...' });

    const collections = storage.getCollections();
    const history = storage.getHistory();

    auth.saveUserData('learn', 'collections', collections)
      .then(() => auth.saveUserData('search', 'history', history))
      .then(() => auth.getUserData('learn'))
      .then((cloudData) => {
        if (cloudData && cloudData.collections) {
          const local = storage.getCollections();
          const cloud = cloudData.collections;
          cloud.forEach(item => {
            if (!local.some(l => l.word === item.word)) {
              storage.addCollection(item.word, item.result);
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

  // 子页面跳转
  goHistory: function() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goCollections: function() {
    wx.navigateTo({ url: '/pages/collections/collections' });
  },

  goTranslations: function() {
    wx.navigateTo({ url: '/pages/translations/translations' });
  },

  viewAbout: function() {
    wx.showModal({
      title: '关于古字通',
      content: '古字通 v1.0.0\n\n为初中生打造的文言文学习工具。\n\n联系我们：chenmou2012@outlook.com',
      showCancel: false
    });
  }
});