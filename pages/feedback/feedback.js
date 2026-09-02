// pages/feedback/feedback.js
// 意见反馈：提交内容 + 联系方式（选填），存入后端 feedbacks 表供管理后台查看处理
const auth = require('../../utils/services/auth.js');
const logger = require('../../utils/services/logger.js');
const log = logger.for('feedback');

Page({
  data: {
    content: '',
    contact: '',
    contentCount: 0,
    maxLength: 500,
    submitting: false,
    statusBarHeight: 20
  },

  onLoad: function() {
    try {
      this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
    } catch (e) {
      log.error('[feedback.onLoad] failed:', e);
    }
  },

  onContentInput: function(e) {
    this.setData({
      content: e.detail.value,
      contentCount: e.detail.value.length
    });
  },

  onContactInput: function(e) {
    this.setData({ contact: e.detail.value });
  },

  goBack: function() {
    wx.navigateBack();
  },

  submit: function() {
    if (this.data.submitting) return;
    const content = this.data.content.trim();
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' });
      return;
    }
    if (!auth.checkLogin()) {
      wx.showModal({
        title: '提示',
        content: '提交反馈需要登录，是否前往"我的"页面登录？',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.switchTab({ url: '/pages/profile/profile' });
        }
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...', mask: true });
    auth.submitFeedback(content, this.data.contact.trim()).then((ok) => {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (ok) {
        wx.showToast({ title: '感谢反馈！', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 700);
      } else {
        wx.showToast({ title: '提交失败，请稍后重试', icon: 'none' });
      }
    });
  }
});
