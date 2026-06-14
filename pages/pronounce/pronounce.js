// pages/pronounce/pronounce.js — 字音跟读（按例句定音播放）
const PRON = require('../../utils/data/pronunciationData.js');

// ============ 音频地址配置 ============
// 文件名规律： {3位id}_{字}_{mi}_{角色}.wav ，分目录存放两种声音。
const AUDIO_ROOT = 'https://education-cos-1307366133.cos.ap-shanghai.myqcloud.com/教师培训-正式版/教师培训-198';
const VOICES = {
  female: { dir: 'audio_primary', role: '小学老师', label: '女声', sub: '小学老师' }, // primary，已验证可用
  male:   { dir: 'audio_high',    role: '高中老师', label: '男声', sub: '高中老师' }  // high，路径若不同改这里
};
// =====================================

function pad3(n) {
  n = String(n);
  while (n.length < 3) n = '0' + n;
  return n;
}
function buildKey(item) {
  return item.id + '_' + item.mi;
}
function buildSrc(item, voiceKey) {
  const v = VOICES[voiceKey] || VOICES.female;
  const url = AUDIO_ROOT + '/' + v.dir + '/' + pad3(item.id) + '_' + item.word + '_' + item.mi + '_' + v.role + '.wav';
  return encodeURI(url);
}

// 把例句中的目标字加粗
function boldWord(sentence, word) {
  if (!sentence || !word) return [{ text: sentence || '', bold: false }];
  const parts = [];
  let last = 0;
  let idx = sentence.indexOf(word, last);
  while (idx !== -1) {
    if (idx > last) parts.push({ text: sentence.slice(last, idx), bold: false });
    parts.push({ text: word, bold: true });
    last = idx + word.length;
    idx = sentence.indexOf(word, last);
  }
  if (last < sentence.length) parts.push({ text: sentence.slice(last), bold: false });
  return parts.length ? parts : [{ text: sentence, bold: false }];
}

Page({
  data: {
    statusBarHeight: 20,
    keyword: '',
    groups: [],          // 当前展示（可能被搜索过滤）
    playingKey: '',      // 正在播放的 key
    voice: 'female',     // 当前声音：female=女声(小学老师) / male=男声(高中老师)
    voiceSub: '小学老师',
    total: 0
  },

  onLoad: function () {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight });
    this._allGroups = this.buildGroups(PRON);
    this.setData({ groups: this._allGroups, total: PRON.length });
    this.initAudio();
  },

  goBack: function () {
    wx.navigateBack({ delta: 1 });
  },

  // 切换声音
  setVoice: function (e) {
    const voice = e.currentTarget.dataset.voice;
    if (voice === this.data.voice) return;
    if (this.audio) this.audio.stop();
    this.setData({ voice: voice, voiceSub: (VOICES[voice] || VOICES.female).sub, playingKey: '' });
  },

  onUnload: function () {
    if (this.audio) {
      this.audio.stop();
      this.audio.destroy();
      this.audio = null;
    }
  },

  // 按字分组
  buildGroups: function (rows) {
    const map = {};
    const order = [];
    rows.forEach(r => {
      if (!map[r.id]) {
        map[r.id] = { id: r.id, word: r.word, readings: [], items: [] };
        order.push(r.id);
      }
      const g = map[r.id];
      if (g.readings.indexOf(r.pinyin) === -1) g.readings.push(r.pinyin);
      g.items.push({
        key: buildKey(r),
        id: r.id,
        word: r.word,
        mi: r.mi,
        pinyin: r.pinyin,
        meaning: r.meaning,
        source: r.source,
        note: r.note,
        parts: boldWord(r.example, r.word)
      });
    });
    return order.map(id => {
      const g = map[id];
      g.readingText = g.readings.join(' / ');
      g.polyphonic = g.readings.length > 1;
      return g;
    });
  },

  // 搜索过滤（按字或拼音）
  onSearch: function (e) {
    const kw = (e.detail.value || '').trim().toLowerCase();
    this.setData({ keyword: kw });
    if (!kw) {
      this.setData({ groups: this._allGroups });
      return;
    }
    const groups = this._allGroups.filter(g =>
      g.word.indexOf(kw) !== -1 ||
      g.readingText.toLowerCase().indexOf(kw) !== -1
    );
    this.setData({ groups });
  },

  clearSearch: function () {
    this.setData({ keyword: '', groups: this._allGroups });
  },

  initAudio: function () {
    this.audio = wx.createInnerAudioContext();
    this.audio.onEnded(() => this.setData({ playingKey: '' }));
    this.audio.onStop(() => this.setData({ playingKey: '' }));
    this.audio.onError((err) => {
      console.log('音频播放失败', err);
      this.setData({ playingKey: '' });
      wx.showToast({ title: '音频加载失败，可能尚未生成', icon: 'none' });
    });
  },

  // 点击播放
  playItem: function (e) {
    const ds = e.currentTarget.dataset;
    const key = ds.key;
    if (!key) return;

    // 再次点击正在播放的条目 → 停止
    if (this.data.playingKey === key) {
      this.audio.stop();
      this.setData({ playingKey: '' });
      return;
    }

    const src = buildSrc({ id: ds.id, word: ds.word, mi: ds.mi }, this.data.voice);
    this.setData({ playingKey: key });
    this.audio.stop();
    this.audio.src = src;
    this.audio.play();
  }
});
