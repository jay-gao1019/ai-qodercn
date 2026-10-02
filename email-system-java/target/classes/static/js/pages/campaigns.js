function CampaignsPage() {
  return `
    <div class="page-header">
      <h1>发送任务</h1>
      <button class="btn btn-primary" id="btnCreateCampaign">+ 创建任务</button>
    </div>
    <!-- v2.42 需求6：任务操作从每行的行内按钮收敛到一条工具栏（形态同客户管理的 .customers-bar），
         单击选中某条任务后，这些按钮才对那条记录生效；"暂停"即原"停止"（走 /{id}/cancel）。
         v2.43 需求5.1：工具栏不显示"已选中：任务名称"；需求5.2：按选中任务的状态直接置灰不可用按钮。
         v2.45 需求1.1：原"发送"和"继续发送"两枚按钮合并成一枚 #btnCampStart，
         选中的任务没执行过发送时显示"发送"（走 /{id}/start），发过且成功率不为 100% 时显示"继续发送"（走 /{id}/resume）
         v2.48 需求1：工具栏里的提示文字（#campBarHint）整体删除，选中状态只靠行底色高亮 -->
    <div class="search-bar campaigns-bar">
      <button class="btn btn-sm btn-secondary" id="btnCampStart" disabled>发送</button>
      <button class="btn btn-sm btn-secondary" id="btnCampPause" disabled>暂停</button>
      <button class="btn btn-sm btn-secondary" id="btnCampResendAll" disabled>全部重发</button>
      <button class="btn btn-sm btn-secondary" id="btnCampEdit" disabled>编辑</button>
      <button class="btn btn-sm btn-danger" id="btnCampDelete" disabled>删除</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>任务名称</th><th>模板</th><th>SMTP</th><th>状态</th><th>进度</th><th>发送间隔</th><th title="列表按最近状态更新时间排序：任务创建时间与任务内任意一封邮件的最后发送时间取较近者">创建时间</th></tr></thead>
          <tbody id="campaignList"><tr><td colspan="7" style="text-align:center;color:var(--text-secondary)">加载中...</td></tr></tbody>
        </table>
      </div>
      <div id="campaignPagination" class="pag-bar"></div>
    </div>
    <div id="campaignDetail" style="display:none"></div>
  `;
}

let campaignPage = 1;
// v2.25：任务列表默认每页 5 条（后端按创建时间从新到旧排序）
let campaignPageSize = 5;
let campaignTotal = 0;
let pollTimer = null;
// v2.42 需求6：当前选中的任务（单选，工具栏按钮作用于它）；行数据缓存用于取状态
let selectedCampaignId = null;
let campaignRows = [];

// v2.35 需求3.2：任务五态徽章统一由 components/format.js 的 campaignStatusBadge 渲染，
// 状态口径（display_status）由后端推导，列表与仪表盘"任务发送统计"共用同一份文案。

// v2.26：除"继续发送/全部重发"外的运行一律记为"第一次批量"
const runTypeMap = {
  first_batch: '<span class="badge badge-info">第一次批量</span>',
  resume: '<span class="badge badge-warning">继续发送</span>',
  resend_all: '<span class="badge badge-info">全部重发</span>',
};

/** 与 runTypeMap 对应的纯文本，供固定宽度单元格的 hover 提示使用 */
const runTypeText = {
  first_batch: '第一次批量',
  resume: '继续发送',
  resend_all: '全部重发',
};

/**
 * v2.42 需求6：工具栏按钮各自的可用条件。判定口径与 v2.41 行内按钮一致，
 * 只是从"按状态显示/隐藏按钮"改成"始终显示、不可用时置灰并在 title 说明原因"。
 * <p>v2.45 需求1.1：原"发送""继续发送"合并成一枚按钮，sendFresh 决定它显示成哪一种——
 * 新建且从未执行过发送 → "发送"（走 /{id}/start）；已经跑过、成功率不为 100% → "继续发送"（走 /{id}/resume）。
 * <p>v2.45 需求1.2：编辑不再要求"一封都没发出去"，只要不在发送中即可。
 * <p>v2.46 需求4：收件客户能否一起改，看该任务是否一封都没发出去（{@code canEditRecipients}）；
 * 口径与后端的"发送日志里没有任何非 pending 记录"一致，前端用 sent+failed 推导。
 */
function campaignFlags(c) {
  const display = c.display_status || c.status;
  const hasHistory = c.total > 0;
  const everSent = (c.sent + c.failed) > 0;
  const notRunning = !c.is_running && c.status !== 'running';
  // "新建未执行过发送"：仍是待发送状态，且一条都没发出去（含成功与失败）
  const sendFresh = display === 'pending' && !everSent;
  return {
    sendFresh,
    canSend: sendFresh && notRunning,
    canPause: !!c.is_running,
    // 成功率不为 100%（还有未成功的记录）才能继续发送；v2.30 需求4 的"发出去过才算"已并入 sendFresh 分支
    canResume: !sendFresh && hasHistory && notRunning && c.total - c.sent > 0,
    canResendAll: hasHistory && notRunning && (c.status === 'completed' || c.status === 'cancelled'),
    canEdit: notRunning,
    canEditRecipients: notRunning && !everSent,
    // v2.30 需求2：新建（未发送）任务也可删除，只保留"发送中的任务不可删"这一限制
    canDelete: notRunning,
  };
}

/** 合并后的发送按钮：置灰时说明为什么不能点，可用时说明这一次点下去会发生什么 */
function campaignSendHint(c, f) {
  if (f.canSend) return '该任务尚未执行过发送：立即向该任务的全部收件客户发送邮件';
  if (f.canResume) return '重新发送任务中所有未成功的邮件（失败/待发送），已发送成功的不再重发';
  if (!f.sendFresh && c.total > 0 && c.sent >= c.total) {
    return '该任务已全部发送成功（成功率 100%），没有可继续发送的记录；如需整批再发一遍请用"全部重发"';
  }
  if (c.is_running || c.status === 'running') return '任务正在发送中，请先暂停后再发送';
  if (f.sendFresh) return '该任务当前不是待发送状态，无法直接发送';
  return '该任务没有可发送的收件客户';
}

/** 各按钮置灰时的原因说明（可用时的提示见 enabled 分支） */
function campaignButtonHint(key, c, f) {
  if (f[key]) {
    return {
      canPause: '暂停该任务：已发送的邮件不受影响，未发送的保持待发送',
      canResendAll: '重新发送给该任务中的全部客户，包括之前已发送成功的',
      canEdit: '修改该任务的模板、SMTP 配置与发送方式'
        + (f.canEditRecipients ? '；该任务还没发出过邮件，收件客户也可以一起改' : '；任务名称固定，收件客户已随邮件发出、不可再改')
        + '（发送中的任务不可编辑）',
      canDelete: '删除该发送任务，相关发送记录一并删除',
    }[key];
  }
  switch (key) {
    case 'canPause':
      return '任务当前没有在发送，无需暂停';
    case 'canResendAll':
      return '只有已完成或已停止的任务可以"全部重发"';
    case 'canEdit':
      return '任务正在发送中，请先暂停后再编辑';
    case 'canDelete':
      return '任务正在发送中，请先暂停后再删除';
    default:
      return '';
  }
}

const CAMPAIGN_BUTTONS = [
  ['btnCampPause', 'canPause'],
  ['btnCampResendAll', 'canResendAll'],
  ['btnCampEdit', 'canEdit'],
  ['btnCampDelete', 'canDelete'],
];

/**
 * 工具栏状态：未选中任务时全部置灰；选中后按该任务的状态把"不能做"的按钮直接置灰。
 * v2.43 需求5.1：不再显示"已选中：任务名称"（选中行本身有底色高亮，工具栏文案保持静态）；
 * v2.43 需求5.2：可用性由 disabled 表达，不再依赖点击后的 toast 提示，原因放在 title 里。
 * v2.45 需求1.1：#btnCampStart 一枚按钮承担发送/继续发送两种形态，文案随之切换。
 */
function updateCampaignToolbar() {
  const c = getSelectedCampaign();
  const f = c ? campaignFlags(c) : null;
  CAMPAIGN_BUTTONS.forEach(([bid, key]) => {
    const el = document.getElementById(bid);
    if (!el) return;
    el.disabled = !c || !f[key];
    el.title = c ? campaignButtonHint(key, c, f) : '请先单击选中一条任务';
  });
  const sendBtn = document.getElementById('btnCampStart');
  if (sendBtn) {
    sendBtn.textContent = f && !f.sendFresh ? '继续发送' : '发送';
    sendBtn.disabled = !c || !(f.canSend || f.canResume);
    sendBtn.title = c ? campaignSendHint(c, f) : '请先单击选中一条任务';
  }
}

/** 当前选中的任务；列表是服务端分页，翻页后选中项不在本页时为空 */
function getSelectedCampaign() {
  return selectedCampaignId != null ? campaignRows.find(x => x.id === selectedCampaignId) : null;
}

async function loadCampaignList() {
  const res = await api.get(`/api/campaigns?page=${campaignPage}&page_size=${campaignPageSize}`);
  const tbody = document.getElementById('campaignList');
  if (!tbody) return [];
  const campaigns = res.code === 0 ? (res.data.campaigns || res.data) : [];
  const total = res.code === 0 ? (res.data.total || campaigns.length) : 0;
  campaignTotal = total;
  campaignRows = campaigns;
  // 任务列表是服务端分页：翻页/筛选后原选中项可能不在本页，此时清空选中而不是跨页保留
  if (!campaigns.some(c => c.id === selectedCampaignId)) selectedCampaignId = null;

  if (campaigns.length > 0) {
    tbody.innerHTML = campaigns.map(c => {
      const pct = c.total > 0 ? Math.round((c.sent + c.failed) / c.total * 100) : 0;
      // v2.35 需求3.2：状态列与"发送"按钮都按后端推导的五态走，不再直接暴露数据库状态
      const display = c.display_status || c.status;
      return `<tr class="clickable-row${c.id === selectedCampaignId ? ' row-selected' : ''}" data-cid="${c.id}" title="单击选中该任务并用上方工具栏操作，同时查看发送详情" onclick="rowSelectCampaign(event, ${c.id})">
        <td>${c.name}</td>
        <td>${c.template_name || '-'}</td>
        <td>${c.smtp_name || '-'}</td>
        <td>${campaignStatusBadge(c)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="progress-bar" style="width:100px;margin:0"><div class="progress-fill" style="width:${pct}%"></div></div>
            <span style="font-size:12px">${c.sent + c.failed}/${c.total}${display === 'uncompleted'
              ? ` <span style="color:var(--danger);font-weight:600" title="全部发送完成，其中有 ${c.failed} 封失败">失败 ${c.failed}</span>` : ''}</span>
          </div>
        </td>
        <td style="font-size:13px">${c.interval_min || 1} 分钟</td>
        <td style="font-size:13px">${fmtDateTime(c.created_at)}</td>
      </tr>`;
    }).join('');

    document.getElementById('campaignPagination').innerHTML = renderPagination({
      total, page: campaignPage, pageSize: campaignPageSize, unit: '条任务',
      gotoFn: 'gotoCampaignPage', sizeFn: 'setCampaignPageSize', pageSizes: [5, 15, 30, 50],
    });
  } else {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><p>暂无发送任务</p></td></tr>';
    document.getElementById('campaignPagination').innerHTML = renderPagination({
      total: 0, page: 1, pageSize: campaignPageSize, unit: '条任务',
      gotoFn: 'gotoCampaignPage', sizeFn: 'setCampaignPageSize',
    });
  }
  updateCampaignToolbar();
  return campaigns;
}

/**
 * v2.42 需求6：单击任务行 = 选中该任务（工具栏随之刷新）+ 查看它的发送详情。
 * 点行内控件（本页已无操作按钮，保留判断以防后续加控件）时不响应。
 */
window.rowSelectCampaign = function(event, id) {
  if (event && event.target.closest('button, a, select, input')) return;
  selectedCampaignId = id;
  document.querySelectorAll('#campaignList tr[data-cid]').forEach(tr => {
    tr.classList.toggle('row-selected', parseInt(tr.dataset.cid, 10) === id);
  });
  updateCampaignToolbar();
  viewCampaignDetail(id);
};

window.gotoCampaignPage = function(p) {
  const totalPages = Math.max(1, Math.ceil(campaignTotal / campaignPageSize));
  campaignPage = Math.min(Math.max(1, p), totalPages);
  loadCampaignList();
};

window.setCampaignPageSize = function(s) {
  campaignPageSize = parseInt(s);
  campaignPage = 1;
  loadCampaignList();
};

window.startCampaign = async function(id) {
  const r = await api.post(`/api/campaigns/${id}/start`);
  showToast(r.message, r.code === 0 ? 'success' : 'error');
  loadCampaignList();
  refreshOpenDetail();
  startPolling();
};

/** v2.42 需求6：工具栏"暂停"。即原行内"停止"，仍走 /{id}/cancel，只改文案不改行为 */
window.stopCampaign = function(id) {
  Modal.show({
    title: '确认暂停',
    content: '<p>确定要暂停此发送任务吗？已发送的邮件不会受影响，未发送的邮件将保持待发送状态。</p>',
    confirmText: '暂停',
    onConfirm: async () => {
      const r = await api.post(`/api/campaigns/${id}/cancel`);
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      loadCampaignList();
      refreshOpenDetail();
    }
  });
};

window.resumeCampaign = function(id) {
  Modal.show({
    title: '继续发送',
    content: '<p>将重新发送该任务中所有<strong>未成功发送</strong>（失败/待发送）的邮件，本次任务中已发送成功的邮件<strong>不会重复发送</strong>。</p>',
    confirmText: '继续发送',
    onConfirm: async () => {
      const r = await api.post(`/api/campaigns/${id}/resume`);
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      loadCampaignList();
      refreshOpenDetail();
      if (r.code === 0) startPolling();
    }
  });
};

window.resendAllCampaign = function(id) {
  Modal.show({
    title: '全部重发',
    content: '<p>将重新发送给该任务中的所有客户（包括之前已发送成功的），确定继续吗？</p>',
    confirmText: '全部重发',
    onConfirm: async () => {
      const r = await api.post(`/api/campaigns/${id}/resend-all`);
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      loadCampaignList();
      refreshOpenDetail();
      if (r.code === 0) startPolling();
    }
  });
};

window.deleteCampaign = function(id) {
  Modal.show({
    title: '确认删除',
    content: '<p>确定要删除此发送任务吗？删除后无法恢复，相关的发送记录也将被删除。</p>',
    confirmText: '删除',
    onConfirm: async () => {
      const r = await api.del(`/api/campaigns/${id}`);
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      if (r.code === 0 && selectedCampaignId === id) selectedCampaignId = null;
      loadCampaignList();
    }
  });
};

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const res = await api.get(`/api/campaigns?page=${campaignPage}&page_size=${campaignPageSize}`);
    const campaigns = res.code === 0 ? (res.data.campaigns || res.data) : [];
    const hasRunning = campaigns.some(c => c.is_running);
    loadCampaignList();
    // v2.18：轮询时同步刷新已打开的详情视图，任务执行完成后统计/状态/发送记录即时为最后状态
    refreshOpenDetail();
    if (!hasRunning) { clearInterval(pollTimer); pollTimer = null; }
  }, 3000);
}

/** 详情视图打开时按最新任务状态就地刷新（v2.49 需求3：整页已无任何自动滚动，滚动位置只由用户手动控制） */
function refreshOpenDetail() {
  if (currentDetailCampaignId) loadLogPage(currentDetailCampaignId);
}

let logPage = 1;
// v2.27：发送记录初始化每页只显示 5 条
let logPageSize = 5;
let currentDetailCampaignId = null;
let attPage = 1;
let attPageSize = 15;
// v2.20 详情状态筛选：''=全部（默认）/ sent=已发送 / failed=失败 / pending=待发送（v2.32 需求1），作用于"发送记录"
// v2.32 需求4："发送详情"不再跟随筛选自动查询，必须点选一条发送记录才呈现
let detailStatus = '';
// v2.21 点击发送记录行后，"发送详情"只显示该邮箱在本任务下的所有发送尝试
let attCustomerId = null;
let attCustomerEmail = '';
// v2.22 选中记录的当前状态（早期数据没有逐次尝试明细时，用它兜底展示该记录本身）
let attLogInfo = null;

window.viewCampaignDetail = async function(id) {
  const campaign = await findCampaignById(id);
  if (!campaign) return;

  currentDetailCampaignId = id;
  logPage = 1;
  attPage = 1;
  detailStatus = '';
  attCustomerId = null;
  attCustomerEmail = '';
  attLogInfo = null;
  loadLogPage(id, campaign);
};

/** 点击状态栏条目：按该状态筛选发送记录；v2.25 起再次点击同一条目取消筛选（显示全部） */
window.setDetailStatusFilter = function(s) {
  detailStatus = detailStatus === s ? '' : s;
  logPage = 1;
  attPage = 1;
  // v2.32 需求4：换筛选条件后原先点选的记录可能已不在列表中，回到"未点选→不显示发送详情"的初始态
  attCustomerId = null;
  attCustomerEmail = '';
  attLogInfo = null;
  loadLogPage(currentDetailCampaignId);
};

window.gotoCampaignLogPage = function(p) {
  logPage = p;
  loadLogPage(currentDetailCampaignId);
};

window.setCampaignLogPageSize = function(s) {
  logPageSize = parseInt(s);
  logPage = 1;
  loadLogPage(currentDetailCampaignId);
};

/** v2.38 需求3.1：单击筛选的延迟执行句柄，双击打开客户详情时用它取消待执行的筛选 */
let logRowFilterTimer = null;

/**
 * v2.21 点击一条发送记录：发送详情只显示该邮箱在本任务下的所有发送历史；再次点击同一行取消。
 * v2.38 需求3.1 同一行还要支持"双击打开客户详情"，而浏览器在 dblclick 之前必然先派发两次 click，
 * 所以把筛选推迟 260ms 执行，dblclick（rowShowLogCustomer）会取消它。
 */
window.rowFilterSendDetail = function(event) {
  const tr = event.currentTarget;
  clearTimeout(logRowFilterTimer);
  logRowFilterTimer = setTimeout(() => applyRowFilterSendDetail(tr), 260);
};

function applyRowFilterSendDetail(tr) {
  const cid = parseInt(tr.dataset.cust, 10);
  if (!cid) return;
  if (attCustomerId === cid) { clearSendDetailFilter(); return; }
  attCustomerId = cid;
  attCustomerEmail = tr.dataset.email || '';
  attLogInfo = {
    // v2.40 需求2：发送记录加了"客户号"首列，客户名称挪到第 2 列（改列数时这里要跟着挪）
    customerName: tr.cells[1]?.innerText || '',
    customerNo: tr.dataset.custno || '',
    status: tr.dataset.logStatus || '',
    sentAt: tr.dataset.logSentAt || '',
    error: tr.dataset.logError || '',
  };
  attPage = 1;
  // v2.49 需求3：点选记录只刷新"发送详情"内容，不再 scrollIntoView 把视口拉过去
  loadSendDetail(currentDetailCampaignId);
}

window.clearSendDetailFilter = function() {
  attCustomerId = null;
  attCustomerEmail = '';
  attLogInfo = null;
  attPage = 1;
  loadSendDetail(currentDetailCampaignId);
};

/**
 * 按 ID 取单个任务详情（v2.32 需求1/6：改走 /api/campaigns/{id}，
 * 不再拉全量任务列表让前端自己找，同时带回后端算好的待发送数）。
 */
async function findCampaignById(id) {
  const res = await api.get(`/api/campaigns/${id}`);
  return res.code === 0 ? res.data : null;
}

/**
 * v2.38 需求3.1：撤掉 v2.35"点客户名称弹编辑窗"的链接，客户名称回到纯文本；
 * 编辑入口改为整行双击 → "编辑客户"窗口（见 rowShowLogCustomer）。
 */
function logCustomerNameCell(l) {
  return escHtml(l.customer_name) || '-';
}

/**
 * v2.38 需求3.1 引入、v2.42 需求3 改为直接编辑：双击发送记录整行打开"编辑客户"窗口。
 * 必须先取消待执行的单击筛选，否则一次双击会连带把"发送详情"筛成该邮箱。
 */
window.rowShowLogCustomer = function(event) {
  clearTimeout(logRowFilterTimer);
  const cid = parseInt(event.currentTarget.dataset.cust, 10);
  if (!cid) return;
  window.showCustomerDetail(cid, () => loadLogPage(currentDetailCampaignId));
};

async function loadLogPage(campaignId, campaign) {
  if (!campaign) {
    campaign = await findCampaignById(campaignId);
    if (!campaign) return;
  }

  const statusParam = detailStatus ? `&status=${detailStatus}` : '';
  const logsRes = await api.get(`/api/campaigns/${campaignId}/logs?page=${logPage}&page_size=${logPageSize}${statusParam}`);
  const logsData = logsRes.code === 0 ? logsRes.data : { logs: [], total: 0 };
  const logs = logsData.logs || [];
  const logTotal = logsData.total || logs.length;
  const pct = campaign.total > 0 ? Math.round((campaign.sent + campaign.failed) / campaign.total * 100) : 0;
  // v2.25：状态栏"已发送/总数"后的百分比 = 已发送 / 总数
  const sentPct = campaign.total > 0 ? Math.round(campaign.sent / campaign.total * 100) : 0;
  // v2.32 需求1：待发送数以后端按发送日志实算的 pending_count 为准，缺省时按统计列折算
  const pendingCount = campaign.pending_count != null
    ? campaign.pending_count
    : Math.max(0, (campaign.total || 0) - (campaign.sent || 0) - (campaign.failed || 0));

  const detail = document.getElementById('campaignDetail');
  detail.style.display = 'block';

  // v2.28：状态栏三段——"已发送/总数"（点击筛选 sent，"已发送"绿色字体）、"发送成功率"（= 已发送 ÷ 总数，纯展示）、"失败"（点击筛选 failed）
  // v2.32 需求1：追加第四段"待发送"（点击筛选 pending，再点取消）
  // v2.34 需求1.3：第一段是"成功数/总数"，数值为 sent 数 / 任务总记录数
  const sentLabel = '<em class="statbar-sent">成功数</em>';

  detail.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:10px">${escHtml(campaign.name)} - 发送详情</h3>
      <div class="campaign-statbar">
        <span class="statbar-item${detailStatus === 'sent' ? ' active' : ''}" onclick="setDetailStatusFilter('sent')"
              title="点击只显示状态为已发送（sent）的记录，再次点击取消筛选">${sentLabel}/总数：<b><span class="statbar-sent">${campaign.sent}</span>/${campaign.total}</b></span>
        <span class="statbar-item statbar-static" title="发送成功率 = 已发送 ÷ 总数">发送成功率：<b>${sentPct}%</b></span>
        <span class="statbar-item${detailStatus === 'failed' ? ' active' : ''}" onclick="setDetailStatusFilter('failed')"
              title="点击只显示发送失败的记录，再次点击取消筛选">失败：<b style="color:var(--danger)">${campaign.failed}</b></span>
        <span class="statbar-item${detailStatus === 'pending' ? ' active' : ''}" onclick="setDetailStatusFilter('pending')"
              title="点击只显示待发送的记录，再次点击取消筛选">待发送：<b class="statbar-pending">${pendingCount}</b></span>
      </div>
      <div class="progress-bar" style="height:12px"><div class="progress-fill" style="width:${pct}%"></div></div>
      <p style="font-size:13px;color:var(--text-secondary);margin-top:8px">完成度: ${pct}% | 发送间隔: ${campaign.interval_min || 1} 分钟 | 开始时间: ${fmtDateTime(campaign.started_at)} | 结束时间: ${fmtDateTime(campaign.finished_at)}</p>
    </div>
    <div class="card">
      <h3 style="margin-bottom:6px">发送记录</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>客户号</th><th>客户名称</th><th>邮箱</th><th>发送次数</th><th>状态</th><th>发送情况</th><th>发送时间</th></tr></thead>
          <tbody>
            ${logs.length > 0 ? logs.map(l => {
              const logStatus = l.status === 'sent' ? '<span class="badge badge-success">已发送</span>' : l.status === 'failed' ? '<span class="badge badge-danger">失败</span>' : '<span class="badge badge-info">待发送</span>';
              const sentAt = fmtDateTime(l.sent_at);
              // v2.26：发送次数按"成功次数/总次数"展示，没有失败次数时只显示成功次数
              const totalCount = l.send_count || 0;
              const okCount = l.success_count || 0;
              // v2.32 需求2：待发送记录一次都还没发过，发送次数显示"-"而不是 0
              const isPending = l.status === 'pending';
              const countText = isPending ? '-'
                : (totalCount > 0 && okCount < totalCount ? `${okCount}/${totalCount}` : `${okCount}`);
              const countHint = isPending
                ? '该邮箱在本任务下还没有发送，点击查看其发送详情'
                : totalCount > 0 && okCount < totalCount
                  ? `该邮箱在本任务下共发送 ${totalCount} 次，其中成功 ${okCount} 次，点击查看其逐次发送历史`
                  : `该邮箱在本任务下成功发送 ${okCount} 次，点击查看其逐次发送历史`;
              const activeRow = attCustomerId && attCustomerId === l.customer_id;
              // v2.33 需求3：重试后才成功的记录文案是结论而非报错，用成功色显示
              const errColor = l.status === 'failed' ? 'var(--danger)' : 'var(--success)';
              return `<tr class="clickable-row" data-cust="${l.customer_id}" data-custno="${escHtml(l.customer_no)}" data-email="${escHtml(l.customer_email)}" data-log-status="${escHtml(l.status)}" data-log-sent-at="${escHtml(sentAt)}" data-log-error="${escHtml(l.error_message)}"${activeRow ? ' style="background:#EFF6FF"' : ''} title="${countHint}；双击编辑该客户信息" onclick="rowFilterSendDetail(event)" ondblclick="rowShowLogCustomer(event)"><td>${escHtml(l.customer_no) || '-'}</td><td>${logCustomerNameCell(l)}</td><td>${escHtml(l.customer_email) || '-'}</td><td><strong>${countText}</strong></td><td>${logStatus}</td><td style="font-size:12px;color:${errColor}">${escHtml(l.error_message) || '-'}</td><td style="font-size:13px">${sentAt}</td></tr>`;
            }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary)">暂无记录</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="pag-bar">
        ${renderPagination({
          total: logTotal, page: logPage, pageSize: logPageSize, unit: '条记录',
          gotoFn: 'gotoCampaignLogPage', sizeFn: 'setCampaignLogPageSize',
        })}
      </div>
    </div>
    <div class="card" id="campaignSendDetailCard"${attCustomerId ? '' : ' style="display:none"'}>
      <h3 style="margin-bottom:6px">发送详情</h3>
      <div id="campaignSendDetail"><div style="text-align:center;color:var(--text-secondary);padding:16px">加载中...</div></div>
    </div>
  `;

  // v2.49 需求2：未点选发送记录时整张"发送详情"卡片隐藏；需求3：不再 scrollIntoView 抢滚动位置
  loadSendDetail(campaignId);
}

/**
 * 渲染任务详情中的"发送详情"（v2.26 由"历史发送情况"更名）：
 * 逐次尝试明细 + 发送当时的客户/模板/SMTP 数据快照，后续资料变更不影响这里的历史呈现。
 */
async function loadSendDetail(campaignId) {
  const box = document.getElementById('campaignSendDetail');
  const card = document.getElementById('campaignSendDetailCard');
  if (!box || !campaignId) return;

  // v2.49 需求2（取代 v2.32 需求4 的"占位提示"形态）：未点选发送记录时整张"发送详情"卡片隐藏，也不发查询
  if (!attCustomerId) {
    box.innerHTML = '';
    if (card) card.style.display = 'none';
    return;
  }
  if (card) card.style.display = '';

  const statusParam = detailStatus ? `&status=${detailStatus}` : '';
  const custParam = attCustomerId ? `&customer_id=${attCustomerId}` : '';
  const attRes = await api.get(`/api/campaigns/${campaignId}/attempts?page=${attPage}&page_size=${attPageSize}${statusParam}${custParam}`);
  if (attRes.code !== 0) {
    box.innerHTML = '<div class="empty-state"><p>发送详情加载失败</p></div>';
    return;
  }

  const attData = attRes.data || { attempts: [], total: 0 };
  const attempts = attData.attempts || [];
  const attTotal = attData.total || 0;
  // 8 列（v2.34 需求1.2 去"公司"列，v2.40 需求2 加"客户号"列）：
  // 列宽为百分比 12% / 7% / 9% / 20% / 7% / 7% / 28% / 10%，见 style.css，
  // 超宽内容截断并用 hover 提示显示全文
  const cell = (v, cls) => `<td class="sd-cell ${cls}" title="${escHtml(v)}">${escHtml(v) || '-'}</td>`;
  // v2.33 需求3：成功行的"发送情况"是"重试多次后发送成功"这类结论，用成功色而不是报错红
  const errCell = (msg, ok) => `<td class="sd-cell sd-error${ok ? ' sd-error-ok' : ''}" title="${escHtml(msg)}">${escHtml(msg) || '-'}</td>`;

  const attemptRows = attempts.map(a => {
    const runType = runTypeText[a.run_type] || a.run_type || '';
    const result = a.status === 'sent' ? '成功' : '失败';
    return `
    <tr>
      ${cell(a.customer_no, 'sd-custno')}
      <td class="sd-cell sd-idx">第 ${a.attempt_no || '-'} 次</td>
      ${cell(a.customer_name, 'sd-name')}
      ${cell(a.customer_email, 'sd-email')}
      <td class="sd-cell sd-run" title="${escHtml(runType)}">${runTypeMap[a.run_type] || escHtml(a.run_type) || '-'}</td>
      <td class="sd-cell sd-result" title="${result}">${a.status === 'sent' ? '<span class="badge badge-success">成功</span>' : '<span class="badge badge-danger">失败</span>'}</td>
      ${errCell(a.error_message, a.status === 'sent')}
      ${cell(fmtDateTime(a.sent_at), 'sd-time')}
    </tr>`;
  }).join('');

  // 选中记录但早期数据没有逐次尝试明细：用该记录自身的最终状态兜底展示
  const legacyRow = (attLogInfo && attTotal === 0 && attLogInfo.status !== 'pending') ? `
    <tr>
      ${cell(attLogInfo.customerNo, 'sd-custno')}
      <td class="sd-cell sd-idx">第 1 次</td>
      ${cell(attLogInfo.customerName, 'sd-name')}
      ${cell(attCustomerEmail, 'sd-email')}
      <td class="sd-cell sd-run" title="早期记录未留痕触发方式">早期未留痕</td>
      <td class="sd-cell sd-result" title="${attLogInfo.status === 'sent' ? '成功' : '失败'}">${attLogInfo.status === 'sent' ? '<span class="badge badge-success">成功</span>' : '<span class="badge badge-danger">失败</span>'}</td>
      ${errCell(attLogInfo.error, attLogInfo.status === 'sent')}
      ${cell(attLogInfo.sentAt, 'sd-time')}
    </tr>` : '';

  const emptyText = attLogInfo && attLogInfo.status === 'pending'
    ? '该记录还未发送，因此没有发送详情'
    : '该邮箱没有逐次发送明细（这条记录是在"逐次留痕"功能上线前发送的）';
  const noRows = attempts.length === 0 && !legacyRow;

  const emailBadge = attCustomerId
    ? `<div style="margin-bottom:8px"><span class="badge badge-info" style="cursor:pointer;font-size:12px;padding:6px 10px" title="点击取消按邮箱筛选（再次点击该发送记录也可取消）" onclick="clearSendDetailFilter()">已筛选邮箱：${escHtml(attCustomerEmail)} ✕</span></div>`
    : '';

  box.innerHTML = `
    ${emailBadge}
    <div class="table-wrap">
      <table class="send-detail-table">
        <thead><tr>
          <th class="sd-custno">客户号</th><th class="sd-idx">第几次</th><th class="sd-name">客户名称</th><th class="sd-email">邮箱</th>
          <th class="sd-run">触发方式</th><th class="sd-result">结果</th><th class="sd-error">发送情况</th><th class="sd-time">发送时间</th>
        </tr></thead>
        <tbody>
          ${attemptRows}${legacyRow}
          ${noRows ? `<tr><td colspan="8" class="sd-blank">${emptyText}</td></tr>` : ''}
        </tbody>
      </table>
    </div>
    <div class="pag-bar">
      ${renderPagination({
        total: attTotal || (legacyRow ? 1 : 0), page: attPage, pageSize: attPageSize, unit: '条发送明细',
        gotoFn: 'gotoAttemptPage', sizeFn: 'setAttemptPageSize',
      })}
    </div>`;
}

window.gotoAttemptPage = function(p) {
  attPage = p;
  loadSendDetail(currentDetailCampaignId);
};

window.setAttemptPageSize = function(s) {
  attPageSize = parseInt(s);
  attPage = 1;
  loadSendDetail(currentDetailCampaignId);
};

async function bindCampaignsEvents() {
  const campaigns = await loadCampaignList();
  if (campaigns.some(c => c.is_running)) startPolling();

  document.getElementById('btnCreateCampaign').onclick = () => openCampaignForm(null);

  // v2.43 需求5.2：不可用的按钮已经按选中任务的状态置灰，点不到也就不需要再点击时 toast 提示；
  // 列表每 3 秒轮询刷新会重算工具栏，状态变化时灰/可用随之变化
  const runOnSelected = (fn) => {
    const c = getSelectedCampaign();
    if (c) fn(c.id);
  };
  // v2.45 需求1.1：一枚按钮两种形态——没执行过发送走 /start，发过且成功率不为 100% 走 /resume
  document.getElementById('btnCampStart').onclick = () => {
    const c = getSelectedCampaign();
    if (!c) return;
    const f = campaignFlags(c);
    if (f.sendFresh) startCampaign(c.id);
    else if (f.canResume) resumeCampaign(c.id);
  };
  document.getElementById('btnCampPause').onclick = () => runOnSelected(stopCampaign);
  document.getElementById('btnCampResendAll').onclick = () => runOnSelected(resendAllCampaign);
  document.getElementById('btnCampEdit').onclick = () => runOnSelected(editCampaign);
  document.getElementById('btnCampDelete').onclick = () => runOnSelected(deleteCampaign);
}

/* ===========================================================================
 * v2.26 创建发送任务（需求2）/ v2.27 同表单支持编辑未发送过的任务（需求2）
 *  - 任务名称必填、且至少选中 1 位客户时"创建任务"才可用（v2.29 需求 3）
 *  - 新建时默认选中当前全部有效客户（v2.29 需求 4）
 *  - 发送间隔以"分钟"设置，立即发送与定时发送各自独立、与单选项同一行
 *  - 收件人改为"选择客户"按钮 + 分页选择列表
 *  - 定期自动发送已裁撤
 *  - v2.45 需求1.2：编辑模式下任务名称只读，可改的只有模板 / SMTP 配置 / 发送方式
 *  - v2.46 需求4：该任务一封都没发出去时，收件客户在编辑模式下同样可改
 * =========================================================================== */

/** 创建任务弹窗的收件人选择结果（跨分页累积，关闭创建弹窗时重置） */
const campCust = { selected: new Set(), filterDesc: '' };
/** "选择客户"弹窗内部状态（分页 + 已应用的筛选条件） */
let cpk = null;
/** 弹窗打开时的"确认按钮可用性"同步钩子（选择客户列表在叠加层里改动选择集时要回写底层按钮） */
let campFormSync = null;
/** v2.45 需求1.2 引入：编辑已发出过邮件的任务时收件客户不可改，汇总文案要换成只读说法 */
let campCustReadOnly = false;

function resetCampCust() {
  campCust.selected = new Set();
  campCust.filterDesc = '';
  campCustReadOnly = false;
  cpk = null;
  campFormSync = null;
}

/** 筛选条件的可读描述，空条件即"全部有效客户"（v2.43 需求5.3.1：四个字段合并成一个关键字） */
function cpkFilterDesc(filters) {
  return filters.search ? `姓名 / 邮箱 / 国家 / 标签含“${filters.search}”` : '全部有效客户';
}

function renderCampCustSummary() {
  const el = document.getElementById('campCustSummary');
  if (campFormSync) campFormSync();
  if (!el) return;
  if (campCustReadOnly) {
    el.innerHTML = `收件客户共 <b>${campCust.selected.size}</b> 位 · 编辑任务时不可修改`;
    return;
  }
  el.innerHTML = campCust.selected.size === 0
    ? '<span class="cust-summary-empty">尚未选择客户</span>'
    : `已选中 <b>${campCust.selected.size}</b> 位客户 · 使用到的筛选条件：${escHtml(campCust.filterDesc)}`;
}

/**
 * 创建 / 编辑发送任务。
 * @param campaign 传入任务对象即进入编辑模式（v2.45 需求1.2：只要不在发送中即可编辑，任务名称始终只读，
 *                 可改模板 / SMTP 配置 / 发送方式；v2.46 需求4：还没发出过邮件的任务收件客户也可改）；为空即新建
 */
async function openCampaignForm(campaign) {
  const editing = !!campaign;
  const [templatesRes, smtpRes, activeIdsRes] = await Promise.all([
    api.get('/api/templates'),
    api.get('/api/smtp/configs'),
    api.get('/api/customers/active/ids'),
  ]);

  const templates = templatesRes.code === 0 ? templatesRes.data : [];
  const smtpConfigs = smtpRes.code === 0 ? smtpRes.data : [];

  if (templates.length === 0) { showToast('请先创建邮件模板', 'error'); return; }
  if (smtpConfigs.length === 0) { showToast('请先配置 SMTP', 'error'); return; }

  resetCampCust();
  // v2.47 需求2.3：默认配置置顶并加"（默认）"文字标注。后端 listAll() 已按 is_default 倒序返回，
  // 这里再显式排一次，保证下拉顺序不依赖后端排序细节（Array.sort 稳定，其余顺序仍按后端返回顺序）
  smtpConfigs.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
  const defaultSmtp = smtpConfigs.find(s => s.is_default) || smtpConfigs[0];
  const templateId = editing ? campaign.template_id : templates[0].id;
  const smtpId = editing ? campaign.smtp_config_id : defaultSmtp.id;
  const intervalMin = editing ? (campaign.interval_min || 1) : 1;
  const scheduleType = editing ? (campaign.schedule_type === 'one-time' ? 'one-time' : 'manual') : 'manual';
  const scheduleDatetime = editing ? editDatetimeValue(campaign.schedule_config) : '';
  // v2.46 需求4：编辑"一封都没发出去"的任务时，收件客户和新建时走同一套逻辑——
  // 打开弹窗先默认选中该任务已有的收件客户，点"选择客户"重新勾选（含搜索后替换）后以最新集合为准。
  // 已发出过邮件的任务保持 v2.45 口径：收件客户只读。
  const recipientsEditable = !editing || campaignFlags(campaign).canEditRecipients;
  campCustReadOnly = editing && !recipientsEditable;
  if (editing) {
    (campaign.recipientIds || []).forEach(id => campCust.selected.add(id));
    if (recipientsEditable) campCust.filterDesc = '该任务原有的收件客户';
  } else {
    // v2.29 需求 4：新建任务默认选中当前全部有效客户（可在"选择客户"列表里增减）
    (activeIdsRes.code === 0 ? activeIdsRes.data || [] : []).forEach(id => campCust.selected.add(id));
    campCust.filterDesc = cpkFilterDesc({});
  }

  const root = Modal.show({
    title: editing ? '编辑发送任务' : '创建发送任务',
    large: true,
    content: `
      <div class="form-group">
        <label>任务名称${editing ? '' : ' <b class="required-mark">*</b>'}</label>
        <input class="form-input" id="campName" value="${escHtml(editing ? campaign.name : '')}" placeholder="如：9月开发信批量" autocomplete="off"${editing ? ' disabled' : ''}>
        ${editing ? '' : '<div class="field-error" id="campNameError">任务名称为必填项</div>'}
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>选择模板</label>
          <select class="form-select" id="campTemplate">
            ${templates.map(t => `<option value="${t.id}" ${t.id === templateId ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>SMTP 配置</label>
          <select class="form-select" id="campSmtp">
            ${smtpConfigs.map(s => `<option value="${s.id}" ${s.id === smtpId ? 'selected' : ''}>${escHtml(s.name)} (${escHtml(s.host)})${s.is_default ? '（默认）' : ''}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>发送方式</label>
        <div class="sched-lines">
          <div class="sched-line">
            <label class="checkbox-label"><input type="radio" name="scheduleType" value="manual" ${scheduleType === 'manual' ? 'checked' : ''}> 立即发送</label>
            <span class="sched-fields" id="manualScheduleArea">
              <span class="sched-field">
                <label for="campIntervalManual">每份邮件发送间隔（分钟）</label>
                <input class="form-input" id="campIntervalManual" type="number" min="1" step="1" value="${intervalMin}">
              </span>
            </span>
          </div>
          <div class="sched-line">
            <label class="checkbox-label"><input type="radio" name="scheduleType" value="one-time" ${scheduleType === 'one-time' ? 'checked' : ''}> 定时发送</label>
            <span class="sched-fields" id="oneTimeScheduleArea" style="display:none">
              <span class="sched-field">
                <label for="campScheduleDatetime">发送时间</label>
                <input class="form-input date-pick" id="campScheduleDatetime" type="datetime-local" value="${escHtml(scheduleDatetime)}">
              </span>
              <span class="sched-field">
                <label for="campIntervalOneTime">每份邮件发送间隔（分钟）</label>
                <input class="form-input" id="campIntervalOneTime" type="number" min="1" step="1" value="${intervalMin}">
              </span>
            </span>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>选择客户${recipientsEditable ? ' <b class="required-mark">*</b>' : ''}</label>
        <div class="cust-pick-row">
          ${recipientsEditable ? '<button type="button" class="btn btn-sm btn-secondary" id="btnPickCustomers">👥 选择客户</button>' : ''}
          <span class="cust-summary" id="campCustSummary"></span>
        </div>
        ${recipientsEditable ? '<div class="field-error" id="campCustError">请至少选择 1 位收件客户</div>' : ''}
      </div>
    `,
    confirmText: editing ? '保存修改' : '创建任务',
    // 弹窗内元素统一从 root 取（root 在 Modal.show 返回后才赋值，onConfirm 触发时已就绪）：
    // "选择客户"列表以叠加层显示在本弹窗之上，全局 getElementById 会串到别的弹窗。
    onConfirm: async () => {
      const name = root.querySelector('#campName').value.trim();
      if (!name) { showToast('请输入任务名称', 'error'); return true; }

      const customerIds = [...campCust.selected];
      if (customerIds.length === 0) { showToast('请先选择收件客户', 'error'); return true; }

      const scheduleType = root.querySelector('input[name="scheduleType"]:checked').value;
      let scheduleConfig = {};
      let intervalEl = root.querySelector('#campIntervalManual');
      if (scheduleType === 'one-time') {
        const datetime = root.querySelector('#campScheduleDatetime').value;
        if (!datetime) { showToast('请选择发送的日期与时间', 'error'); return true; }
        intervalEl = root.querySelector('#campIntervalOneTime');
        const readable = datetime.replace('T', ' ');
        scheduleConfig = { datetime: readable.length === 16 ? `${readable}:00` : readable };
      }
      const intervalMin = parseInt(intervalEl.value, 10);
      if (!Number.isInteger(intervalMin) || intervalMin < 1) {
        showToast('每份邮件发送间隔请设置为不少于 1 分钟', 'error');
        return true;
      }

      const data = {
        name,
        template_id: parseInt(root.querySelector('#campTemplate').value),
        smtp_config_id: parseInt(root.querySelector('#campSmtp').value),
        interval_min: intervalMin,
        customer_ids: customerIds,
        custom_vars: {},
        schedule_type: scheduleType,
        schedule_config: scheduleConfig,
      };

      const r = editing
        ? await api.put(`/api/campaigns/${campaign.id}/edit`, data)
        : await api.post('/api/campaigns', data);
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      if (r.code !== 0) return true;
      resetCampCust();
      loadCampaignList();
      // 需求1.2"编辑后的任务内容立即生效"：已打开的详情面板同步换成新的模板与发送参数
      if (editing) refreshOpenDetail();
    },
  });

  const nameInput = root.querySelector('#campName');
  const confirmBtn = root.querySelector('.m-btn-confirm');
  const nameError = root.querySelector('#campNameError');
  const custError = root.querySelector('#campCustError');
  // v2.29 需求3：任务名称非空（全空格也算空）且至少选中 1 位收件客户，"创建任务"才可用
  // v2.45 需求1.2：编辑态两项都只读且必然有值，相应校验提示也不再渲染
  const syncConfirmState = () => {
    const nameEmpty = !nameInput.value.trim();
    const noCustomer = campCust.selected.size === 0;
    confirmBtn.disabled = nameEmpty || noCustomer;
    if (nameError) nameError.style.display = nameEmpty && nameInput.value.length > 0 ? 'block' : 'none';
    if (custError) custError.style.display = noCustomer ? 'block' : 'none';
  };
  campFormSync = syncConfirmState;
  nameInput.oninput = syncConfirmState;
  renderCampCustSummary();

  const syncScheduleAreas = () => {
    const value = root.querySelector('input[name="scheduleType"]:checked').value;
    root.querySelector('#manualScheduleArea').style.display = value === 'manual' ? '' : 'none';
    root.querySelector('#oneTimeScheduleArea').style.display = value === 'one-time' ? '' : 'none';
  };
  root.querySelectorAll('input[name="scheduleType"]').forEach(radio => {
    radio.onchange = syncScheduleAreas;
  });
  syncScheduleAreas();

  // 需求5（v2.27）：发送时间输入框点击任意位置即弹出日期+时间选择器
  const datetimeInput = root.querySelector('#campScheduleDatetime');
  datetimeInput.onclick = () => {
    try { datetimeInput.showPicker(); } catch (e) { datetimeInput.focus(); }
  };

  const pickBtn = root.querySelector('#btnPickCustomers');
  if (pickBtn) pickBtn.onclick = openCustomerPicker;
}

/** schedule_config 里的 "yyyy-MM-dd HH:mm:ss" 转成 datetime-local 需要的 "yyyy-MM-ddTHH:mm" */
function editDatetimeValue(scheduleConfigJson) {
  if (!scheduleConfigJson) return '';
  try {
    const config = typeof scheduleConfigJson === 'string' ? JSON.parse(scheduleConfigJson) : scheduleConfigJson;
    const value = String(config.datetime || config.scheduled_at || config.time || '');
    if (value.length < 16) return '';
    return `${value.substring(0, 10)}T${value.substring(11, 16)}`;
  } catch (e) {
    return '';
  }
}

/**
 * v2.45 需求1.2：编辑任务入口。只要任务不在发送中就能编辑，已发出过邮件的也可以；
 * 可改的是模板 / SMTP 配置 / 发送方式，任务名称在弹窗里只读；
 * v2.46 需求4：还没发出过任何一封邮件的任务，收件客户也可以在这同一个弹窗里改。
 */
window.editCampaign = async function(id) {
  const campaign = await findCampaignById(id);
  if (!campaign) return;
  if (campaign.is_running || campaign.status === 'running') {
    showToast('任务正在发送中，请先暂停后再编辑', 'error');
    return;
  }
  const res = await api.get(`/api/campaigns/${id}/logs?page=1&page_size=${Math.max(1, campaign.total || 0)}`);
  const logs = res.code === 0 ? (res.data.logs || []) : [];
  campaign.recipientIds = logs.map(l => l.customer_id).filter(Boolean);
  openCampaignForm(campaign);
};

/* ---------------------------- 选择客户分页列表 ---------------------------- */

/** v2.43 需求5.3.1：四个字段合并成一个关键字，后端按"姓名/邮箱/国家/标签"或匹配 */
function cpkQuery() {
  const p = new URLSearchParams();
  if (cpk.filters.search) p.set('search', cpk.filters.search);
  return p.toString();
}

/** 弹窗内元素按 cpk.box 作用域查找：叠加弹窗与底层创建弹窗同时存在，全局查找会串台 */
function cpkEl(id) {
  return cpk && cpk.box ? cpk.box.querySelector('#' + id) : null;
}

function cpkBoxes() {
  return cpk && cpk.box ? [...cpk.box.querySelectorAll('.cpk-check')] : [];
}

function openCustomerPicker() {
  if (!cpk) cpk = { page: 1, pageSize: 10, total: 0, filters: { search: '' }, searchMode: false, pending: new Set() };
  const f = cpk.filters;

  cpk.box = Modal.show({
    title: '选择客户',
    wide: true,
    stacked: true,
    confirmText: '确定',
    content: `
      <!-- v2.43 需求5.3.1/5.3.2：关键字搜索框与查询/重置/全部选中/取消全部同在一行 -->
      <div class="picker-toolbar">
        <input class="form-input cpk-keyword" id="cpkKw" value="${escHtml(f.search || '')}"
               placeholder="搜索姓名 / 邮箱 / 国家 / 标签（回车即查）">
        <button type="button" class="btn btn-sm btn-primary" id="cpkSearch">查询</button>
        <button type="button" class="btn btn-sm btn-secondary" id="cpkReset">重置</button>
        <button type="button" class="btn btn-sm btn-secondary" id="cpkPickAll">全部选中筛选结果</button>
        <button type="button" class="btn btn-sm btn-secondary" id="cpkPickNone">取消全部筛选结果</button>
        <span class="cust-summary" id="cpkSummary"></span>
      </div>
      <div class="table-wrap">
        <table class="picker-table">
          <thead><tr>
            <th style="width:40px"><input type="checkbox" id="cpkCheckAll" title="全选/取消本页客户"></th>
            <th>客户号</th><th>客户姓名</th><th>邮箱</th><th>国家</th><th>标签</th>
          </tr></thead>
          <tbody id="cpkBody"><tr><td colspan="6" style="text-align:center;color:var(--text-secondary)">加载中...</td></tr></tbody>
        </table>
      </div>
      <div id="cpkPag" class="pag-bar"></div>
    `,
    onConfirm: () => {
      // v2.47 需求1.2：搜索模式下勾选的是"搜索结果里选中的记录"，点确定才把它整体替换进收件客户列表；
      // 非搜索模式（无关键字）沿用 v2.43 之前的实时编辑语义，不做替换
      if (cpk.searchMode) campCust.selected = new Set(cpk.pending);
      campCust.filterDesc = cpkFilterDesc(cpk.filters);
      renderCampCustSummary();
    },
  });

  cpkEl('cpkSearch').onclick = () => { cpkApplySearch(); };
  cpkEl('cpkReset').onclick = () => {
    cpkEl('cpkKw').value = '';
    cpk.filters = { search: '' };
    // 重置即退出搜索结果模式：模式下尚未提交的勾选作废，勾选重新直接作用于当前选中集合
    cpk.searchMode = false;
    cpk.pending = new Set();
    cpk.page = 1;
    loadCpkPage();
  };
  cpkEl('cpkKw').onkeydown = (e) => {
    // v2.47 需求1.1：回车等同于点"查询"
    if (e.key === 'Enter') cpkEl('cpkSearch').click();
  };

  cpkEl('cpkPickAll').onclick = () => applyCpkMatchedSelection(true);
  cpkEl('cpkPickNone').onclick = () => applyCpkMatchedSelection(false);
  cpkEl('cpkCheckAll').onchange = function() {
    const checked = this.checked;
    cpkBoxes().forEach(cb => { cb.checked = checked; });
    syncCpkSelectionFromCheckboxes();
  };

  // 打开时若还留着上次的关键字，直接按搜索结果模式重建勾选基线，避免"列表是子集但勾选走实时语义"的割裂
  if (f.search) cpkApplySearch();
  else loadCpkPage();
}

/** v2.47 需求1.2：勾选状态写入的目标集合——搜索模式下是待提交的 pending，否则是当前选中集合 */
function cpkEditSet() {
  return cpk.searchMode ? cpk.pending : campCust.selected;
}

/** 该客户在列表里是否显示为已勾选 */
function cpkIsChecked(id) {
  return cpkEditSet().has(id);
}

/**
 * 执行关键字查询。关键字非空且命中集合取到时进入"搜索结果模式"：
 * pending 先以"搜索结果 ∩ 当前已选"播种（对应需求1.2 的"进入界面后默认勾选已选中的客户"），
 * 之后所有勾选只改 pending，点"确定"才整体替换 campCust.selected。
 */
async function cpkApplySearch() {
  const kw = cpkEl('cpkKw') ? cpkEl('cpkKw').value.trim() : '';
  cpk.filters = { search: kw };
  cpk.page = 1;
  cpk.searchMode = false;
  cpk.pending = new Set();
  if (kw) {
    const res = await api.get(`/api/customers/active/ids?${cpkQuery()}`);
    // 命中集合取不到时退回实时编辑语义，至少保证列表和勾选可用，不会把已选客户静默清空
    if (res.code === 0) {
      const hits = new Set(res.data || []);
      cpk.searchMode = true;
      campCust.selected.forEach(id => { if (hits.has(id)) cpk.pending.add(id); });
    }
  }
  await loadCpkPage();
}

/** 选择 / 取消当前筛选条件下命中的全部有效客户（跨页，用后端返回的命中 ID 集合） */
async function applyCpkMatchedSelection(select) {
  const res = await api.get(`/api/customers/active/ids?${cpkQuery()}`);
  if (res.code !== 0) { showToast('客户列表加载失败', 'error'); return; }
  const ids = res.data || [];
  if (ids.length === 0) { showToast('当前筛选条件没有命中的有效客户', 'error'); return; }
  const set = cpkEditSet();
  ids.forEach(id => { select ? set.add(id) : set.delete(id); });
  cpkBoxes().forEach(cb => { cb.checked = select; });
  cpkEl('cpkCheckAll').checked = select;
  renderCpkSummary();
}

async function loadCpkPage() {
  const body = cpkEl('cpkBody');
  if (!body) return;
  const res = await api.get(`/api/customers/active?${cpkQuery()}&page=${cpk.page}&page_size=${cpk.pageSize}`);
  if (res.code !== 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger)">客户列表加载失败</td></tr>`;
    return;
  }
  const customers = res.data.customers || [];
  cpk.total = res.data.total || 0;

  body.innerHTML = customers.length > 0 ? customers.map(c => `
    <tr class="clickable-row" data-id="${c.id}">
      <td><input type="checkbox" class="cpk-check" value="${c.id}" ${cpkIsChecked(c.id) ? 'checked' : ''}></td>
      <td>${escHtml(c.customer_no) || '-'}</td>
      <td>${escHtml(c.name)}</td>
      <td>${escHtml(c.email)}</td>
      <td>${escHtml(c.country) || '-'}</td>
      <td>${c.tags ? `<span class="badge badge-info">${escHtml(c.tags)}</span>` : '-'}</td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="empty-state"><p>没有符合筛选条件的有效客户</p></td></tr>';

  cpkEl('cpkPag').innerHTML = renderPagination({
    total: cpk.total, page: cpk.page, pageSize: cpk.pageSize, unit: '位有效客户',
    gotoFn: 'cpkGoto', sizeFn: 'cpkSetSize',
  });

  body.querySelectorAll('.cpk-check').forEach(cb => {
    cb.onchange = (e) => { e.stopPropagation(); syncCpkSelectionFromCheckboxes(); };
  });
  body.querySelectorAll('.clickable-row').forEach(tr => {
    tr.onclick = (e) => {
      if (e.target.type === 'checkbox') return;
      const cb = tr.querySelector('.cpk-check');
      cb.checked = !cb.checked;
      syncCpkSelectionFromCheckboxes();
    };
  });
  const boxes = cpkBoxes();
  cpkEl('cpkCheckAll').checked = boxes.length > 0 && boxes.every(cb => cb.checked);
  renderCpkSummary();
}

/**
 * 把本页复选框状态同步进当前勾选目标集合（其他页的勾选保持不变）。
 * 【自 v2.47 需求1.2 起，v2.43 需求5.3.3 的"搜索后第一次勾选先清空原有集合"（replaceOnCheck）已作废】：
 * 改为搜索结果模式——勾选落在 cpk.pending 上，点"确定"时才用 pending 整体替换收件客户集合，
 * 取消/关闭弹窗则全部作废，因此不再需要在第一次勾选时破坏性清空。
 */
function syncCpkSelectionFromCheckboxes() {
  const set = cpkEditSet();
  cpkBoxes().forEach(cb => {
    const id = parseInt(cb.value, 10);
    if (cb.checked) set.add(id);
    else set.delete(id);
  });
  const boxes = cpkBoxes();
  cpkEl('cpkCheckAll').checked = boxes.length > 0 && boxes.every(cb => cb.checked);
  renderCpkSummary();
}

function renderCpkSummary() {
  // 选择集在叠加层里增减时，底层"创建任务"按钮的可用性要同步（v2.29 需求3）
  if (campFormSync) campFormSync();
  const el = cpkEl('cpkSummary');
  if (!el) return;
  // v2.47 需求1.2：搜索模式下计数显示的是尚未提交的勾选结果，并点明"确定"后才替换
  const shown = cpk.searchMode ? cpk.pending.size : campCust.selected.size;
  el.innerHTML = `已选中 <b>${shown}</b> 位客户`
    + (cpk.searchMode ? `（搜索结果内勾选，点"确定"后替换当前选中的 ${campCust.selected.size} 位）` : '')
    + ` · 筛选条件：${escHtml(cpkFilterDesc(cpk.filters))} · 命中 ${cpk.total} 位有效客户`;
  const allBtn = cpkEl('cpkPickAll');
  if (allBtn) allBtn.textContent = `全部选中筛选结果 (${cpk.total})`;
}

window.cpkGoto = function(p) {
  const totalPages = Math.max(1, Math.ceil(cpk.total / cpk.pageSize));
  cpk.page = Math.min(Math.max(1, p), totalPages);
  loadCpkPage();
};

window.cpkSetSize = function(s) {
  cpk.pageSize = parseInt(s);
  cpk.page = 1;
  loadCpkPage();
};
