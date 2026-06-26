// pages/profile/profile.js
const storage = require('../../utils/services/storage');
const sm2 = require('../../utils/services/sm2');
const auth = require('../../utils/services/auth');

Page({
  data: {
    loggedIn: false,
    userInfo: null,
    displayNickname: '点击登录',
    editingNickname: false,
    nicknameDraft: '',
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
    this._refreshDisplayNickname();
  },

  // 计算并刷新显示用的昵称：已设置 → 用之；未登录 → "点击登录"；登录但未设置 → 默认昵称
  _refreshDisplayNickname: function() {
    const ui = this.data.userInfo;
    let name;
    if (ui && ui.nickname) {
      name = ui.nickname;
    } else if (!this.data.loggedIn) {
      name = '点击登录';
    } else {
      name = auth.getDefaultNickname();
    }
    this.setData({ displayNickname: name });
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

  // 头像/未登录昵称点击：未登录 → 登录；已登录 → 进入昵称编辑
  onAvatarTap: function() {
    if (!this.data.loggedIn) {
      this.doLogin();
    } else {
      this.onNicknameEdit();
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
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '登录失败', icon: 'none' });
      });
  },

  // 昵称编辑：进入编辑态（用 displayNickname 作为初值，统一的回退逻辑）
  onNicknameEdit: function() {
    if (!this.data.loggedIn) return;
    this.setData({ editingNickname: true, nicknameDraft: this.data.displayNickname });
  },

  // 昵称输入实时同步到 draft
  onNicknameInput: function(e) {
    this.setData({ nicknameDraft: e.detail.value });
  },

  // 保存昵称
  onNicknameSave: async function() {
    const name = (this.data.nicknameDraft || '').trim();
    if (!name) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    if (name.length > 16) {
      wx.showToast({ title: '昵称最多 16 个字符', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });
    const ok = await auth.updateUserInfo(name, null);
    wx.hideLoading();
    if (!ok) {
      wx.showToast({ title: '保存失败', icon: 'none' });
      return;
    }

    // updateUserInfo 内部已更新本地缓存，重新读取再 setData 让 UI 立即刷新
    const info = auth.getUserInfo() || {};
    this.setData({
      userInfo: info,
      editingNickname: false,
      nicknameDraft: ''
    });
    this._refreshDisplayNickname();
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  // 取消编辑
  onNicknameCancel: function() {
    this.setData({ editingNickname: false, nicknameDraft: '' });
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
          this._refreshDisplayNickname();
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