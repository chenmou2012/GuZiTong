// 古字通管理后台：实时监控 / 用户管理 / 反馈处理 / 数据统计
(function () {
  'use strict';

  const API = '/api/admin';
  const TOKEN_KEY = 'admin_token';
  let token = localStorage.getItem(TOKEN_KEY) || '';

  const state = {
    userPage: 1, userPageSize: 20, userTotal: 0,
    fbStatus: '', fbPage: 1, fbPageSize: 10, fbTotal: 0
  };
  let monitorTimer = null;
  let fbTimer = null;

  const $ = (id) => document.getElementById(id);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtUptime(s) {
    if (s == null) return '-';
    s = Math.floor(s);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    let r = '';
    if (d) r += d + '天';
    if (h || r) r += h + '小时';
    r += m + '分钟';
    return r;
  }

  // ---- 请求封装 ----
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API + path, Object.assign({}, opts, { headers: headers }));
    if (res.status === 401) { logout(); throw new Error('登录已过期'); }
    const data = await res.json().catch(() => ({}));
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  // ---- 登录 / 退出 ----
  async function doLogin() {
    const err = $('loginErr');
    err.textContent = '';
    const pwd = $('adminPwd').value;
    if (!pwd) { err.textContent = '请输入密码'; return; }
    try {
      const res = await fetch(API + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      const data = await res.json();
      if (data.error) { err.textContent = data.error; return; }
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      showApp();
    } catch (e) {
      err.textContent = '网络错误：' + e.message;
    }
  }

  function logout() {
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    stopTimers();
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    $('adminPwd').value = '';
  }

  function showApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    loadMonitor();
    loadUsers(1);
    loadStats();
    refreshBadge();
    startTimers();
  }

  // ---- 实时监控 ----
  async function loadMonitor() {
    try {
      const d = await api('/status');
      renderMonitor(d);
      $('lastRefresh').textContent = '更新于 ' + fmtTime(new Date().toISOString());
    } catch (e) {
      $('serverDot').className = 'server-dot offline';
      $('serverStatus').textContent = '离线';
    }
  }

  function renderMonitor(d) {
    const dot = $('serverDot'), st = $('serverStatus');
    dot.className = 'server-dot ' + (d.status === 'ok' ? 'online' : 'offline');
    st.textContent = d.status === 'ok' ? '在线 · ' + d.model : '异常';
    const p = d.proc || {};
    const c = d.counters || {};
    const rl = d.rate_limiter_keys || {};

    $('monService').innerHTML =
      '<div><span class="muted">状态</span><b>' + esc(d.status) + '</b></div>' +
      '<div><span class="muted">模型</span>' + esc(d.model) + '</div>' +
      '<div><span class="muted">运行时长</span>' + fmtUptime(d.uptime_seconds) + '</div>' +
      '<div><span class="muted">启动于</span>' + fmtTime(d.start_time) + '</div>' +
      '<div><span class="muted">PID</span>' + esc(p.pid || '-') + '</div>' +
      '<div><span class="muted">内存</span>' + (p.memory_mb != null ? p.memory_mb + ' MB' : '-') + '</div>' +
      '<div><span class="muted">进程</span><span style="font-size:11px;word-break:break-all">' + esc((p.cmdline || '').slice(0, 80)) + '</span></div>';

    const db = d.db || {};
    $('monDb').innerHTML =
      '<div><span class="muted">注册用户</span><b>' + esc(db.users) + '</b></div>' +
      '<div><span class="muted">数据行数</span>' + esc(db.user_data_rows) + '</div>' +
      '<div><span class="muted">反馈总数</span>' + esc(db.feedbacks) + '</div>' +
      '<div><span class="muted">待处理反馈</span><b style="color:' + (db.feedbacks_new ? 'var(--red)' : 'inherit') + '">' + esc(db.feedbacks_new) + '</b></div>' +
      '<div><span class="muted">数据库大小</span>' + esc(db.db_size_mb) + ' MB</div>';

    $('monActivity').innerHTML =
      '<div><span class="muted">WS 活跃连接</span><b>' + esc(d.ws_active) + '</b></div>' +
      '<div><span class="muted">限流键（WS）</span>' + esc(rl.ws) + '</div>' +
      '<div><span class="muted">限流键（登录）</span>' + esc(rl.login) + '</div>';

    $('monCounters').innerHTML =
      '<div><span class="muted">查词次数</span><b>' + esc(c.query_total) + '</b></div>' +
      '<div><span class="muted">翻译次数</span><b>' + esc(c.translate_total) + '</b></div>' +
      '<div><span class="muted">AI 失败次数</span>' + esc(c.ai_errors) + '</div>' +
      '<div><span class="muted">反馈提交</span>' + esc(c.feedback_total) + '</div>';

    // 近 24 小时请求分布柱状图
    const h24 = d.active_hours_24 || [];
    if (h24.length === 24) {
      drawBarChart('chart24h', h24, h24.map(function (_, i) { return i + ':00'; }), { color: '#B91C1C' });
    }
  }

  // ---- 用户管理 ----
  async function loadUsers(page) {
    try {
      const d = await api('/users?page=' + page + '&page_size=' + state.userPageSize);
      state.userPage = d.page;
      state.userTotal = d.total;
      renderUsers(d.items || []);
      $('userPageInfo').textContent = '第 ' + d.page + ' 页 / 共 ' +
        Math.max(1, Math.ceil(d.total / d.page_size)) + ' 页（' + d.total + ' 人）';
      $('userPrev').disabled = d.page <= 1;
      $('userNext').disabled = d.page * d.page_size >= d.total;
    } catch (e) {
      $('userTbody').innerHTML = '<tr><td colspan="4" class="muted">加载失败：' + esc(e.message) + '</td></tr>';
    }
  }

  function renderUsers(items) {
    if (!items.length) {
      $('userTbody').innerHTML = '<tr><td colspan="4" class="muted">暂无用户</td></tr>';
      return;
    }
    $('userTbody').innerHTML = items.map(function (u) {
      return '<tr>' +
        '<td>' + esc(u.nickname || '未设置昵称') + '</td>' +
        '<td class="openid-cell">' + esc(u.openid) + '</td>' +
        '<td>' + fmtTime(u.created_at) + '</td>' +
        '<td class="actions"><button class="btn btn-ghost btn-sm" onclick="viewUserData(\'' + u.openid + '\')">查看数据</button></td>' +
        '</tr>';
    }).join('');
  }

  window.viewUserData = async function (openid) {
    try {
      $('udTitle').textContent = '用户详情';
      $('udOpenid').textContent = openid;
      $('udBody').innerHTML = '<div class="skeleton-line w80"></div><div class="skeleton-line w60"></div><div class="skeleton-line w100"></div>';
      $('userDetailModal').classList.remove('hidden');
      const d = await api('/user-detail?openid=' + encodeURIComponent(openid));
      renderUserDetail(d);
    } catch (e) {
      $('udBody').innerHTML = '<div class="ud-empty">加载失败：' + esc(e.message) + '</div>';
    }
  };

  window.viewUserRawData = async function (openid) {
    try {
      const d = await api('/user-data?openid=' + encodeURIComponent(openid));
      $('userDataBody').textContent = JSON.stringify(d.data, null, 2);
      $('userDataModal').classList.remove('hidden');
    } catch (e) {
      alert('加载失败：' + e.message);
    }
  };

  function renderUserDetail(d) {
    const p = d.profile || {};
    const le = d.learning || {};
    const pd = le.phase_dist || {};
    const cnt = d.counts || {};
    const logs = d.login_logs || [];
    const queries = d.recent_queries || [];
    const trans = d.recent_translations || [];
    const lastLog = logs[0] || {};
    const totalStates = (pd.learning || 0) + (pd.review || 0) + (pd.graduated || 0);
    const h = [];

    // 基本信息
    h.push('<div class="ud-section"><h4>基本信息</h4><div class="ud-grid">' +
      '<div><span>昵称</span><b>' + esc(p.nickname || '未设置') + '</b></div>' +
      '<div><span>注册时间</span><b>' + esc(fmtTime(p.created_at)) + '</b></div>' +
      '<div><span>最近上线</span><b>' + esc(fmtTime(p.last_active_at)) + '</b></div>' +
      '<div><span>最近 IP 属地</span><b>' + esc(lastLog.location || '-') + '</b>' +
      (lastLog.ip ? ' <span style="font-size:11px">(' + esc(lastLog.ip) + ')</span>' : '') +
      '</div></div>');

    // 学习记录
    h.push('<div class="ud-section"><h4>学习记录</h4><div class="ud-stats">' +
      '<div class="ud-stat"><b>' + esc(le.learned_words) + '</b><span>已学词条</span></div>' +
      '<div class="ud-stat"><b>' + esc(le.review_count) + '</b><span>累计复习</span></div>' +
      '<div class="ud-stat"><b>' + esc(le.streak_days) + '</b><span>连续天数</span></div>' +
      '<div class="ud-stat"><b>' + esc(cnt.collections) + '</b><span>收藏</span></div>' +
      '<div class="ud-stat"><b>' + esc(cnt.history) + '</b><span>查词记录</span></div>' +
      '<div class="ud-stat"><b>' + esc(cnt.translations) + '</b><span>翻译记录</span></div>' +
      '</div>' +
      (totalStates ? '<div class="ud-chips" style="margin-top:10px">' +
        '<span class="ud-chip">学习中 ' + (pd.learning || 0) + '</span>' +
        '<span class="ud-chip">复习中 ' + (pd.review || 0) + '</span>' +
        '<span class="ud-chip primary">已掌握 ' + (pd.graduated || 0) + '</span></div>' : '') +
      '</div>');

    // 登录记录（IP 属地）
    h.push('<div class="ud-section"><h4>登录记录（IP 属地）</h4>' +
      (logs.length ? '<table class="ud-login-table"><thead><tr><th>时间</th><th>IP</th><th>属地</th></tr></thead><tbody>' +
        logs.map(function (l) {
          return '<tr><td>' + esc(fmtTime(l.created_at)) + '</td><td>' + esc(l.ip || '-') + '</td><td>' + esc(l.location || '-') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="ud-empty">暂无登录记录</div>') +
      '</div>');

    // 查词记录（默认折叠详细内容）
    h.push('<div class="ud-section"><h4>查词记录（最近 ' + queries.length + ' 条，点击展开详细内容）</h4>' +
      (queries.length ? queries.map(function (q) {
        return '<div class="ud-query">' +
          '<div class="ud-query-head">' +
          '<span class="ud-query-word">' + esc(q.word) + '</span>' +
          '<span class="ud-query-time">' + esc(fmtTime(q.time)) + '</span>' +
          '<span class="ud-query-preview">' + esc(q.preview) + '</span>' +
          '<span class="ud-arrow">›</span>' +
          '</div>' +
          '<div class="ud-query-body">' + esc(q.content || '') + '</div>' +
          '</div>';
      }).join('') : '<div class="ud-empty">暂无查词记录</div>') +
      '</div>');

    // 翻译记录
    h.push('<div class="ud-section"><h4>翻译记录（最近 ' + trans.length + ' 条）</h4>' +
      (trans.length ? trans.map(function (t) {
        return '<div class="ud-query-head" style="cursor:default;padding:6px 0">' +
          '<span class="ud-query-word" style="color:var(--ink-2)">' + esc(t.original) + '</span>' +
          '<span class="ud-query-time">' + esc(fmtTime(t.time)) + '</span></div>';
      }).join('') : '<div class="ud-empty">暂无翻译记录</div>') +
      '</div>');

    // 原始数据入口
    h.push('<div class="ud-section">' +
      '<button class="btn btn-ghost btn-sm" data-raw="' + esc(p.openid) + '">查看原始数据（user_data 键：' +
      esc((d.user_data_keys || []).join('、') || '无') + '）</button></div>');

    $('udBody').innerHTML = h.join('');
  }

  // ---- 用户反馈 ----
  async function loadFeedbacks(page) {
    try {
      let q = '/feedbacks?page=' + page + '&page_size=' + state.fbPageSize;
      if (state.fbStatus) q += '&status=' + state.fbStatus;
      const d = await api(q);
      state.fbPage = d.page;
      state.fbTotal = d.total;
      renderFeedbacks(d.items || []);
      $('fbPageInfo').textContent = '第 ' + d.page + ' 页 / 共 ' +
        Math.max(1, Math.ceil(d.total / d.page_size)) + ' 页（' + d.total + ' 条）';
      $('fbPrev').disabled = d.page <= 1;
      $('fbNext').disabled = d.page * d.page_size >= d.total;
    } catch (e) {
      $('fbList').innerHTML = '<span class="muted">加载失败：' + esc(e.message) + '</span>';
    }
  }

  function renderFeedbacks(items) {
    if (!items.length) {
      $('fbList').innerHTML = '<span class="muted">暂无反馈</span>';
      return;
    }
    $('fbList').innerHTML = items.map(function (f) {
      const tag = f.status === 'new' ? '新反馈' : f.status === 'processing' ? '处理中' : '已完成';
      let btns = '';
      if (f.status !== 'processing') {
        btns += '<button class="btn btn-ghost btn-sm" onclick="setFbStatus(' + f.id + ',\'processing\')">标记处理中</button>';
      }
      if (f.status !== 'done') {
        btns += '<button class="btn btn-ghost btn-sm" onclick="setFbStatus(' + f.id + ',\'done\')">标记完成</button>';
      }
      return '<div class="fb-item status-' + esc(f.status) + '">' +
        '<div class="fb-top">' +
        '<span class="tag tag-' + esc(f.status) + '">' + tag + '</span>' +
        '<b>' + esc(f.nickname || '匿名用户') + '</b>' +
        (f.contact ? '<span class="muted">联系方式：' + esc(f.contact) + '</span>' : '') +
        '</div>' +
        '<div class="fb-content">' + esc(f.content) + '</div>' +
        '<div class="fb-meta">' +
        '<span>#' + f.id + '</span>' +
        '<span>' + fmtTime(f.created_at) + '</span>' +
        '<span class="openid-cell">' + esc(f.openid) + '</span>' +
        '<div class="actions">' + btns + '</div>' +
        '</div></div>';
    }).join('');
  }

  window.setFbStatus = async function (id, status) {
    try {
      await api('/feedbacks/' + id, { method: 'PUT', body: JSON.stringify({ status: status }) });
      loadFeedbacks(state.fbPage);
      refreshBadge();
    } catch (e) {
      alert('操作失败：' + e.message);
    }
  };

  async function refreshBadge() {
    try {
      const d = await api('/feedbacks?status=new&page=1&page_size=1');
      const b = $('feedbackBadge');
      if (d.total > 0) {
        b.textContent = d.total > 99 ? '99+' : d.total;
        b.classList.remove('hidden');
      } else {
        b.classList.add('hidden');
      }
    } catch (e) { /* 静默 */ }
  }

  // ---- SVG 图表（无依赖，手写） ----
  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /** 折线图：series=[{name,color,data:number[]}]，labels 与 data 等长 */
  function drawLineChart(containerId, series, labels) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = '';
    const W = 640, H = 224, PL = 40, PR = 14, PT = 18, PB = 30;
    const iw = W - PL - PR, ih = H - PT - PB;
    const n = labels.length;
    let max = 1;
    series.forEach(function (s) { s.data.forEach(function (v) { if (v > max) max = v; }); });
    const yMax = Math.ceil(max * 1.25);
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });

    // 网格 + y 轴刻度（4 条）
    for (let i = 0; i <= 3; i++) {
      const y = PT + ih - (ih * i / 3);
      svg.appendChild(svgEl('line', { x1: PL, y1: y, x2: W - PR, y2: y, stroke: '#EEF0F7', 'stroke-width': 1 }));
      const t = svgEl('text', { x: PL - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#8A93A8' });
      t.textContent = Math.round(yMax * i / 3);
      svg.appendChild(t);
    }
    // x 轴标签（最多 8 个）
    const every = Math.max(1, Math.ceil(n / 8));
    labels.forEach(function (lb, i) {
      if (i % every !== 0 && i !== n - 1) return;
      const x = PL + (n === 1 ? 0 : iw * i / (n - 1));
      const t = svgEl('text', { x: x, y: H - 10, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#8A93A8' });
      t.textContent = lb;
      svg.appendChild(t);
    });

    // 系列
    series.forEach(function (s) {
      const pts = s.data.map(function (v, i) {
        return [PL + (n === 1 ? 0 : iw * i / (n - 1)), PT + ih - (v / yMax) * ih];
      });
      if (pts.length > 1) {
        const gid = 'g' + containerId + s.name.replace(/\W/g, '');
        const defs = svgEl('defs', {});
        const grad = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': 0.22 }));
        grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': 0.02 }));
        defs.appendChild(grad);
        svg.appendChild(defs);
        const area = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' L') +
          ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (PT + ih) +
          ' L' + pts[0][0].toFixed(1) + ',' + (PT + ih) + ' Z';
        svg.appendChild(svgEl('path', { d: area, fill: 'url(#' + gid + ')', stroke: 'none' }));
        const line = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' L');
        svg.appendChild(svgEl('path', { d: line, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        pts.forEach(function (p) {
          svg.appendChild(svgEl('circle', { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 2.6, fill: '#fff', stroke: s.color, 'stroke-width': 1.6 }));
        });
      } else if (pts.length === 1) {
        svg.appendChild(svgEl('circle', { cx: pts[0][0], cy: pts[0][1], r: 4, fill: s.color }));
      }
    });

    // 图例（多系列时）
    if (series.length > 1) {
      let lx = PL;
      series.forEach(function (s) {
        svg.appendChild(svgEl('circle', { cx: lx + 5, cy: 10, r: 4, fill: s.color }));
        const t = svgEl('text', { x: lx + 14, y: 13.5, 'font-size': 10.5, fill: '#8A93A8' });
        t.textContent = s.name;
        svg.appendChild(t);
        lx += 18 + s.name.length * 11 + 16;
      });
    }
    box.appendChild(svg);
  }

  /** 环形图：items=[{label,value,color}] */
  function drawDonutChart(containerId, items) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = '';
    const total = items.reduce(function (s, it) { return s + it.value; }, 0);
    if (!total) {
      const empty = document.createElement('div');
      empty.className = 'ud-empty';
      empty.textContent = '暂无数据';
      box.appendChild(empty);
      return;
    }
    const size = 190, R = 66, C = 2 * Math.PI * R;
    const svg = svgEl('svg', { viewBox: '0 0 ' + size + ' ' + size });
    svg.appendChild(svgEl('circle', { cx: size / 2, cy: size / 2, r: R, fill: 'none', stroke: '#EEF0F7', 'stroke-width': 22 }));
    let offset = 0;
    items.forEach(function (it) {
      if (!it.value) return;
      const frac = it.value / total;
      const seg = (frac * C - 1.5);
      svg.appendChild(svgEl('circle', {
        cx: size / 2, cy: size / 2, r: R, fill: 'none', stroke: it.color, 'stroke-width': 22,
        'stroke-dasharray': seg + ' ' + (C - seg),
        'stroke-dashoffset': -offset * C,
        'stroke-linecap': 'round',
        transform: 'rotate(-90 ' + size / 2 + ' ' + size / 2 + ')'
      }));
      offset += frac;
    });
    const t1 = svgEl('text', { x: size / 2, y: size / 2 - 2, 'text-anchor': 'middle', 'font-size': 27, 'font-weight': 700, fill: '#1F2A44' });
    t1.textContent = total;
    const t2 = svgEl('text', { x: size / 2, y: size / 2 + 18, 'text-anchor': 'middle', 'font-size': 11, fill: '#8A93A8' });
    t2.textContent = '已学词条';
    svg.appendChild(t1); svg.appendChild(t2);
    box.appendChild(svg);

    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    items.forEach(function (it) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      const dot = document.createElement('span');
      dot.className = 'legend-dot';
      dot.style.background = it.color;
      const txt = document.createElement('span');
      txt.textContent = it.label + ' ' + it.value + ' · ' + (it.value / total * 100).toFixed(0) + '%';
      row.appendChild(dot);
      row.appendChild(txt);
      legend.appendChild(row);
    });
    box.appendChild(legend);
  }

  /** 垂直柱状图：data=number[]，labels 等长 */
  function drawBarChart(containerId, data, labels, opts) {
    opts = opts || {};
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = '';
    const W = 640, H = 210, PL = 34, PR = 8, PT = 18, PB = 26;
    const iw = W - PL - PR, ih = H - PT - PB;
    const n = data.length;
    if (!n) { box.innerHTML = '<div class="ud-empty">暂无数据</div>'; return; }
    let max = 1;
    data.forEach(function (v) { if (v > max) max = v; });
    const yMax = Math.ceil(max * 1.25);
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    for (let i = 0; i <= 3; i++) {
      const y = PT + ih - ih * i / 3;
      svg.appendChild(svgEl('line', { x1: PL, y1: y, x2: W - PR, y2: y, stroke: '#EEF0F7', 'stroke-width': 1 }));
      const t = svgEl('text', { x: PL - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#8A93A8' });
      t.textContent = Math.round(yMax * i / 3);
      svg.appendChild(t);
    }
    const bw = Math.min(26, iw / n * 0.6);
    const every = Math.max(1, Math.ceil(n / 12));
    data.forEach(function (v, i) {
      const cx = PL + iw * (i + 0.5) / n;
      const hgt = (v / yMax) * ih;
      const y = PT + ih - hgt;
      const rect = svgEl('rect', { x: cx - bw / 2, y: y, width: bw, height: Math.max(hgt, v > 0 ? 1.5 : 0), rx: 3, fill: v > 0 ? (opts.color || '#B91C1C') : '#E9ECF4' });
      svg.appendChild(rect);
      if (v > 0) {
        const t = svgEl('text', { x: cx, y: y - 4, 'text-anchor': 'middle', 'font-size': 9, fill: '#8A93A8' });
        t.textContent = v;
        svg.appendChild(t);
      }
      if (i % every === 0 || i === n - 1) {
        const lb = svgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#8A93A8' });
        lb.textContent = labels[i];
        svg.appendChild(lb);
      }
    });
    box.appendChild(svg);
  }

  /** 热力图：days=[{date, hours:[24]}]，颜色深浅表示活跃强度 */
  function drawHeatmap(containerId, days) {
    const box = document.getElementById(containerId);
    if (!box) return;
    box.innerHTML = '';
    if (!days || !days.length) { box.innerHTML = '<div class="ud-empty">暂无数据</div>'; return; }
    let max = 1;
    days.forEach(function (d) { d.hours.forEach(function (v) { if (v > max) max = v; }); });
    const W = 640, PL = 38, PR = 10, top = 24;
    const cellW = (W - PL - PR) / 24, cellH = 22;
    const H = top + days.length * cellH + 6;
    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    for (let h = 0; h <= 24; h += 3) {
      if (h > 24) break;
      const t = svgEl('text', { x: PL + h * cellW, y: 13, 'text-anchor': 'middle', 'font-size': 9, fill: '#8A93A8' });
      t.textContent = h;
      svg.appendChild(t);
    }
    days.forEach(function (d, di) {
      const dl = svgEl('text', { x: PL - 6, y: top + di * cellH + cellH / 2 + 3, 'text-anchor': 'end', 'font-size': 9.5, fill: '#8A93A8' });
      dl.textContent = d.date;
      svg.appendChild(dl);
      d.hours.forEach(function (v, h) {
        const x = PL + h * cellW + 0.7, y = top + di * cellH + 1;
        const r = svgEl('rect', { x: x, y: y, width: cellW - 1.4, height: cellH - 3, rx: 2.5 });
        if (!v) {
          r.setAttribute('fill', '#EFF1F6');
        } else {
          r.setAttribute('fill', '#B91C1C');
          r.setAttribute('fill-opacity', (0.16 + 0.78 * (v / max)).toFixed(2));
        }
        svg.appendChild(r);
      });
    });
    // 图例
    const leg = svgEl('text', { x: PL, y: H - 1, 'font-size': 9, fill: '#8A93A8' });
    leg.textContent = '低'; svg.appendChild(leg);
    for (let i = 1; i <= 4; i++) {
      const gx = PL + 14 + (i - 1) * 18;
      const sw = svgEl('rect', { x: gx, y: H - 11, width: 15, height: 8, rx: 2, fill: '#B91C1C', 'fill-opacity': (0.16 + 0.16 * i).toFixed(2) });
      svg.appendChild(sw);
    }
    const leg2 = svgEl('text', { x: PL + 14 + 72, y: H - 1, 'font-size': 9, fill: '#8A93A8' });
    leg2.textContent = '高'; svg.appendChild(leg2);
    box.appendChild(svg);
  }

  // ---- 数据统计 ----
  async function loadStats() {
    try {
      const d = await api('/stats');
      const db = d.db || {};
      const c = d.counters || {};
      $('stUsers').innerHTML = esc(db.users) + '<small> 人</small>';
      $('stLearners').textContent = d.users_with_states || 0;
      $('stWords').textContent = d.total_word_states || 0;
      $('stQueries').textContent = c.query_total || 0;
      $('stTranslations').textContent = c.translate_total || 0;
      $('stFeedbacks').textContent = db.feedbacks || 0;

      const tr = d.trends || {};
      const reg = tr.registration || [];
      drawLineChart('chartReg', [{ name: '注册', color: '#B91C1C', data: reg.map(function (r) { return r.value; }) }], reg.map(function (r) { return r.date; }));
      const act = tr.active || [];
      const uv = tr.uv || [];
      drawLineChart('chartActive', [
        { name: '登录', color: '#3B82F6', data: act.map(function (r) { return r.value; }) },
        { name: '活跃用户', color: '#F59E0B', data: uv.map(function (r) { return r.value; }) }
      ], act.map(function (r) { return r.date; }));
      const use = tr.usage || [];
      drawLineChart('chartUsage', [
        { name: '查词', color: '#B91C1C', data: use.map(function (r) { return r.query; }) },
        { name: '翻译', color: '#10B981', data: use.map(function (r) { return r.translate; }) }
      ], use.map(function (r) { return r.date; }));

      const pd = d.phase_dist || {};
      drawDonutChart('chartPhase', [
        { label: '学习中', value: pd.learning || 0, color: '#F5AD1E' },
        { label: '复习中', value: pd.review || 0, color: '#3B82F6' },
        { label: '已掌握', value: pd.graduated || 0, color: '#10B981' }
      ]);

      // 24 小时活跃分布
      const ah = tr.active_hours || [];
      if (ah.length === 24) {
        drawBarChart('chartHours', ah, ah.map(function (_, i) { return i + '时'; }), { color: '#B91C1C' });
      }
      // 7×24 热力图
      if (tr.heatmap && tr.heatmap.length) drawHeatmap('chartHeatmap', tr.heatmap);
      // 反馈状态分布
      const fs = tr.feedback_status || {};
      drawDonutChart('chartFbStatus', [
        { label: '新反馈', value: fs.new || 0, color: '#DC2626' },
        { label: '处理中', value: fs.processing || 0, color: '#F59E0B' },
        { label: '已完成', value: fs.done || 0, color: '#10B981' }
      ]);
    } catch (e) {
      $('chartReg').innerHTML = '<div class="ud-empty">加载失败：' + esc(e.message) + '</div>';
    }
  }

  // ---- 轮询 ----
  function startTimers() {
    stopTimers();
    monitorTimer = setInterval(loadMonitor, 10000);
    fbTimer = setInterval(function () {
      loadFeedbacks(state.fbPage);
      refreshBadge();
    }, 15000);
  }
  function stopTimers() {
    if (monitorTimer) clearInterval(monitorTimer);
    if (fbTimer) clearInterval(fbTimer);
    monitorTimer = fbTimer = null;
  }

  // ---- 事件绑定 ----
  $('loginBtn').onclick = doLogin;
  $('adminPwd').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('logoutBtn').onclick = logout;
  $('refreshMonitor').onclick = loadMonitor;
  $('refreshUsers').onclick = function () { loadUsers(state.userPage); };
  $('refreshStats').onclick = loadStats;
  $('userPrev').onclick = function () { loadUsers(state.userPage - 1); };
  $('userNext').onclick = function () { loadUsers(state.userPage + 1); };
  $('fbPrev').onclick = function () { loadFeedbacks(state.fbPage - 1); };
  $('fbNext').onclick = function () { loadFeedbacks(state.fbPage + 1); };
  $('autoRefresh').onchange = function () { this.checked ? startTimers() : stopTimers(); };

  document.querySelectorAll('#fbFilters .filter').forEach(function (btn) {
    btn.onclick = function () {
      document.querySelectorAll('#fbFilters .filter').forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      state.fbStatus = this.dataset.status;
      loadFeedbacks(1);
    };
  });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (x) { x.classList.remove('active'); });
      this.classList.add('active');
      $('tab-' + this.dataset.tab).classList.add('active');
      if (this.dataset.tab === 'users') loadUsers(state.userPage);
      if (this.dataset.tab === 'feedbacks') { loadFeedbacks(state.fbPage); refreshBadge(); }
      if (this.dataset.tab === 'stats') loadStats();
    };
  });

  document.querySelectorAll('[data-close="modal"]').forEach(function (el) {
    el.onclick = function () { $('userDataModal').classList.add('hidden'); };
  });
  document.querySelectorAll('[data-close="udmodal"]').forEach(function (el) {
    el.onclick = function () { $('userDetailModal').classList.add('hidden'); };
  });

  // 用户详情：查词记录折叠展开 + 原始数据入口
  $('udRawBtn').onclick = function () { window.viewUserRawData($('udOpenid').textContent.trim()); };
  $('udBody').addEventListener('click', function (e) {
    const head = e.target.closest('.ud-query-head');
    if (head) { head.parentElement.classList.toggle('open'); return; }
    const raw = e.target.closest('[data-raw]');
    if (raw) { window.viewUserRawData(raw.dataset.raw); }
  });

  // 启动：已有 token 直接进主视图（过期会被 401 踢回登录）
  if (token) showApp();
})();
