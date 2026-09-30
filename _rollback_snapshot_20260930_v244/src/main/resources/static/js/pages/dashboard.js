function DashboardPage() {
  return `
    <div class="dash-page">
    <div class="page-header">
      <h1>仪表盘</h1>
    </div>
    <div class="stats-grid" id="dashStats">
      <!-- v2.37 需求1/2：卡片里的"当日/本周/本月/本年"四个标签移除（改到"发送记录统计"面板），
           外观与"客户总数"一致（悬停高亮、手型光标），但不绑定任何跳转 -->
      <div class="stat-card clickable" title="发送统计：全部发送记录数">
        <div class="stat-card-main">
          <div class="stat-icon" style="background:#D1FAE5;color:#10B981">📧</div>
          <div class="stat-text">
            <div class="stat-label">发送统计</div>
            <div class="stat-value" id="statSent">-</div>
          </div>
        </div>
      </div>
      <div class="stat-card clickable" onclick="dashOpenDetail('customers')" title="点击查看客户邮件发送统计">
        <div class="stat-card-main">
          <div class="stat-icon" style="background:#DBEAFE;color:#2563EB">👥</div>
          <div class="stat-text">
            <div class="stat-label">客户总数</div>
            <div class="stat-value" id="statCustomers">-</div>
          </div>
        </div>
      </div>
      <div class="stat-card clickable" onclick="dashOpenDetail('templates')" title="点击查看模板发送统计">
        <div class="stat-card-main">
          <div class="stat-icon" style="background:#FEF3C7;color:#F59E0B">📝</div>
          <div class="stat-text">
            <div class="stat-label">模板统计</div>
            <div class="stat-value" id="statTemplates">-</div>
          </div>
        </div>
      </div>
      <div class="stat-card clickable" onclick="dashOpenDetail('campaigns')" title="点击查看所有任务的发送统计">
        <div class="stat-card-main">
          <div class="stat-icon" style="background:#EDE9FE;color:#7C3AED">📊</div>
          <div class="stat-text">
            <div class="stat-label">任务总数</div>
            <div class="stat-value" id="statCampaigns">-</div>
          </div>
        </div>
      </div>
    </div>
    <div id="dashSentSection">
      <div class="card" style="text-align:center;color:var(--text-secondary);padding:24px">加载中...</div>
    </div>
    </div>
  `;
}

// 明细弹窗状态：type=customers|templates|campaigns；customer=客户发送明细钻取上下文；filters=客户统计次数筛选条件
// v2.44 需求 2：batch=''|current|history，客户统计与内嵌面板都按"各任务当前批次/历史批次"筛选
let dashDetail = { type: null, page: 1, pageSize: 15, search: '', customer: null, filters: emptyCustomerFilters(), batch: '' };
// v2.22：仪表盘内嵌"发送记录统计"面板状态
// v2.36 需求1.3：发送记录详情默认每页 5 条（原 10 条）
// v2.37 需求4：period 取 day/week/month/year，即面板上四个统计按钮；counts 为按钮显示的记录数
let dashEmbed = { page: 1, pageSize: 5, period: 'day', date: '', bucket: null, trendData: null, counts: null, batch: '' };
// v2.31 需求1：模板发送统计的模板筛选下拉框（filter='' 表示全部模板），rows 为接口返回的"模板 × 任务"行
let tplStats = { rows: [], filter: '' };
// v2.37 需求4：四个统计按钮 = 原"发送统计"卡片的四个口径 + 折线图分桶口径
const DASH_PERIODS = [
  { key: 'day', label: '当日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' },
];

async function bindDashboardEvents() {
  await loadDashboard();
}

/** 载入仪表盘：统计卡片 + 发送记录统计/欢迎界面；弹窗打开时同步刷新弹窗内容 */
async function loadDashboard() {
  const stats = await api.get('/api/campaigns/stats');
  if (stats.code === 0) {
    const d = stats.data;
    document.getElementById('statCustomers').textContent = d.customer_count;
    document.getElementById('statTemplates').textContent = d.template_count;
    document.getElementById('statSent').textContent = d.send_record_count;
    document.getElementById('statCampaigns').textContent = d.total_campaigns;
  }

  await loadDashSentSection();

  if (dashDetail.type) renderDashDetail();
}

/**
 * v2.30 需求1：不论当日有无发送数据都渲染"发送记录统计"面板，
 * 四个统计按钮与日期选择器常驻，当日无数据时只在面板内部显示空态，
 * 因此随时可以切到"本周""本月""本年"查看历史数据。
 */
async function loadDashSentSection() {
  const box = document.getElementById('dashSentSection');
  if (!box) return;
  box.innerHTML = `
    <div class="card dash-sent-card">
      <h3 class="panel-title">发送记录统计</h3>
      <div id="dashSentEmbed"><div style="text-align:center;color:var(--text-secondary);padding:16px">加载中...</div></div>
    </div>`;
  await renderSentPanel();
}

function dashWelcomeHtml(date) {
  const isToday = date === todayStr();
  return `
    <div class="welcome-card">
      <div class="welcome-icon">✉️</div>
      <p class="welcome-date">${date} · ${isToday ? '今日还没有发送数据' : '该日还没有发送数据'}</p>
      <p>可切换到上方「本周」「本月」「本年」查看历史发送数据；前往「发送任务」创建任务并向客户发送邮件。</p>
      <button class="btn btn-primary" onclick="Modal.close();router.navigate('campaigns')">前往发送任务 →</button>
    </div>`;
}

/* ======================= 明细钻取弹窗 ======================= */

const dashTitles = {
  customers: '客户邮件发送统计',
  templates: '模板发送统计',
  campaigns: '任务发送统计',
};

window.dashOpenDetail = async function(type) {
  if (!dashTitles[type]) return;
  // v2.32 需求3：默认不带任何筛选条件（filters 全空 = 查询全部结果）
  dashDetail = { type, page: 1, pageSize: 15, search: '', customer: null, filters: emptyCustomerFilters(), batch: '' };
  tplStats = { rows: [], filter: '' };
  Modal.show({
    title: dashTitles[type],
    wide: true,
    content: '<div id="dashDetail" style="color:var(--text-secondary)">加载中...</div>',
    cancelText: '关闭',
    hideConfirm: true,
  });
  await renderDashDetail();
};

function emptyCustomerFilters() {
  return { sent: '', failed: '', total: '' };
}

/**
 * v2.44 需求 2：批次筛选下拉的一份选项（内嵌"发送记录详情"与"客户邮件发送统计"弹窗共用）。
 * 这两个视图都是跨任务的，只能判断"这条记录是不是它所在任务的当前批次"，
 * 所以按需求只给"当前批次 / 历史批次"两类，具体第几批的去向在发送任务界面的批次概览里看。
 */
function batchFilterOptions(current) {
  const c = current || '';
  return `<option value=""${c === '' ? ' selected' : ''}>全部批次</option>`
    + `<option value="current"${c === 'current' ? ' selected' : ''}>仅当前批次</option>`
    + `<option value="history"${c === 'history' ? ' selected' : ''}>仅历史批次</option>`;
}

/** 批次单元格：与发送任务界面共用 batchMark，两处"第N批/·历史"的写法完全一致 */
function dashBatchCell(r) {
  const n = r.batch_no || 1;
  return batchMark(n, r.is_current_batch ? n : n + 1);
}

function dashCountFilterTip(f) {
  const kw = dashDetail.search || '';
  const conds = [['sent', '已发送'], ['failed', '发送失败'], ['total', '总计']]
    .filter(([k]) => f[k] !== '')
    .map(([k, label]) => `${label}次数至少 ${f[k]}`);
  // v2.44 需求 2：批次筛选也是条件之一，写在同一句"当前条件"里
  if (dashDetail.batch) conds.push(dashDetail.batch === 'current' ? '只算各任务当前批次' : '只算各任务历史批次');
  if (kw || conds.length) {
    return `当前条件：${[kw ? `关键字“${kw}”` : '', ...conds].filter(Boolean).join(' 且 ')}`;
  }
  return '默认未设置任何条件，显示全部客户的发送统计';
}

/** 弹窗打开时就地更新标题（客户钻取/返回时切换） */
function setDashModalTitle(text) {
  const el = document.getElementById('modalTitle');
  if (el) el.textContent = text;
}

window.dashDetailGoto = function(p) { dashDetail.page = p; renderDashDetail(); };
window.dashDetailSize = function(s) { dashDetail.pageSize = parseInt(s); dashDetail.page = 1; renderDashDetail(); };
/** 把弹窗里当前的输入值读回状态（重绘会重建 DOM，必须先取值再渲染） */
function dashReadFilters() {
  const val = id => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };
  dashDetail.search = val('dashSearchInput');
  dashDetail.filters = { sent: val('csSent'), failed: val('csFailed'), total: val('csTotal') };
  // v2.44 需求 2：批次下拉也在同一次"搜索"里读回（重绘会重建 DOM）
  dashDetail.batch = val('csBatch');
}

window.dashDetailSearch = function() {
  dashReadFilters();
  dashDetail.page = 1;
  renderDashDetail();
};

/** v2.32 需求3：重置为"无任何条件"的默认查询结果 */
window.dashDetailReset = function() {
  dashDetail.search = '';
  dashDetail.filters = emptyCustomerFilters();
  dashDetail.batch = '';
  dashDetail.page = 1;
  renderDashDetail();
};

window.dashRefreshDetail = function() { renderDashDetail(); };

/* --------- 发送记录统计面板（v2.22 内嵌视图；v2.37 需求4 改为四个统计按钮切换口径） --------- */

window.statsSetPeriod = function(period) {
  if (!DASH_PERIODS.some(p => p.key === period)) return;
  dashEmbed.period = period;
  dashEmbed.bucket = null;
  dashEmbed.page = 1;
  renderSentPanel();
};

window.statsSetDate = function(v) {
  dashEmbed.date = v;
  dashEmbed.bucket = null;
  dashEmbed.page = 1;
  renderSentPanel();
};

window.statsRefresh = function() { renderSentPanel(); };

/** v2.24：点击日期输入框任意位置即弹出日期选择器（Chrome 默认只有日历图标可点） */
window.statsPickDate = function(el) {
  try { el.showPicker(); } catch (e) { el.focus(); }
};

window.statsGoto = function(p) {
  dashEmbed.page = p;
  renderSentPanel();
};

window.statsSize = function(v) {
  dashEmbed.pageSize = parseInt(v);
  dashEmbed.page = 1;
  renderSentPanel();
};

/** 点击/再次点击折线图数据点：选中该时段（小时 / 自然日 / 自然月）钻取记录，再点同一点取消 */
window.statsToggleBucket = function(i) {
  const s = dashEmbed;
  const t = s.trendData;
  if (!t || !t.bucket_ranges || !t.bucket_ranges[i]) return;
  const date = s.date || todayStr();
  const r = t.bucket_ranges[i];
  if (s.bucket && s.bucket.index === i && s.bucket.period === t.period && s.bucket.date === date) {
    s.bucket = null;
  } else {
    s.bucket = { index: i, period: t.period, date, label: t.labels[i], start: r.start, end: r.end };
  }
  s.page = 1;
  renderSentPanel();
};

window.statsClearBucket = function() {
  dashEmbed.bucket = null;
  dashEmbed.page = 1;
  renderSentPanel();
};

/** v2.44 需求 2：面板的批次筛选（''=全部 / current=各任务当前批次 / history=各任务历史批次） */
window.statsSetBatch = function(v) {
  dashEmbed.batch = v === 'current' || v === 'history' ? v : '';
  dashEmbed.page = 1;
  renderSentPanel();
};

async function renderSentPanel() {
  const box = document.getElementById('dashSentEmbed');
  if (!box) return;
  const s = dashEmbed;
  const fmt = fmtDateTime;
  const period = DASH_PERIODS.some(p => p.key === s.period) ? s.period : 'day';
  const date = s.date || todayStr();
  // v2.37 需求4：四个按钮的数值随日期框重新统计，折线图按选中口径刷新（两个请求并行）
  const [countsRes, trendRes] = await Promise.all([
    api.get(`/api/dashboard/send-period-counts?date=${encodeURIComponent(date)}`),
    api.get(`/api/dashboard/send-trend?period=${period}&date=${encodeURIComponent(date)}`),
  ]);
  s.counts = countsRes.code === 0 ? countsRes.data : null;
  const range = trendRes.code === 0 ? trendRes.data : null;
  s.trendData = range;
  // 当日=逐封明细；本周/本月/本年=按任务+模板聚合
  const isSummary = period !== 'day';
  const mode = isSummary ? 'summary' : 'detail';
  const periodBtns = DASH_PERIODS.map(({ key, label }) => {
    const n = s.counts ? s.counts[key] : '-';
    return `<button type="button" class="stat-period ${period === key ? 'active' : ''}"
      title="点击查看${label}的发送趋势与记录（${label}共 ${n} 条发送记录）"
      onclick="statsSetPeriod('${key}')"><span>${label}</span><b>${n}</b></button>`;
  }).join('');
  // v2.30 需求1/8：所选时段没有发送数据时，保留上方按钮行，只把图表与明细换成放大的空态
  const dayEmpty = period === 'day' && ((range ? (range.total_sent || 0) + (range.total_failed || 0) : 0) === 0);
  const b = s.bucket;
  const windowParams = b
    ? `start=${encodeURIComponent(b.start)}&end=${encodeURIComponent(b.end)}`
    : `period=${period}&date=${encodeURIComponent(date)}`;
  const res = dayEmpty
    ? { code: 0, data: { records: [], total: 0 } }
    : await api.get(`/api/dashboard/send-records?${windowParams}&mode=${mode}${s.batch ? `&batch=${s.batch}` : ''}&page=${s.page}&page_size=${s.pageSize}`);
  const data = res.code === 0 ? res.data : { records: [], total: 0 };
  const rows = data.records || [];

  const recordsTable = isSummary ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>任务</th><th>模板</th><th>总数</th><th>成功数</th><th>失败数</th><th>批次</th><th>发送时间</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(r => `<tr>
            <td>${r.campaign_name}</td><td>${r.template_name || '-'}</td>
            <td><strong>${r.total}</strong></td>
            <td style="color:var(--success)">${r.sent_count}</td>
            <td style="color:var(--danger)">${r.failed_count}</td>
            <td class="dash-batch-cell" title="该任务共 ${r.batch_count || 1} 个批次，发送记录按各任务当前批次划分">${(r.batch_count || 1) > 1 ? `共${r.batch_count}批 · 当前第${r.current_batch || 1}批` : `第${r.current_batch || 1}批`}</td>
            <td style="font-size:13px">${fmt(r.last_sent_at)}</td>
          </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary)">该筛选条件下暂无发送记录</td></tr>'}
        </tbody>
      </table>
    </div>` : `
    <div class="table-wrap">
      <table>
        <thead><tr><th>任务</th><th>模板</th><th>客户号</th><th>客户</th><th>邮箱</th><th>批次</th><th>结果</th><th>状态/错误信息</th><th>发送时间</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(l => `<tr>
            <td>${l.campaign_name}</td><td>${l.template_name || '-'}</td><td class="dash-cust-no">${l.customer_no || '-'}</td><td>${l.customer_name || '-'}</td><td>${l.customer_email}</td>
            <td class="dash-batch-cell">${dashBatchCell(l)}</td>
            <td>${l.status === 'sent' ? '<span class="badge badge-success">已发送</span>' : '<span class="badge badge-danger">失败</span>'}</td>
            <td style="font-size:12px;color:var(--danger)">${l.status === 'sent' ? '已发送' : (l.error_message || '失败')}</td>
            <td style="font-size:13px">${fmt(l.sent_at)}</td>
          </tr>`).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--text-secondary)">该时间范围内暂无发送记录</td></tr>'}
        </tbody>
      </table>
    </div>`;

  box.innerHTML = `
    <div class="stats-period-row">
      <div class="period-btns">${periodBtns}</div>
      <span class="row-label">日期</span>
      <input type="date" class="form-input date-pick period-date" value="${date}" onclick="statsPickDate(this)" onchange="statsSetDate(this.value)">
      <button class="btn btn-sm btn-secondary" onclick="statsRefresh()">🔄 刷新</button>
    </div>
    ${dayEmpty ? dashWelcomeHtml(date) : `
    ${range ? `
      <div class="detail-summary" style="justify-content:center;text-align:center">
        <span>统计区间 <b style="font-size:13px">${range.start} ~ ${range.end}</b></span>
        <span>发送成功 <b style="color:var(--success)">${range.total_sent}</b></span>
        <span>发送失败 <b style="color:var(--danger)">${range.total_failed}</b></span>
      </div>` : ''}
    ${range ? renderTrendChart(range, period) : ''}
    <h4 class="records-title">发送记录详情
      ${b ? `<span class="badge badge-info" style="margin-left:8px;cursor:pointer" title="再次点击折线图上对应的点也可取消筛选" onclick="statsClearBucket()">已筛选：${b.label} ✕</span>` : ''}
      <label class="dash-batch-filter" for="dashEmbedBatch" title="一个任务可以分多批发信，这里只看各任务当前批次或历史批次的记录">批次
        <select class="form-input" id="dashEmbedBatch" onchange="statsSetBatch(this.value)">${batchFilterOptions(s.batch)}</select>
      </label>
    </h4>
    ${recordsTable}
    <div class="pag-bar">${renderPagination({ total: data.total, page: s.page, pageSize: s.pageSize, unit: isSummary ? '个任务分组' : '条记录', gotoFn: 'statsGoto', sizeFn: 'statsSize' })}</div>`}`;
  const wrap = box.querySelector('.trend-wrap');
  if (wrap && range) {
    const selIdx = b && b.period === period && b.date === date ? b.index : null;
    // v2.37 需求5 折线图 207 → 150；v2.38 需求1.2 再调高 15% → 173。
    // 必须与 .trend-chart 的 CSS 高度保持一致，否则 SVG 与容器错位
    mountTrendChart(wrap, range, 173, { onSelect: i => window.statsToggleBucket(i), selectedIndex: selIdx });
  }
}

/** 从客户统计列表钻取该客户的发送详情（任务、模板、时间） */
window.dashOpenCustomerDetail = function(customerId) {
  dashDetail.customer = { id: customerId };
  dashDetail.page = 1;
  renderDashDetail();
};

window.dashBackToCustomerStats = function() {
  dashDetail.customer = null;
  dashDetail.page = 1;
  setDashModalTitle(dashTitles.customers);
  renderDashDetail();
};

async function renderCustomerSendDetail(box, fmt) {
  const cid = dashDetail.customer.id;
  const res = await api.get(`/api/dashboard/customer-send-detail?customer_id=${cid}&page=${dashDetail.page}&page_size=${dashDetail.pageSize}`);
  if (res.code !== 0) { box.innerHTML = '加载失败'; return; }
  const cu = res.data.customer || {};
  setDashModalTitle(`客户邮件发送详情 - ${cu.name || '未知'}（${cu.email || '-'}）`);
  const rows = res.data.records || [];
  // v2.30 需求5：客户维度的统计与明细都不再包含"待发送"
  const statusBadge = s => s === 'sent' ? '<span class="badge badge-success">已发送</span>'
    : '<span class="badge badge-danger">失败</span>';
  box.innerHTML = `
    <div class="search-bar" style="margin-bottom:12px">
      <button class="btn btn-sm btn-secondary" onclick="dashBackToCustomerStats()">← 返回客户列表</button>
      <button class="btn btn-sm btn-secondary" style="margin-left:auto" onclick="dashRefreshDetail()">🔄 刷新</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>任务名称</th><th>使用模板</th><th>状态</th><th>批次</th><th>错误信息</th><th>发送时间</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(l => `<tr>
            <td>${l.campaign_name}</td><td>${l.template_name || '-'}</td>
            <td>${statusBadge(l.status)}</td>
            <td class="dash-batch-cell">${dashBatchCell(l)}</td>
            <td style="font-size:12px;color:var(--danger)">${l.error_message || '-'}</td>
            <td style="font-size:13px">${fmt(l.sent_at)}</td>
          </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary)">该客户暂无发送记录</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="pag-bar">${renderPagination({ total: res.data.total, page: dashDetail.page, pageSize: dashDetail.pageSize, unit: '条记录', gotoFn: 'dashDetailGoto', sizeFn: 'dashDetailSize' })}</div>`;
}

async function renderDashDetail() {
  const box = document.getElementById('dashDetail');
  if (!box || !dashDetail.type) return;
  const fmt = fmtDateTime;

  if (dashDetail.type === 'customers') {
    if (dashDetail.customer) { await renderCustomerSendDetail(box, fmt); return; }
    // v2.32 需求3：留空的次数条件不进入查询串，因此默认就是"无条件查询"
    const f = dashDetail.filters || emptyCustomerFilters();
    const qs = new URLSearchParams();
    if (dashDetail.search) qs.set('search', dashDetail.search);
    ['sent', 'failed', 'total'].forEach(k => { if (f[k] !== '') qs.set(k, f[k]); });
    // v2.44 需求 2：次数条件可按"各任务当前批次/历史批次"的记录来算
    if (dashDetail.batch) qs.set('batch', dashDetail.batch);
    qs.set('page', dashDetail.page);
    qs.set('page_size', dashDetail.pageSize);
    const res = await api.get(`/api/dashboard/customer-stats?${qs}`);
    if (res.code !== 0) { box.innerHTML = '加载失败'; return; }
    const rows = res.data.customers || [];
    const numField = (id, label, val) => `<label class="cs-field">${label}`
      + `<input class="form-input cs-num" type="number" min="0" id="${id}" value="${val}" placeholder="不限"`
      + ` onkeydown="if(event.key==='Enter')dashDetailSearch()"></label>`;
    const hasCond = f.sent !== '' || f.failed !== '' || f.total !== '' || !!dashDetail.search || !!dashDetail.batch;
    box.innerHTML = `
      <div class="search-bar cs-filter-bar">
        <input class="search-input" id="dashSearchInput" placeholder="搜索客户号、姓名、邮箱、公司、标签..." value="${escHtml(dashDetail.search)}" onkeydown="if(event.key==='Enter')dashDetailSearch()">
        ${numField('csSent', '已发送次数', escHtml(f.sent))}
        ${numField('csFailed', '发送失败次数', escHtml(f.failed))}
        ${numField('csTotal', '总发送次数', escHtml(f.total))}
        <label class="cs-field" for="csBatch" title="一个任务可以分多批发信：只统计该客户在各任务当前批次（或历史批次）里的发送次数">批次
          <select class="form-input cs-batch" id="csBatch" onchange="dashDetailSearch()">${batchFilterOptions(dashDetail.batch)}</select>
        </label>
        <button class="btn btn-sm btn-secondary" onclick="dashDetailSearch()">搜索</button>
        <button class="btn btn-sm btn-secondary" onclick="dashDetailReset()">重置</button>
        <button class="btn btn-sm btn-secondary" style="margin-left:auto" onclick="dashRefreshDetail()">🔄 刷新</button>
      </div>
      <p class="cs-filter-tip">${dashCountFilterTip(f)}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>客户号</th><th>姓名</th><th>邮箱</th><th>公司</th><th>已发送</th><th>发送失败</th><th>总计</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(c => `<tr>
              <td class="dash-cust-no">${c.customer_no || '-'}</td><td>${c.name || '-'}</td><td>${c.email}</td><td>${c.company || '-'}</td>
              <td style="color:var(--success)">${numOrDash(c.sent_count)}</td>
              <td style="color:var(--danger)">${numOrDash(c.failed_count)}</td>
              <td>${c.total_count > 0
                ? `<a class="link-cell" title="点击查看该客户的邮件发送详情" onclick="dashOpenCustomerDetail(${c.id})">${c.total_count}</a>`
                : '-'}</td>
            </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;color:var(--text-secondary)">${hasCond ? '没有符合当前筛选条件的客户' : '暂无数据'}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="pag-bar">${renderPagination({ total: res.data.total, page: dashDetail.page, pageSize: dashDetail.pageSize, unit: '位客户', gotoFn: 'dashDetailGoto', sizeFn: 'dashDetailSize' })}</div>`;
    return;
  }

  if (dashDetail.type === 'templates') {
    const res = await api.get('/api/dashboard/template-stats');
    if (res.code !== 0) { box.innerHTML = '加载失败'; return; }
    // v2.31 需求1：模板名称逐行显示（不再合并单元格），顶部下拉框按模板筛选，默认全部模板
    tplStats.rows = res.data || [];
    box.innerHTML = `
      <div class="tpl-stats-bar">
        <label for="tplStatsFilter">模板筛选</label>
        <select class="form-input tpl-stats-filter" id="tplStatsFilter" onchange="tplStatsSetFilter(this.value)">
          <option value="">全部模板</option>${tplStatsOptions()}
        </select>
        <button class="btn btn-sm btn-secondary" onclick="dashRefreshDetail()">🔄 刷新</button>
      </div>
      <div id="tplStatsTable">${tplStatsTableHtml()}</div>`;
    return;
  }

  if (dashDetail.type === 'campaigns') {
    const res = await api.get('/api/campaigns');
    const rows = res.code === 0 ? (Array.isArray(res.data) ? res.data : (res.data.campaigns || [])) : [];
    box.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn btn-sm btn-primary" onclick="Modal.close();router.navigate('campaigns')">前往发送任务界面 →</button>
        <button class="btn btn-sm btn-secondary" style="margin-left:auto" onclick="dashRefreshDetail()">🔄 刷新</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>任务名称</th><th>状态</th><th>发送成功</th><th>发送失败</th><th>发送总计</th><th>批次</th><th>开始时间</th><th>结束时间</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(c => `<tr>
              <td>${c.name}</td><td>${campaignStatusBadge(c)}</td>
              <td style="color:var(--success)">${numOrDash(c.sent)}</td>
              <td style="color:var(--danger)">${numOrDash(c.failed)}</td>
              <td>${numOrDash(c.total)}</td>
              <td class="dash-batch-cell" title="该任务分 ${(c.batch_count || 0) > 0 ? c.batch_count : 1} 批发过，编辑收件人名单会开出新的一批；逐批明细在发送任务界面单击任务行的「批次概览」页签查看">${(c.batch_count || 0) > 1 ? `共${c.batch_count}批 · 当前第${c.current_batch || 1}批` : `第${c.current_batch || 1}批`}</td>
              <td style="font-size:13px">${fmt(c.started_at)}</td>
              <td style="font-size:13px">${fmt(c.finished_at)}</td>
            </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary)">暂无任务</td></tr>'}
          </tbody>
        </table>
      </div>`;
    return;
  }
}

/* ============ 模板发送统计（v2.31 需求1：逐行显示模板名称 + 模板筛选 + 任务起止时间与第几次使用） ============ */


/** 下拉框选项：模板按接口顺序去重，当前筛选项保持选中 */
function tplStatsOptions() {
  const seen = new Set();
  let html = '';
  tplStats.rows.forEach(r => {
    if (r.template_id == null || seen.has(r.template_id)) return;
    seen.add(r.template_id);
    const selected = String(r.template_id) === String(tplStats.filter) ? ' selected' : '';
    html += `<option value="${r.template_id}"${selected}>${escHtml(r.template_name)}</option>`;
  });
  return html;
}

/** 组间按模板最后修改时间倒序（v2.34 需求2：最近修改的模板排在最前）；
 *  组内任务按发送时间从近到远，未发送过（没有发送开始时间）的排在该模板最前面 */
function tplStatsGroups() {
  const key = r => (r.campaign_started_at ? String(r.campaign_started_at) : '');
  const bySentRecentFirst = (a, b) => (key(a) === '' ? 0 : 1) - (key(b) === '' ? 0 : 1)
    || key(b).localeCompare(key(a)) || (b.campaign_id || 0) - (a.campaign_id || 0);
  const groups = new Map();
  tplStats.rows.forEach(r => {
    if (tplStats.filter && String(r.template_id) !== String(tplStats.filter)) return;
    if (!groups.has(r.template_id)) groups.set(r.template_id, []);
    groups.get(r.template_id).push(r);
  });
  const list = [];
  groups.forEach(rows => {
    rows.sort(bySentRecentFirst);
    list.push({ rows, updated: String(rows[0].template_updated_at || '') });
  });
  list.sort((a, b) => b.updated.localeCompare(a.updated) || (b.rows[0].template_id || 0) - (a.rows[0].template_id || 0));
  return list;
}

function tplStatsTableHtml() {
  // v2.34 需求2：三个次数为 0 时用"-"占位，避免满屏的 0 干扰阅读
  const num = numOrDash;
  let body = '';
  tplStatsGroups().forEach(g => {
    g.rows.forEach(r => {
      body += `<tr>
        <td>${escHtml(r.template_name)}</td>
        <td>${r.campaign_name ? escHtml(r.campaign_name) : '<span style="color:var(--text-secondary)">未关联任务</span>'}</td>
        <td>${r.template_use_no ? `第 ${r.template_use_no} 次` : '-'}</td>
        <td style="color:var(--success)">${num(r.sent_count)}</td>
        <td style="color:var(--danger)">${num(r.failed_count)}</td>
        <td><strong>${num(r.send_times)}</strong></td>
        <td class="tpl-stats-time">${fmtDateTime(r.campaign_started_at)}</td>
        <td class="tpl-stats-time">${fmtDateTime(r.campaign_finished_at)}</td>
      </tr>`;
    });
  });
  return `
    <div class="table-wrap">
      <table class="tpl-stats-table">
        <thead><tr><th>模板名称</th><th>关联任务</th><th>第几次使用该模板</th><th>发送成功</th><th>发送失败</th><th>发送总数</th><th>发送开始时间</th><th>发送完成时间</th></tr></thead>
        <tbody>${body || '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary)">暂无模板</td></tr>'}</tbody>
      </table>
    </div>
    <p style="font-size:12px;color:var(--text-secondary);margin-top:8px">“发送成功/发送失败”为该模板在每个任务下各收件人的最终状态，“发送总数”统计每次实际发送动作（含重发与失败尝试），数值为 0 时显示“-”，模板按最后修改时间从近到远排列，同一模板的任务按发送时间从近到远排列、没有发送过的任务排在最前。</p>`;
}

/** 切换模板筛选：只重绘表格，不重新请求接口 */
window.tplStatsSetFilter = function(v) {
  tplStats.filter = v || '';
  const host = document.getElementById('tplStatsTable');
  if (host) host.innerHTML = tplStatsTableHtml();
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 折线图 x 轴单位：本周/本月按天分桶（tooltip 只显示日期），本年按月
const TREND_UNIT = { day: '时', week: '', month: '', year: '' };

/** 折线图容器：固定高度、内置放大按钮、悬停 tooltip，无横/纵滚动条 */
function renderTrendChart(t, period) {
  const unit = TREND_UNIT[period] || '';
  const hasData = (t.total_sent || 0) + (t.total_failed || 0) > 0;
  const legend = `
    <div class="trend-legend">
      <span><span class="dot" style="background:#10B981"></span>成功</span>
      <span><span class="dot" style="background:#EF4444"></span>失败</span>
    </div>`;
  if (!hasData) return `<div class="trend-empty">该时间段暂无发送数据</div>${legend}`;
  return `
    <div class="trend-wrap" data-unit="${unit}">
      <div class="trend-toolbar">
        <button class="btn btn-sm btn-secondary" title="放大查看折线图" onclick="expandTrendChart()">⤢ 放大</button>
      </div>
      <div class="trend-chart"></div>
      <div class="trend-tip" style="display:none"></div>
    </div>${legend}`;
}

/** 在 .trend-wrap 内渲染指定高度的 SVG 折线图；opts.onSelect(i) 支持点击数据点钻取，selectedIndex 高亮选中点 */
function mountTrendChart(wrap, t, height, opts) {
  opts = opts || {};
  const host = wrap.querySelector('.trend-chart');
  if (!host) return;
  const w = Math.max(320, host.clientWidth || wrap.clientWidth || 600);
  host.innerHTML = trendSvg(t, w, height);
  const tip = wrap.querySelector('.trend-tip');
  const unit = wrap.dataset.unit || '';
  const svg = host.querySelector('.trend-svg');
  const vline = host.querySelector('.trend-vline');
  const n = (t.labels || []).length;
  const lineX = i => trendX(i, n, w) + ((svg && svg.offsetLeft) || 0);

  function placeVline(i) {
    if (!vline) return;
    vline.setAttribute('x1', lineX(i));
    vline.setAttribute('x2', lineX(i));
    vline.style.display = 'block';
  }

  if (opts.selectedIndex != null) {
    placeVline(opts.selectedIndex);
    if (vline) vline.classList.add('selected');
  }

  host.onmousemove = function(e) {
    const hit = e.target.closest ? e.target.closest('[data-i]') : null;
    if (!hit || !tip) return;
    const i = +hit.getAttribute('data-i');
    const s = (t.sent || [])[i] || 0;
    const f = (t.failed || [])[i] || 0;
    tip.innerHTML = `<b>${t.labels[i]}${unit}</b> 成功 ${s} · 失败 ${f}${opts.onSelect ? ' <span style="opacity:.7">｜点击筛选该时段</span>' : ''}`;
    tip.style.display = 'block';
    const rect = wrap.getBoundingClientRect();
    const x = lineX(i);
    const tipW = tip.offsetWidth;
    let left = x - tipW / 2;
    left = Math.max(4, Math.min(left, rect.width - tipW - 4));
    tip.style.left = left + 'px';
    tip.style.top = (host.offsetTop + 6) + 'px';
    if (vline) vline.classList.remove('selected');
    placeVline(i);
  };
  host.onmouseleave = function() {
    if (tip) tip.style.display = 'none';
    if (vline) {
      if (opts.selectedIndex != null) { placeVline(opts.selectedIndex); vline.classList.add('selected'); }
      else vline.style.display = 'none';
    }
  };
  if (opts.onSelect) {
    host.onclick = function(e) {
      const hit = e.target.closest ? e.target.closest('[data-i]') : null;
      if (hit) opts.onSelect(+hit.getAttribute('data-i'));
    };
  }
}

function trendX(i, n, w) {
  const padL = 44, padR = 14;
  return n <= 1 ? padL + (w - padL - padR) / 2 : padL + (w - padL - padR) * i / (n - 1);
}

function trendSvg(t, w, h) {
  const padL = 44, padR = 14, padT = 12, padB = 26;
  const labels = t.labels || [];
  const n = labels.length;
  const max = Math.max(1, ...(t.sent || []), ...(t.failed || []));
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const y = v => padT + innerH - (v / max) * innerH;

  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const val = Math.round(max * g / 4);
    const yy = y(val);
    grid += `<line class="grid-line" x1="${padL}" y1="${yy}" x2="${w - padR}" y2="${yy}"></line>
      <text class="grid-val" x="${padL - 6}" y="${yy + 4}" text-anchor="end">${val}</text>`;
  }
  const skip = n <= 12 ? 1 : (n <= 24 ? 2 : Math.ceil(n / 12));
  let axis = `<line class="axis-line" x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}"></line>`;
  labels.forEach((l, i) => {
    if (i % skip === 0 || i === n - 1) {
      axis += `<text class="axis-label" x="${trendX(i, n, w)}" y="${h - 8}" text-anchor="middle">${l}</text>`;
    }
  });
  const pts = key => labels.map((_, i) => `${trendX(i, n, w)},${y((t[key] || [])[i] || 0)}`).join(' ');
  // 数据点按状态着色：只画有数据的点，成功绿、失败红；同值重叠时左右错位以同时显示
  let dots = '';
  labels.forEach((_, i) => {
    const s = (t.sent || [])[i] || 0;
    const f = (t.failed || [])[i] || 0;
    const dodge = (s > 0 && f > 0 && s === f) ? 3.5 : 0;
    if (f > 0) dots += `<circle class="trend-dot failed" cx="${trendX(i, n, w) + dodge}" cy="${y(f)}" r="3.5"></circle>`;
    if (s > 0) dots += `<circle class="trend-dot sent" cx="${trendX(i, n, w) - dodge}" cy="${y(s)}" r="3.5"></circle>`;
  });
  const hits = labels.map((_, i) => {
    const bw = n <= 1 ? innerW : innerW / (n - 1);
    return `<rect data-i="${i}" x="${trendX(i, n, w) - bw / 2}" y="${padT}" width="${bw}" height="${innerH}" fill="transparent"></rect>`;
  }).join('');

  return `<svg class="trend-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${grid}${axis}
    <polyline class="trend-line failed" points="${pts('failed')}"></polyline>
    <polyline class="trend-line sent" points="${pts('sent')}"></polyline>
    ${dots}
    <line class="trend-vline" y1="${padT}" y2="${h - padB}" style="display:none"></line>
    ${hits}
  </svg>`;
}

/** 放大浮层：自定义 overlay（不用 Modal，避免顶掉当前仪表盘弹窗） */
window.expandTrendChart = function() {
  const s = dashEmbed;
  const t = s.trendData;
  if (!t) return;
  let root = document.getElementById('trendZoomRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'trendZoomRoot';
    document.body.appendChild(root);
  }
  const h = Math.max(300, Math.min(520, Math.round(window.innerHeight * 0.55)));
  const unit = TREND_UNIT[s.period] || '';
  root.innerHTML = `
    <div class="trend-zoom-overlay" onclick="if(event.target===this)closeTrendZoom()">
      <div class="trend-zoom-box">
        <div class="trend-zoom-head">
          <b>发送趋势 · 放大查看</b>
          <span style="font-size:12px;color:var(--text-secondary)">统计区间 ${t.start} ~ ${t.end}（悬停查看各点数值）</span>
          <button class="btn btn-sm btn-secondary" style="margin-left:auto" onclick="closeTrendZoom()">✕ 关闭</button>
        </div>
        <div class="trend-wrap trend-zoom-chart" data-unit="${unit}">
          <div class="trend-chart"></div>
          <div class="trend-tip" style="display:none"></div>
        </div>
        <div class="trend-legend">
          <span><span class="dot" style="background:#10B981"></span>成功</span>
          <span><span class="dot" style="background:#EF4444"></span>失败</span>
        </div>
      </div>
    </div>`;
  const wrap = root.querySelector('.trend-zoom-chart');
  mountTrendChart(wrap, t, h);
};

window.closeTrendZoom = function() {
  const root = document.getElementById('trendZoomRoot');
  if (root) root.innerHTML = '';
};
