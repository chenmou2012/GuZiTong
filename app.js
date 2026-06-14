// app.js
App({
  globalData: {
    apiBaseUrl: 'https://api.domain.com',
    userInfo: null,
    statusBarHeight: 20  // 状态栏高度(px)，onLaunch 时从系统信息读取
  },

  onLaunch: function() {
    // 小程序启动时执行的逻辑
    console.log('古字通已启动');

    // 自定义导航栏：读取状态栏高度，供各页面顶部留白使用
    try {
      const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync());
      if (info && info.statusBarHeight) {
        this.globalData.statusBarHeight = info.statusBarHeight;
      }
    } catch (e) {
      console.warn('读取状态栏高度失败', e);
    }

    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: 'eval-lifecycle-d0gl91axndcb94db8'
      });
      console.log('云开发已初始化');
    }
  }
})
