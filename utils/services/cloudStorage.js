// 云端存储服务
// 使用微信云开发存储学习数据

let cloudDb = null;
let isInitialized = false;

// 初始化云开发
function init() {
  if (isInitialized) return;

  if (wx.cloud) {
    wx.cloud.init({
      env: 'eval-lifecycle-d0gl91axndcb94db8'
    });
    cloudDb = wx.cloud.database();
    isInitialized = true;
    console.log('云存储已初始化');
  }
}

// 检查是否启用云端存储
function isEnabled() {
  return wx.cloud && isInitialized;
}

// ==================== 搜索记录同步 ====================

function getCloudSearchHistory(openId) {
  return new Promise((resolve) => {
    if (!cloudDb) {
      resolve(null);
      return;
    }

    cloudDb.collection('searchHistory')
      .where({ _openid: openId })
      .get()
      .then(res => {
        resolve(res.data.length > 0 ? res.data[0].history : []);
      })
      .catch(() => resolve(null));
  });
}

function saveCloudSearchHistory(openId, history) {
  return new Promise(() => {
    if (!cloudDb) return;

    cloudDb.collection('searchHistory')
      .where({ _openid: openId })
      .get()
      .then(res => {
        if (res.data.length > 0) {
          cloudDb.collection('searchHistory')
            .doc(res.data[0]._id)
            .update({
              data: {
                history: history,
                updateTime: Date.now()
              }
            });
        } else {
          cloudDb.collection('searchHistory')
            .add({
              data: {
                _openid: openId,
                history: history,
                createTime: Date.now(),
                updateTime: Date.now()
              }
            });
        }
      });
  });
}

// ==================== 学习数据同步 ====================

// 从云端获取学习数据
function getCloudLearnedWords(openId) {
  return new Promise((resolve, reject) => {
    if (!cloudDb) {
      resolve(null);
      return;
    }

    cloudDb.collection('learnedWords')
      .where({ _openid: openId })
      .get()
      .then(res => {
        resolve(res.data.length > 0 ? res.data[0].words : []);
      })
      .catch(err => {
        console.error('获取云端学习数据失败', err);
        resolve(null);
      });
  });
}

// 保存学习数据到云端
function saveCloudLearnedWords(openId, words) {
  return new Promise((resolve, reject) => {
    if (!cloudDb) {
      resolve();
      return;
    }

    // 先查询是否存在
    cloudDb.collection('learnedWords')
      .where({ _openid: openId })
      .get()
      .then(res => {
        if (res.data.length > 0) {
          // 更新
          cloudDb.collection('learnedWords')
            .doc(res.data[0]._id)
            .update({
              data: {
                words: words,
                updateTime: Date.now()
              }
            })
            .then(() => resolve())
            .catch(err => reject(err));
        } else {
          // 添加
          cloudDb.collection('learnedWords')
            .add({
              data: {
                _openid: openId,
                words: words,
                createTime: Date.now(),
                updateTime: Date.now()
              }
            })
            .then(() => resolve())
            .catch(err => reject(err));
        }
      })
      .catch(err => reject(err));
  });
}

// 同步本地和云端数据
async function syncLearnedWords() {
  if (!wx.cloud) {
    console.log('云开发未启用');
    return;
  }

  // 获取openId
  const openId = await getOpenId();
  if (!openId) return;

  // 获取本地数据
  const localWords = wx.getStorageSync('learnedWords') || [];

  // 获取云端数据
  const cloudWords = await getCloudLearnedWords(openId);

  if (cloudWords === null) {
    // 云端无数据，上传本地数据
    await saveCloudLearnedWords(openId, localWords);
    console.log('已上传本地学习数据到云端');
  } else {
    // 合并数据（取最新）
    const merged = mergeWordData(localWords, cloudWords);
    wx.setStorageSync('learnedWords', merged);
    await saveCloudLearnedWords(openId, merged);
    console.log('已合并本地和云端数据');
  }
}

// 合并学习数据（去重，保留最新）
function mergeWordData(local, cloud) {
  const map = new Map();

  // 先添加云端数据
  cloud.forEach(item => {
    map.set(item.word, item);
  });

  // 再添加本地数据（覆盖）
  local.forEach(item => {
    map.set(item.word, item);
  });

  return Array.from(map.values());
}

// 保存学习列表到云端
function saveCloudLearnList(openId, list) {
  return new Promise((resolve, reject) => {
    if (!cloudDb) {
      resolve();
      return;
    }

    cloudDb.collection('learnList')
      .where({ _openid: openId })
      .get()
      .then(res => {
        if (res.data.length > 0) {
          // 更新
          cloudDb.collection('learnList')
            .doc(res.data[0]._id)
            .update({
              data: {
                list: list,
                updateTime: Date.now()
              }
            })
            .then(() => resolve())
            .catch(reject);
        } else {
          // 新增
          cloudDb.collection('learnList')
            .add({
              data: {
                list: list,
                createTime: Date.now(),
                updateTime: Date.now()
              }
            })
            .then(() => resolve())
            .catch(reject);
        }
      })
      .catch(reject);
  });
}

// 获取云端学习列表
function getCloudLearnList(openId) {
  return new Promise((resolve) => {
    if (!cloudDb) {
      resolve(null);
      return;
    }

    cloudDb.collection('learnList')
      .where({ _openid: openId })
      .get()
      .then(res => {
        resolve(res.data.length > 0 ? res.data[0].list : null);
      })
      .catch(() => {
        resolve(null);
      });
  });
}

// 获取用户openid
function getOpenId() {
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'getOpenId',
      data: {},
      success: res => {
        resolve(res.result.openId);
      },
      fail: () => {
        resolve(null);
      }
    });
  });
}

// ==================== 复习记录同步 ====================

function getCloudReviewRecords(openId) {
  return new Promise((resolve) => {
    if (!cloudDb) {
      resolve(null);
      return;
    }

    cloudDb.collection('reviewRecords')
      .where({ _openid: openId })
      .get()
      .then(res => {
        resolve(res.data.length > 0 ? res.data[0].records : []);
      })
      .catch(() => resolve(null));
  });
}

function saveCloudReviewRecords(openId, records) {
  return new Promise(() => {
    if (!cloudDb) return;

    cloudDb.collection('reviewRecords')
      .where({ _openid: openId })
      .get()
      .then(res => {
        if (res.data.length > 0) {
          cloudDb.collection('reviewRecords')
            .doc(res.data[0]._id)
            .update({
              data: {
                records: records,
                updateTime: Date.now()
              }
            });
        } else {
          cloudDb.collection('reviewRecords')
            .add({
              data: {
                _openid: openId,
                records: records,
                createTime: Date.now(),
                updateTime: Date.now()
              }
            });
        }
      });
  });
}

// ==================== 用户设置同步 ====================

function getCloudSettings(openId) {
  return new Promise((resolve) => {
    if (!cloudDb) {
      resolve(null);
      return;
    }

    cloudDb.collection('userSettings')
      .where({ _openid: openId })
      .get()
      .then(res => {
        resolve(res.data.length > 0 ? res.data[0] : null);
      })
      .catch(() => resolve(null));
  });
}

function saveCloudSettings(openId, settings) {
  return new Promise(() => {
    if (!cloudDb) return;

    cloudDb.collection('userSettings')
      .where({ _openid: openId })
      .get()
      .then(res => {
        if (res.data.length > 0) {
          cloudDb.collection('userSettings')
            .doc(res.data[0]._id)
            .update({
              data: settings
            });
        } else {
          cloudDb.collection('userSettings')
            .add({
              data: {
                _openid: openId,
                ...settings,
                createTime: Date.now()
              }
            });
        }
      });
  });
}

// 启用云端存储
function enableCloudStorage() {
  init();
}

module.exports = {
  init,
  isEnabled,
  getOpenId,
  // 搜索记录
  getCloudSearchHistory,
  saveCloudSearchHistory,
  // 学习数据
  getCloudLearnedWords,
  saveCloudLearnedWords,
  syncLearnedWords,
  // 学习列表
  getCloudLearnList,
  saveCloudLearnList,
  // 复习记录
  getCloudReviewRecords,
  saveCloudReviewRecords,
  // 用户设置
  getCloudSettings,
  saveCloudSettings,
  // 启用
  enableCloudStorage
};