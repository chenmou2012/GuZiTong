// pages/realwords/realwords.js
const API_BASE_URL = 'https://share.sng-oj.cn';

// 中考常用150个文言实词
const REAL_WORDS = [
  '爱', '安', '案', '把', '罢', '霸', '拜', '班', '邦', '保', '报', '备', '北', '倍', '本', '逼', '彼', '笔', '必', '闭', '敝', '边', '便', '别', '宾', '病', '布', '步', '部', '财',
  '参', '策', '曾', '察', '尝', '潮', '臣', '辰', '称', '诚', '持', '池', '斥', '赤', '冲', '初', '除', '传', '创', '春', '辞', '刺', '从', '窜', '错', '达', '带', '待', '怠',
  '旦', '当', '道', '得', '德', '敌', '典', '殿', '刁', '吊', '调', '动', '斗', '度', '端', '断', '恶', '而', '尔', '发', '伐', '乏', '犯', '方', '防', '非', '费', '分', '丰', '风',
  '夫', '扶', '拂', '服', '浮', '负', '复', '赴', '赋', '干', '敢', '告', '格', '更', '工', '攻', '功', '故', '顾', '固', '观', '官', '冠', '归', '诡', '贵', '国', '果',
  '过', '害', '好', '合', '和', '核', '恨', '后', '厚', '胡', '华', '化', '划', '还', '环', '黄', '回', '毁', '惠', '活', '火', '或', '货', '获', '击', '积', '激', '即', '疾',
  '及', '极', '急', '济', '寄', '兼', '监', '见', '贱', '渐', '谏', '奖', '讲', '交', '矫', '接', '节', '结', '解', '介', '戒', '届', '金', '尽', '劲', '进', '晋', '浸', '惊', '井', '竞', '久', '酒', '救', '居', '局', '举', '聚', '距', '卷', '决', '绝', '军', '开', '克', '刻', '空', '孔', '口', '跨', '溃', '赖', '览', '劳',
  '老', '乐', '泪', '类', '离', '里', '理', '力', '连', '良', '量', '列', '烈', '临', '邻', '铃', '灵', '领', '留', '流', '论', '落', '麻', '漫', '冒', '貌', '密', '免', '面', '名', '明', '命', '末', '莫', '谋', '某', '墓', '幕', '乃', '内', '难', '男', '南', '能', '泥', '年', '念', '宁', '牛', '扭', '纽', '怒', '女', '偶', '怕', '判', '培', '佩', '疲', '篇', '偏', '骗', '贫', '平', '凭', '破', '扑', '普', '期', '戚', '旗', '其', '起', '器', '迁', '巧', '切', '且', '亲', '侵', '秦', '琴', '轻', '请', '穷', '丘', '求', '取', '趣', '去', '权', '却', '确', '群', '然', '燃', '让', '饶', '任', '日', '容', '如', '若', '弱', '塞', '三', '色', '杀', '删', '伤', '少', '绍', '舍', '射', '设', '审', '甚', '时', '食', '史', '士', '氏', '室', '是', '手', '书', '树', '双', '水', '税', '顺', '说', '丝', '死', '四', '虽', '随', '岁', '遂', '孙', '太', '谈', '汤', '逃', '提', '体', '天', '填', '听', '庭', '同', '头', '图', '土', '推', '退', '托', '外', '玩', '亡', '望', '为', '谓', '文', '闻', '问', '我', '握', '无', '勿', '西', '悉', '熄', '喜', '下', '鲜', '咸', '详', '效', '邪', '写', '谢', '行', '姓', '休', '秀', '虚', '许', '续', '寻', '严', '研', '验', '阳', '仰', '要', '宜', '已', '以', '义', '易', '益', '阴', '引', '印', '盈', '影', '应', '勇', '用', '幽', '游', '右', '于', '渔', '予', '欲', '喻', '远', '月', '悦', '晕', '在', '择', '责', '增', '章', '掌', '丈', '障', '昭', '召', '折', '正', '之', '至', '志', '治', '致', '众', '周', '州', '珠', '诸', '竹', '注', '专', '砖', '转', '壮', '追', '准', '浊', '资', '子', '自', '走', '卒', '坐'
];

/**
 * 解析 Markdown 文本
 */
function parseMarkdown(markdown) {
  if (!markdown) return null;

  const result = {
    raw: markdown,
    pinyin: '',
    meanings: []
  };

  const lines = markdown.split('\n');
  let currentPos = '';
  let currentMeaning = '';
  let currentExample = '';
  let currentSource = '';
  let inMeaning = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 读音
    if (line.startsWith('## 读音') || line.startsWith('# 读音')) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine) {
        result.pinyin = nextLine.replace(/^[【\[].*[】\]]/, '').trim();
      }
      continue;
    }

    // 义项
    const meaningMatch = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*(.+)$/);
    if (meaningMatch) {
      if (currentMeaning) {
        result.meanings.push({
          pos: currentPos,
          meaning: currentMeaning,
          example: currentExample,
          source: currentSource
        });
      }
      const posText = meaningMatch[2];
      const posMatch = posText.match(/【(.+?)】/);
      if (posMatch) {
        currentPos = posMatch[1];
        currentMeaning = posText.substring(posMatch[0].length) + meaningMatch[3];
      } else {
        currentPos = posText.replace(/【|】/g, '');
        currentMeaning = meaningMatch[3];
      }
      currentExample = '';
      currentSource = '';
      inMeaning = true;
      continue;
    }

    // 例句
    const exampleMatch = line.match(/^-\s*例句[：:](.+?)【(.+?)】$/);
    if (exampleMatch && inMeaning) {
      currentExample = exampleMatch[1].trim();
      currentSource = exampleMatch[2].trim();
      continue;
    }

    const simpleExampleMatch = line.match(/^-\s*例句[：:](.+)$/);
    if (simpleExampleMatch && inMeaning) {
      currentExample = simpleExampleMatch[1].trim();
      continue;
    }

    if (inMeaning && line && !line.startsWith('#') && !line.startsWith('-')) {
      currentMeaning += ' ' + line;
    }
  }

  if (currentMeaning) {
    result.meanings.push({
      pos: currentPos,
      meaning: currentMeaning,
      example: currentExample,
      source: currentSource
    });
  }

  return result;
}

Page({
  data: {
    realWords: REAL_WORDS,
    isLoading: false,
    result: {},
    resultParsed: null,
    streamingText: ''
  },

  onLoad: function() {},

  onShow: function() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
    this.setData({
      isLoading: false,
      result: {},
      resultParsed: null,
      streamingText: ''
    });
  },

  // 点击实词查询
  onWordTap: function(e) {
    const word = e.currentTarget.dataset.word;
    // 保存到全局数据，跳转后查询
    wx.setStorageSync('pendingQuery', word);
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  queryWord: function(word) {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }

    this.setData({
      isLoading: true,
      result: {},
      resultParsed: null,
      streamingText: ''
    });

    wx.showLoading({
      title: '正在查询...',
      mask: true
    });

    const that = this;
    const host = API_BASE_URL.replace('http://', '').replace('https://', '');
    const wsUrl = (API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://') + host;

    this.socketTask = wx.connectSocket({
      url: wsUrl + '/ws/query',
      header: {},
      method: 'GET',
      protocols: []
    });

    this.socketTask.onOpen(function(res) {
      that.socketTask.send({
        data: JSON.stringify({ text: word })
      });
    });

    this.socketTask.onMessage(function(res) {
      try {
        const data = JSON.parse(res.data);

        if (data.error) {
          wx.hideLoading();
          wx.showToast({ title: data.error, icon: 'none' });
          that.setData({ isLoading: false });
          return;
        }

        if (data.type === 'content') {
          const newText = that.data.streamingText + data.content;
          that.setData({
            streamingText: newText
          });
          return;
        }

        if (data.type === 'done') {
          wx.hideLoading();
          const parsed = parseMarkdown(that.data.streamingText);
          that.setData({
            isLoading: false,
            result: { content: that.data.streamingText },
            resultParsed: parsed
          });
          if (that.socketTask) {
            that.socketTask.close();
            that.socketTask = null;
          }
          return;
        }
      } catch (e) {
        console.error('解析失败:', e);
      }
    });

    this.socketTask.onError(function(res) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
      that.setData({ isLoading: false });
    });

    this.socketTask.onClose(function(res) {
      if (that.data.isLoading && that.data.streamingText) {
        wx.hideLoading();
        const parsed = parseMarkdown(that.data.streamingText);
        that.setData({
          isLoading: false,
          resultParsed: parsed
        });
      }
    });
  },

  // 关闭结果
  closeResult: function() {
    this.setData({
      result: {},
      resultParsed: null,
      streamingText: ''
    });
  },

  // 收藏
  toggleCollect: function() {
    const word = this.data.resultParsed?.pinyin ? this.data.streamingText : '';
    if (!word) return;

    let collections = wx.getStorageSync('collections') || [];
    const index = collections.findIndex(item => item.word === word);

    if (index > -1) {
      collections.splice(index, 1);
      wx.showToast({ title: '已取消收藏', icon: 'success' });
    } else {
      collections.push({
        word: word,
        result: this.data.streamingText,
        time: Date.now()
      });
      wx.showToast({ title: '收藏成功', icon: 'success' });
    }

    wx.setStorageSync('collections', collections);
  },

  onPullDownRefresh: function() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
    this.setData({
      result: {},
      resultParsed: null,
      streamingText: ''
    });
    wx.stopPullDownRefresh();
  },

  onUnload: function() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
  }
});