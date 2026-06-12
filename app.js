// app.js
App({
  globalData: {
    apiBaseUrl: 'https://api.domain.com',
    userInfo: null
  },

  onLaunch: function() {
    // 小程序启动时执行的逻辑
    console.log('古字通已启动');

    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: 'eval-lifecycle-d0gl91axndcb94db8'
      });
      console.log('云开发已初始化');
    }
  }
})
