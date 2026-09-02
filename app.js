// app.js
const sm2 = require('./utils/services/sm2.js');
const auth = require('./utils/services/auth.js');
const storage = require('./utils/services/storage.js');
const constants = require('./utils/services/constants.js');
const logger = require('./utils/services/logger.js');
const log = logger.for('app');

App({
  globalData: {
    apiBaseUrl: constants.API_BASE_URL,
    userInfo: null,
    statusBarHeight: 20  // 状态栏高度(px)，onLaunch 时从系统信息读取
  },

  // 全局 JS 错误兜底：捕获后写日志 + 不阻塞 UI
  // 任何页面 / 模块的同步异常会先进这里，避免白屏
  onError: function(err) {
    log.error('[App.onError]', err);
    // 不弹 toast：开发期靠日志定位，线上期由 logger 统一收集
  },

  // 全局 Promise 拒绝兜底：网络失败等异步异常
  onUnhandledRejection: function(err) {
    log.error('[App.onUnhandledRejection]', err);
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

    // 静默登录 + 自动同步：登录成功（含 token 写入）后再跑全量同步
    // 失败仅 console.warn，不打扰用户
    this._autoSync();
  },

  // 静默登录：拉起 wx.login() 拿到 code → 换 openid/token → 拉取用户资料
  // - 已有 token：刷新 userInfo；若 token 过期则清除并重新登录
  // - 无 token：完整登录流程
  // - 失败：仅 console.warn，不弹 toast、不阻塞 UI
  // 返回 Promise，便于 _autoSync 串行等待登录完成
  _silentLogin: function() {
    if (auth.checkLogin()) {
      return auth.fetchUserInfo()
        .then((info) => {
          if (info) return info;
          // fetchUserInfo 遇到 401/旧版错误响应时会清除本地登录态。
          return auth.login().then(() => auth.fetchUserInfo());
        })
        .then((info) => {
          if (!info) throw new Error('重新登录后获取用户资料失败');
          log.info('[auto login] refreshed, openid=' + auth.getOpenid());
          return info;
        })
        .catch((e) => log.warn('[auto login] refresh failed:', e.message));
    }
    return auth.login()
      .then((res) => auth.fetchUserInfo())
      .then(() => log.info('[auto login] success, openid=' + auth.getOpenid()))
      .catch((e) => log.warn('[auto login] failed:', e.message));
  },

  // 自动同步：真正等静默登录（含 token 写入）完成后再跑全量同步，
  // 避免首次启动时 token 尚未写入导致同步空跑。
  _autoSync: function() {
    this._silentLogin()
      .then(() => storage.fullSync())
      .then((r) => {
        if (r.pushed || r.pulled) log.info('[auto sync] done', r);
      })
      .catch((e) => log.warn('[auto sync] failed:', e.message));
  }
})
