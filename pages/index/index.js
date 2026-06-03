// pages/index/index.js
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

// 中考高频实词
const HIGH_FREQ_REAL_WORDS = ['卑', '兵', '病', '乘', '持', '从', '达', '当', '道'];

/**
 * 简易 Markdown 转 HTML
 */
function markdownToHtml(markdown) {
  if (!markdown) return '';

  // 转义 HTML 特殊字符
  var escaped = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Markdown 转换
  var html = escaped
    // 标题 ## xxx
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // 加粗 **xxx**
    .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')
    // 数字列表 1. xxx
    .replace(/^(\d+)\.\s+(.+)$/gm, '<p><b>$1. </b>$2</p>')
    // 短横线列表项 - xxx
    .replace(/^-\s+(.+)$/gm, '<p class="indent">$1</p>')
    // 换行转为 br
    .replace(/\n/g, '<br>');

  return html;
}

Page({
  data: {
    inputText: '',
    currentQuery: '',
    quickWords: ['之', '其', '而', '以', '何', '于'],
    showResult: false,
    isLoading: false,
    showError: false,
    errorMessage: '',
    result: {},
    resultHtml: '',
    isCollected: false,
    hasHistory: false,
    showQuickWords: true,
    inputCollapsed: false,
    resultAnimation: {},
    realWords: REAL_WORDS,
    highFreqRealWords: HIGH_FREQ_REAL_WORDS,
    showRealWordsSection: true,
    showRealWordsPicker: false,
    pickerIndex: -1,
    streamingText: ''
  },

  onLoad: function(options) {
    this.checkHistory();
  },

  onShow: function() {
    // 检查是否有待查询的字
    var pendingQuery = wx.getStorageSync('pendingQuery');
    wx.removeStorageSync('pendingQuery');

    this.setData({
      inputText: '',
      showResult: false,
      result: {},
      resultHtml: '',
      streamingText: '',
      showQuickWords: true,
      inputCollapsed: false,
      showRealWordsSection: true,
      isCollected: false
    });

    // 如果有待查询，执行查询
    if (pendingQuery) {
      this.setData({ inputText: pendingQuery });
      this.searchWord();
    }
    this.checkHistory();
  },

  onInputChange: function(e) {
    this.setData({
      inputText: e.detail.value
    });
  },

  clearInput: function() {
    this.setData({
      inputText: '',
      showQuickWords: true,
      inputCollapsed: false,
      showRealWordsSection: true,
      showRealWordsPicker: false,
      pickerIndex: -1
    });
  },

  closeRealWords: function() {
    this.setData({
      showRealWordsSection: false
    });
  },

  onQuickWordTap: function(e) {
    const word = e.currentTarget.dataset.word;
    this.setData({ inputText: word });
    // 延迟确保 setData 完成
    setTimeout(() => {
      this.searchWord();
    }, 100);
  },

  onRealWordSelect: function(e) {
    const index = e.detail.value;
    const word = this.data.realWords[index];
    this.setData({
      inputText: word,
      pickerIndex: index,
      showRealWordsPicker: false
    });
    this.searchWord(word);
  },

  toggleRealWordsPicker: function() {
    this.setData({
      showRealWordsPicker: !this.data.showRealWordsPicker
    });
  },

  goToRealWordsPage: function() {
    wx.switchTab({
      url: '/pages/realwords/realwords'
    });
  },

  searchWord: function() {
    let query = this.data.inputText.trim();
    console.log('query:', query);

    if (!query) {
      wx.showToast({
        title: '请输入要查询的字词',
        icon: 'none',
        duration: 2000
      });
      return;
    }

    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }

    this.setData({
      isLoading: true,
      showResult: false,
      showError: false,
      inputCollapsed: true,
      showQuickWords: false,
      streamingText: '',
      resultParsed: null
    });

    wx.showLoading({ title: '正在查询...', mask: true });

    const that = this;
    const sendData = JSON.stringify({ text: query });
    // 获取域名部分
    const host = API_BASE_URL.replace('http://', '').replace('https://', '');
    const wsUrl = (API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://') + host;
    console.log('发送数据:', sendData, 'wsUrl:', wsUrl);

    this.socketTask = wx.connectSocket({
      url: wsUrl + '/ws/query',
      header: {},
      method: 'GET',
      protocols: []
    });

    this.socketTask.onOpen(function() {
      that.socketTask.send({ data: sendData });
    });

    this.socketTask.onMessage(function(res) {
      try {
        const data = JSON.parse(res.data);
        console.log('收到:', data);

        if (data.error) {
          wx.hideLoading();
          that.showErrorMessage(data.error);
          return;
        }

        if (data.type === 'content') {
          wx.hideLoading();
          const newText = that.data.streamingText + data.content;
          that.setData({
            streamingText: newText,
            resultHtml: markdownToHtml(newText),
            showResult: true,
            isLoading: false
          });
        }

        if (data.type === 'done') {
          that.handleQueryResult(that.data.streamingText);
        }
      } catch (e) {
        console.error('解析失败:', e);
      }
    });

    this.socketTask.onError(function() {
      wx.hideLoading();
      that.showErrorMessage('网络错误');
    });
  },

  handleQueryResult: function(content) {
    const animation = wx.createAnimation({
      duration: 400,
      timingFunction: 'ease-out'
    });
    animation.opacity(1).translateY(0).step();

    const html = markdownToHtml(content);

    this.setData({
      isLoading: false,
      showResult: true,
      result: { content },
      resultHtml: html,
      streamingText: content,
      inputCollapsed: true,
      showQuickWords: false,
      resultAnimation: animation.export()
    });

    this.saveToHistory(content);
    this.checkCollectStatus();

    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
  },

  showErrorMessage: function(message) {
    wx.hideLoading();
    this.setData({
      isLoading: false,
      showError: true,
      errorMessage: message,
      inputCollapsed: false,
      showQuickWords: true
    });
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
    setTimeout(() => {
      this.setData({ showError: false });
    }, 5000);
  },

  playAudio: function() {
    wx.showToast({ title: '音频功能开发中', icon: 'none' });
  },

  toggleCollect: function() {
    const word = this.data.inputText;
    let collections = wx.getStorageSync('collections') || [];
    const index = collections.findIndex(item => item.word === word);

    if (index > -1) {
      collections.splice(index, 1);
      this.setData({ isCollected: false });
      wx.showToast({ title: '已取消收藏', icon: 'success' });
    } else {
      collections.push({ word: word, result: this.data.streamingText, time: Date.now() });
      this.setData({ isCollected: true });
      wx.showToast({ title: '收藏成功', icon: 'success' });
    }
    wx.setStorageSync('collections', collections);
  },

  copyContent: function() {
    wx.setClipboardData({
      data: this.data.streamingText,
      success: function() {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' });
      }
    });
  },

  checkCollectStatus: function() {
    const word = this.data.inputText;
    let collections = wx.getStorageSync('collections') || [];
    let isCollected = false;
    for (let i = 0; i < collections.length; i++) {
      if (collections[i].word === word) { isCollected = true; break; }
    }
    this.setData({ isCollected });
  },

  saveToHistory: function(content) {
    const word = this.data.inputText;
    let history = wx.getStorageSync('searchHistory') || [];
    history = history.filter(item => item.word !== word);
    history.unshift({ word: word, content: content, time: Date.now() });
    if (history.length > 50) history = history.slice(0, 50);
    wx.setStorageSync('searchHistory', history);
    this.setData({ hasHistory: history.length > 0 });
  },

  checkHistory: function() {
    const history = wx.getStorageSync('searchHistory') || [];
    this.setData({ hasHistory: history.length > 0 });
  },

  onPullDownRefresh: function() {
    if (this.socketTask) {
      this.socketTask.close();
      this.socketTask = null;
    }
    this.setData({
      inputText: '',
      showResult: false,
      result: {},
      resultHtml: '',
      streamingText: '',
      showQuickWords: true,
      inputCollapsed: false,
      showRealWordsSection: true,
      showRealWordsPicker: false,
      pickerIndex: -1
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