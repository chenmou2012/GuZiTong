// app.js
const sm2 = require('./utils/services/sm2.js');
const auth = require('./utils/services/auth.js');

App({
  globalData: {
    apiBaseUrl: 'https://api.domain.com',
    userInfo: null,
    statusBarHeight: 20  // 状态栏高度(px)，onLaunch 时从系统信息读取
  },

  onLaunch: function() {
    // 小程序启动时执行的逻辑
    console.log('古字通已启动');

    // SM-2 数据迁移（幂等）
    try {
      const result = sm2.migrateLegacyData();
      console.log('SM-2 迁移:', result);
    } catch (e) {
      console.warn('SM-2 迁移失败', e);
    }

    // 自定义导航栏：读取状态栏高度，供各页面顶部留白使用
    try {
      const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync());
      if (info && info.statusBarHeight) {
        this.globalData.statusBarHeight = info.statusBarHeight;
      }
    } catch (e) {
      console.warn('读取状态栏高度失败', e);
    }

    // 静默登录：调 wx.login() 换 code → 后端 code2session → 写入 token
    // 失败不阻塞启动（用户仍可在"我的"页手动触发登录）
    this._silentLogin();

    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: 'eval-lifecycle-d0gl91axndcb94db8'
      });
      console.log('云开发已初始化');
    }
  },

  // 静默登录：拉起 wx.login() 拿到 code → 换 openid/token → 拉取用户资料
  // - 已有 token：仅刷新 userInfo（防止后端昵称变更后前端不一致）
  // - 无 token：完整登录流程
  // - 失败：仅 console.warn，不弹 toast、不阻塞 UI
  _silentLogin: function() {
    if (auth.checkLogin()) {
      auth.fetchUserInfo().catch((e) => console.warn('[auto login] refresh failed:', e.message));
      return;
    }
    auth.login()
      .then((res) => auth.fetchUserInfo())
      .then(() => console.log('[auto login] success, openid=' + auth.getOpenid()))
      .catch((e) => console.warn('[auto login] failed:', e.message));
  }
})
