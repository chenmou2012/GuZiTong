// app.js
const sm2 = require('./utils/services/sm2.js');
const auth = require('./utils/services/auth.js');
const storage = require('./utils/services/storage.js');
const logger = require('./utils/services/logger.js');
const log = logger.for('app');

App({
  globalData: {
    apiBaseUrl: 'https://api.domain.com',
    userInfo: null,
    statusBarHeight: 20  // 状态栏高度(px)，onLaunch 时从系统信息读取
  },

  onLaunch: function() {
    // 小程序启动时执行的逻辑
    log.info('古字通已启动');

    // SM-2 数据迁移（幂等）
    try {
      const result = sm2.migrateLegacyData();
      log.info('SM-2 迁移:', result);
    } catch (e) {
      log.warn('SM-2 迁移失败', e);
    }

    // 自定义导航栏：读取状态栏高度，供各页面顶部留白使用
    try {
      const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync());
      if (info && info.statusBarHeight) {
        this.globalData.statusBarHeight = info.statusBarHeight;
      }
    } catch (e) {
      log.warn('读取状态栏高度失败', e);
    }

    // 静默登录：调 wx.login() 换 code → 后端 code2session → 写入 token
    // 失败不阻塞启动（用户仍可在"我的"页手动触发登录）
    this._silentLogin();

    // 自动同步：登录成功后后台跑全量同步（推送本地 + 拉取云端 + 合并）
    // 失败仅 console.warn，不打扰用户
    this._autoSync();

    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: 'eval-lifecycle-d0gl91axndcb94db8'
      });
      log.info('云开发已初始化');
    }
  },

  // 静默登录：拉起 wx.login() 拿到 code → 换 openid/token → 拉取用户资料
  // - 已有 token：仅刷新 userInfo（防止后端昵称变更后前端不一致）
  // - 无 token：完整登录流程
  // - 失败：仅 console.warn，不弹 toast、不阻塞 UI
  _silentLogin: function() {
    if (auth.checkLogin()) {
      auth.fetchUserInfo().catch((e) => log.warn('[auto login] refresh failed:', e.message));
      return;
    }
    auth.login()
      .then((res) => auth.fetchUserInfo())
      .then(() => log.info('[auto login] success, openid=' + auth.getOpenid()))
      .catch((e) => log.warn('[auto login] failed:', e.message));
  },

  // 自动同步：登录态下后台跑一次全量同步（推送 + 拉取 + 合并）。
  // 必须在 _silentLogin 完成后调用（依赖 token），故放在微任务末尾串行触发。
  _autoSync: function() {
    // 等静默登录先跑完（即便失败也无所谓，不阻塞同步逻辑）
    Promise.resolve()
      .then(() => storage.fullSync())
      .then((r) => {
        if (r.pushed || r.pulled) log.info('[auto sync] done', r);
      })
      .catch((e) => log.warn('[auto sync] failed:', e.message));
  }
})
