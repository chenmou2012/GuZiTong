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
    }
  },

  onLoad: function() {
    this.checkLogin();
  },

  onShow: function() {
    this.checkLogin();
    this.loadStats();
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
    this.setData({ stats });
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

  // 同步数据
  syncData: function() {
    if (!this.data.loggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '同步中...' });

    // 同步收藏
    const collections = storage.getCollections();
    auth.saveUserData('learn', 'collections', collections)
      .then(() => {
        // 同步学习记录
        const history = storage.getHistory();
        return auth.saveUserData('learn', 'history', history);
      })
      .then(() => {
        // 同步翻译记录
        const translations = storage.getTranslations();
        return auth.saveUserData('learn', 'translations', translations);
      })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '同步成功', icon: 'success' });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: '同步失败', icon: 'none' });
      });
  },

  // 下载云端数据
  downloadData: function() {
    if (!this.data.loggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '下载中...' });

    auth.getUserData('learn')
      .then((data) => {
        wx.hideLoading();

        if (!data || Object.keys(data).length === 0) {
          wx.showToast({ title: '暂无云端数据', icon: 'none' });
          return;
        }

        // 合并数据
        if (data.collections) {
          const local = storage.getCollections();
          const cloud = data.collections;
          // 简单合并：去重
          const merged = [...local];
          cloud.forEach(item => {
            if (!local.some(l => l.word === item.word)) {
              merged.push(item);
            }
          });
          // 保存
          merged.forEach(item => storage.addCollection(item));
        }

        if (data.history) {
          const local = storage.getHistory();
          const cloud = data.history;
          const merged = [...local];
          cloud.forEach(item => {
            if (!local.some(l => l.word === item.word)) {
              merged.push(item);
            }
          });
        }

        wx.showToast({ title: '下载成功', icon: 'success' });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
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