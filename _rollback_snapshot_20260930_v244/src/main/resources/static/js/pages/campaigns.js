function CampaignsPage() {
  return `
    <div class="page-header">
      <h1>发送任务</h1>
      <button class="btn btn-primary" id="btnCreateCampaign">+ 创建任务</button>
    </div>
    <!-- v2.42 需求5：原先散落在每行"操作"列里的按钮收敛成与客户管理一致的工具栏，
         单击选中某条任务后，这五个按钮才按该任务的实态放开
         v2.43 需求 1.4：工具栏的"编辑"按钮撤掉，编辑改由双击任务行进入 -->
    <div class="search-bar campaigns-bar">
      <button class="btn btn-sm btn-success" id="btnCampStart" disabled>发送</button>
      <button class="btn btn-sm btn-danger" id="btnCampPause" disabled>暂停</button>
      <button class="btn btn-sm btn-warning" id="btnCampResume" disabled title="重新发送该任务当前批次中所有未成功的邮件">继续发送</button>
      <button class="btn btn-sm btn-primary" id="btnCampResendAll" disabled>全部重发</button>
      <button class="btn btn-sm btn-danger" id="btnCampDelete" disabled>删除</button>
      <div class="sel-inline" id="campSelectionBanner">单击选中一条任务后可对其操作并即时显示其发送记录，双击编辑该任务</div>
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
// v2.42 需求5：工具栏只操作"当前选中的那一条任务"（单击选中，与邮件模板一致）
let selectedCampaignId = null;
// 当前页的任务行数据，工具栏按它推导各按钮是否可用
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
 * 一条任务当前能做哪些操作——工具栏五个按钮的唯一口径。
 * 与 v2.30 的行内按钮判定同源，"编辑"不再是工具栏按钮（v2.43 需求 1.4），
 * 因此这里也没有 canEdit 了；能否编辑由 editCampaign 自己按"是否正在发送"判断。
 */
function campaignFlags(c) {
  const running = !!c.is_running || c.status === 'running';
  const everSent = (c.sent + c.failed) > 0;
  const display = c.display_status || c.status;
  return {
    display,
    uncompleted: display === 'uncompleted',
    canStart: display === 'pending' && !running,
    canPause: running,
    canResume: c.total > 0 && everSent && !running && (c.total - c.sent) > 0,
    canResendAll: c.total > 0 && !running && (c.status === 'completed' || c.status === 'cancelled'),
    canDelete: !running,
  };
}

async function loadCampaignList() {
  const res = await api.get(`/api/campaigns?page=${campaignPage}&page_size=${campaignPageSize}`);
  const tbody = document.getElementById('campaignList');
  if (!tbody) return [];
  const campaigns = res.code === 0 ? (res.data.campaigns || res.data) : [];
  const total = res.code === 0 ? (res.data.total || campaigns.length) : 0;
  campaignTotal = total;
  campaignRows = campaigns;

  if (campaigns.length > 0) {
    tbody.innerHTML = campaigns.map(c => {
      const pct = c.total > 0 ? Math.round((c.sent + c.failed) / c.total * 100) : 0;
      const f = campaignFlags(c);
      return `<tr class="clickable-row${c.id === selectedCampaignId ? ' row-selected' : ''}" data-cid="${c.id}" title="单击选中该任务并即时显示其发送记录，双击编辑该任务" onclick="rowSelectCampaign(event, ${c.id})" ondblclick="rowEditCampaign(event, ${c.id})">
        <td>${c.name}</td>
        <td>${c.template_name || '-'}</td>
        <td>${c.smtp_name || '-'}</td>
        <td>${campaignStatusBadge(c)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="progress-bar" style="width:100px;margin:0"><div class="progress-fill" style="width:${pct}%"></div></div>
            <span style="font-size:12px">${c.sent + c.failed}/${c.total}${f.uncompleted
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
 * v2.42 需求5：单击某条任务即选中它（点行内按钮/链接时不抢选中），工具栏随之刷新。
 * v2.43 需求 1.1：选中同一次点击还要立刻在下方"发送详细列表"里显示该任务的发送记录。
 * 高亮/工具栏是同步的、立即生效；发送记录要走两次接口，按 v2.38 发送记录行的成熟做法延后 260ms，
 * 双击进入编辑时（rowEditCampaign）取消它，避免一次双击白拉一遍详情。
 */
let campDetailTimer = null;

window.rowSelectCampaign = function(event, id) {
  if (event && event.target.closest('button, a, select, input')) return;
  selectedCampaignId = id;
  document.querySelectorAll('#campaignList tr[data-cid]').forEach(tr => {
    tr.classList.toggle('row-selected', parseInt(tr.dataset.cid, 10) === id);
  });
  updateCampaignToolbar();
  clearTimeout(campDetailTimer);
  campDetailTimer = setTimeout(() => viewCampaignDetail(id), 260);
};

/** v2.43 需求 1.4：编辑不再有工具栏按钮，双击任务行即进入编辑（同 v2.42 客户管理的双击编辑做法） */
window.rowEditCampaign = function(event, id) {
  if (event && event.target.closest('button, a, select, input')) return;
  clearTimeout(campDetailTimer);
  selectedCampaignId = id;
  updateCampaignToolbar();
  editCampaign(id);
};

/**
 * 工具栏按钮只反映"当前选中的那一条任务"的实态；
 * 选中任务被删除、翻页后不在本页数据里，一律回到全部置灰。
 */
function updateCampaignToolbar() {
  const banner = document.getElementById('campSelectionBanner');
  if (!banner) return;
  const c = campaignRows.find(x => x.id === selectedCampaignId) || null;
  if (!c) selectedCampaignId = null;
  const f = c ? campaignFlags(c) : null;
  const enable = (id, on, tip) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !on;
    if (tip !== undefined) btn.title = on ? tip : '';
  };
  enable('btnCampStart', f && f.canStart, '立即发送该任务的待发送记录');
  enable('btnCampPause', f && f.canPause, '暂停发送，未发出的邮件保持待发送');
  enable('btnCampResume', f && f.canResume, '重新发送当前批次中所有未成功的邮件，已发送成功的与历史批次都不重发');
  enable('btnCampResendAll', f && f.canResendAll, '重新发送给全部收件人，含已发送成功的');
  enable('btnCampDelete', f && f.canDelete, '删除该发送任务');
  if (!c) {
    banner.innerHTML = '';
    banner.title = '单击选中一条任务后可对其操作并即时显示其发送记录，双击编辑该任务';
    return;
  }
  banner.innerHTML = `<span class="banner-strong">✓ 已选中「${escHtml(c.name)}」</span>`
    + campaignStatusBadge(c)
    + `<span class="banner-conds" title="已发出 ${c.sent + c.failed}/${c.total}，其中失败 ${c.failed}">已发出 ${c.sent + c.failed}/${c.total}</span>`;
  banner.title = `已选中任务「${c.name}」：已发出 ${c.sent + c.failed}/${c.total}，其中失败 ${c.failed}`;
}

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

/** v2.42 需求5：工具栏上的"暂停"即原来的"停止"（同一个 POST /cancel，任务转为已暂停、可继续发送） */
window.stopCampaign = function(id) {
  Modal.show({
    title: '确认暂停',
    content: '<p>确定要暂停此发送任务吗？已发送的邮件不会受影响，未发送的邮件保持待发送状态，之后可以"继续发送"。</p>',
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
    content: '<p>将重新发送该任务<strong>当前批次</strong>中所有<strong>未成功发送</strong>（失败/待发送）的邮件，本次任务中已发送成功的邮件<strong>不会重复发送</strong>；编辑任务时留下的历史批次记录同样不受影响。</p>',
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

/** 详情视图打开时按最新任务状态就地刷新（不抢滚动位置） */
function refreshOpenDetail() {
  if (currentDetailCampaignId) loadLogPage(currentDetailCampaignId, { keepScroll: true });
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
// v2.44 需求 2："发送记录"卡片改为两个页签——detail=逐封明细（默认，与上版界面一致）、
// batches=批次概览（一个批次一行，看每次编辑收件人名单后那一批的规模与结果）。
let logTab = 'detail';
// 页签一的批次筛选：''=全部批次，'2'=只看第 2 批（页签二点某批次行跳回明细时写入）
let logBatchFilter = '';

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
  // v2.44 需求 2：换任务就回到"明细页签 + 全部批次"，避免带着上一个任务的批次筛选
  logTab = 'detail';
  logBatchFilter = '';
  loadLogPage(id, {}, campaign);
};

/** 页签切换：明细 / 批次概览（两页签共用同一张卡片，切换只重绘这张卡片） */
window.setLogTab = function(tab) {
  if (logTab === tab) return;
  logTab = tab;
  // 页签二只看规模，不参与邮箱点选；切回来时也不保留上一条点选记录
  attCustomerId = null;
  attCustomerEmail = '';
  attLogInfo = null;
  loadLogPage(currentDetailCampaignId, { keepScroll: true });
};

/**
 * 按批次筛选页签一：batchNo 为 '' 表示全部批次。
 * 页签二点某一行、或页签一自己换下拉框都走这里，两处的"看这一批发了什么"是同一份口径。
 */
window.setLogBatchFilter = function(batchNo) {
  logBatchFilter = batchNo === '' || batchNo == null ? '' : String(batchNo);
  logTab = 'detail';
  logPage = 1;
  attCustomerId = null;
  attCustomerEmail = '';
  attLogInfo = null;
  loadLogPage(currentDetailCampaignId, { keepScroll: true });
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
  loadLogPage(currentDetailCampaignId, { keepScroll: true });
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
    batchNo: tr.dataset.logBatch || 1,
  };
  attPage = 1;
  loadSendDetail(currentDetailCampaignId);
  const h = document.getElementById('campaignSendDetail');
  if (h) h.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
 * 编辑入口改为整行双击 → "客户详情"窗口（见 rowShowLogCustomer）。
 */
function logCustomerNameCell(l) {
  return escHtml(l.customer_name) || '-';
}

/**
 * v2.38 需求3.1：双击发送记录整行打开该客户的详情窗口。
 * v2.43 需求 1.3：与客户管理列表的双击一样<strong>直接进入编辑态</strong>（同一个窗口、同一套样式，
 * 只是少了"先只读再点编辑"这一步）；仍须先取消待执行的单击筛选，否则一次双击会连带把"发送详情"筛成该邮箱。
 */
window.rowShowLogCustomer = function(event) {
  clearTimeout(logRowFilterTimer);
  const cid = parseInt(event.currentTarget.dataset.cust, 10);
  if (!cid) return;
  window.showCustomerDetail(cid, () => loadLogPage(currentDetailCampaignId, { keepScroll: true }), { edit: true });
};

/**
 * v2.43 需求 1.2：批次标记。当前批次（batch_no = 该任务最大批次）只写"第N批"，
 * 比它更早的批次是编辑任务前留下的收件人名单，额外打上"历史批次"徽章。
 * <p>currentBatch 缺失（旧数据/旧接口）时按同批次处理，不会把正常记录误标成历史。
 * <p>徽章额外带 batch-badge 类：默认徽章允许折行，两张列表的批次列宽放不下"第N批·历史"时会
 * 折成两行、把行高撑到 120px 以上，破坏了与相邻列表的行高等高约定，所以这里强制不换行并收紧内边距。
 */
function batchMark(batchNo, currentBatch) {
  const n = Number(batchNo) || 1;
  const cur = Number(currentBatch) || 1;
  return n >= cur
    ? `<span class="batch-now">第${n}批</span>`
    : `<span class="badge badge-muted batch-badge" title="第 ${n} 批 · 编辑任务前留下的历史批次，其发送状态与发送时间不再变动">第${n}批·历史</span>`;
}

async function loadLogPage(campaignId, opts, campaign) {
  if (!campaign) {
    campaign = await findCampaignById(campaignId);
    if (!campaign) return;
  }

  // v2.44 需求 2：两个页签各自要的数据不同——明细要日志，概览要批次汇总
  const batchTab = logTab === 'batches';
  const statusParam = detailStatus ? `&status=${detailStatus}` : '';
  const batchParam = !batchTab && logBatchFilter !== '' ? `&batch_no=${encodeURIComponent(logBatchFilter)}` : '';

  let logs = [], logTotal = 0, currentBatch = campaign.current_batch || 1, batches = [];
  if (batchTab) {
    const res = await api.get(`/api/campaigns/${campaignId}/batches`);
    const data = res.code === 0 ? res.data : {};
    batches = data.batches || [];
    currentBatch = data.current_batch || currentBatch;
  } else {
    const logsRes = await api.get(`/api/campaigns/${campaignId}/logs?page=${logPage}&page_size=${logPageSize}${statusParam}${batchParam}`);
    const logsData = logsRes.code === 0 ? logsRes.data : { logs: [], total: 0 };
    logs = logsData.logs || [];
    logTotal = logsData.total || logs.length;
    // v2.43 需求 1.2：后端一次带回该任务当前批次号，早于它的记录在列表里标成历史批次
    currentBatch = logsData.current_batch || currentBatch;
  }
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
      <div class="modal-tabs">
        <button class="modal-tab${batchTab ? '' : ' active'}" onclick="setLogTab('detail')"
                title="逐封查看本任务的发送记录，可按批次与状态筛选">发送记录明细</button>
        <button class="modal-tab${batchTab ? ' active' : ''}" onclick="setLogTab('batches')"
                title="一个批次一行：每次编辑收件人名单后那一批的规模、结果与名单变动，点击某行回到明细页签只看这一批">批次概览</button>
      </div>
      ${batchTab ? batchOverviewHtml(batches, currentBatch) : logDetailTabHtml(logs, logTotal, currentBatch, campaign)}
    </div>
    <div class="card">
      <h3 style="margin-bottom:6px">发送详情</h3>
      <div id="campaignSendDetail"><div style="text-align:center;color:var(--text-secondary);padding:16px">加载中...</div></div>
    </div>
  `;

  if (!batchTab) loadSendDetail(campaignId);
  if (!opts || !opts.keepScroll) detail.scrollIntoView({ behavior: 'smooth' });
}

/**
 * v2.44 需求 2 页签一：逐封明细（原"发送记录"表格），顶部加一支批次筛选下拉。
 * 下拉里的批次档位直接由"当前批次号"推出来（第 currentBatch 批 ~ 第 1 批），
 * 因为批次表就是按这个顺序一路开下来的，不必为拼选项再发一次 /batches。
 */
function logDetailTabHtml(logs, logTotal, currentBatch, campaign) {
  const batchCount = Math.max(currentBatch || 1, campaign.batch_count || 0, 1);
  let batchOptions = '<option value="">全部批次</option>';
  for (let n = batchCount; n >= 1; n--) {
    batchOptions += `<option value="${n}"${String(n) === logBatchFilter ? ' selected' : ''}>第${n}批${n >= (currentBatch || 1) ? '（当前）' : ''}</option>`;
  }
  return `
      <div class="log-tab-bar">
        <label class="log-batch-filter" for="logBatchFilterSelect">批次筛选
          <select class="form-input" id="logBatchFilterSelect" onchange="setLogBatchFilter(this.value)">${batchOptions}</select>
        </label>
        <span class="log-batch-tip">${logBatchFilter === '' ? '不选批次即显示该任务全部批次的记录' : `当前只显示第 ${logBatchFilter} 批的记录`}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>客户号</th><th>客户名称</th><th>邮箱</th><th>发送次数</th><th>状态</th><th>批次</th><th>发送情况</th><th>发送时间</th></tr></thead>
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
              return `<tr class="clickable-row" data-cust="${l.customer_id}" data-custno="${escHtml(l.customer_no)}" data-email="${escHtml(l.customer_email)}" data-log-status="${escHtml(l.status)}" data-log-batch="${l.batch_no || 1}" data-log-sent-at="${escHtml(sentAt)}" data-log-error="${escHtml(l.error_message)}"${activeRow ? ' style="background:#EFF6FF"' : ''} title="${countHint}；双击可编辑该客户" onclick="rowFilterSendDetail(event)" ondblclick="rowShowLogCustomer(event)"><td>${escHtml(l.customer_no) || '-'}</td><td>${logCustomerNameCell(l)}</td><td>${escHtml(l.customer_email) || '-'}</td><td><strong>${countText}</strong></td><td>${logStatus}</td><td>${batchMark(l.batch_no, currentBatch)}</td><td style="font-size:12px;color:${errColor}">${escHtml(l.error_message) || '-'}</td><td style="font-size:13px">${sentAt}</td></tr>`;
            }).join('') : `<tr><td colspan="8" style="text-align:center;color:var(--text-secondary)">${logBatchFilter === '' ? '暂无记录' : `第 ${logBatchFilter} 批暂无记录`}</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="pag-bar">
        ${renderPagination({
          total: logTotal, page: logPage, pageSize: logPageSize, unit: '条记录',
          gotoFn: 'gotoCampaignLogPage', sizeFn: 'setCampaignLogPageSize',
        })}
      </div>`;
}

/**
 * v2.44 需求 2 页签二：批次概览。一行一个批次，数字全部来自后端 campaign_batches 的聚合列，
 * 点某一行即跳回页签一并把明细筛选锁定到该批次，所以"这一批到底发给了谁"不需要再二次找入口。
 * <p>批次数量级很小（一个任务通常只有几批），因此这里不分页。
 */
function batchOverviewHtml(batches) {
  const num = v => (v == null ? '-' : v);
  // 名单变动：第 1 批是建任务时的初始收件人，之后每批是"新增 X、移出 Y"；
  // 上版（v2.44 之前）遗留的老批次没有这两个数，按需求显示"-"而不是编造数字。
  const change = b => (b.added_count == null ? '-'
    : `新增 ${b.added_count} 人${(b.removed_count || 0) > 0 ? ` · 移出 ${b.removed_count} 人` : ''}`);
  return `
      <div class="log-tab-bar">
        <span class="log-batch-tip">共 ${batches.length} 批 · 点击任一批次行，明细页签只显示这一批的逐封记录</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>批次</th><th>批次状态</th><th>收件人数</th><th>已发送</th><th>发送失败</th><th>待发送</th><th>名单变动</th><th>开批时间</th><th>最后发送时间</th><th>批次说明</th></tr></thead>
          <tbody>
            ${batches.length > 0 ? batches.map(b => `<tr class="clickable-row" title="点击只看第 ${b.batch_no} 批的发送明细"
                onclick="setLogBatchFilter('${b.batch_no}')">
              <td>${batchMark(b.batch_no, b.current_batch || (b.is_current ? b.batch_no : b.batch_no + 1))}</td>
              <td>${batchStatusBadge(b.batch_status)}</td>
              <td><strong>${num(b.recipient_count)}</strong></td>
              <td style="color:var(--success)">${num(b.sent_count)}</td>
              <td style="color:var(--danger)">${num(b.failed_count)}</td>
              <td class="statbar-pending">${num(b.pending_count)}</td>
              <td style="font-size:13px">${change(b)}</td>
              <td style="font-size:13px">${fmtDateTime(b.opened_at)}</td>
              <td style="font-size:13px">${fmtDateTime(b.finished_at || b.started_at)}</td>
              <td style="font-size:13px;color:var(--text-secondary)">${escHtml(b.note) || '-'}</td>
            </tr>`).join('') : '<tr><td colspan="10" style="text-align:center;color:var(--text-secondary)">暂无批次记录</td></tr>'}
          </tbody>
        </table>
      </div>`;
}

/**
 * 批次状态徽章：状态由后端从该批的收件人数与三种记录数派生（empty/pending/partial/completed/uncompleted）。
 * 与任务级五态是两回事——任务级看整个任务，这里只看这一批。
 */
function batchStatusBadge(status) {
  const map = {
    pending: ['badge-info', '待发送'],
    partial: ['badge-info', '发送中'],
    completed: ['badge-success', '已完成'],
    uncompleted: ['badge-danger', '有失败'],
    empty: ['badge-muted', '已清空'],
  };
  const m = map[status] || ['badge-muted', status || '-'];
  return `<span class="badge ${m[0]}">${m[1]}</span>`;
}

/**
 * 渲染任务详情中的"发送详情"（v2.26 由"历史发送情况"更名）：
 * 逐次尝试明细 + 发送当时的客户/模板/SMTP 数据快照，后续资料变更不影响这里的历史呈现。
 */
async function loadSendDetail(campaignId) {
  const box = document.getElementById('campaignSendDetail');
  if (!box || !campaignId) return;

  // v2.32 需求4：默认不查询也不显示内容，只有点击某条"发送记录"后才呈现该记录的发送详情
  if (!attCustomerId) {
    box.innerHTML = '<div class="sd-placeholder">点击上方「发送记录」中的某一条记录，这里只显示该条记录的发送详情</div>';
    return;
  }

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
  // v2.43 需求 1.2：逐次留痕按它所属的发送日志带出批次，历史批次的尝试同样要标出来
  const currentBatch = attData.current_batch || 1;
  // 9 列（v2.34 需求1.2 去"公司"列，v2.40 需求2 加"客户号"列，v2.43 需求 1.2 加"批次"列）：
  // 列宽为百分比，见 style.css 的 .send-detail-table，合计 100%，
  // 超宽内容截断并用 hover 提示显示全文
  const cell = (v, cls) => `<td class="sd-cell ${cls}" title="${escHtml(v)}">${escHtml(v) || '-'}</td>`;
  const batchCell = (b) => `<td class="sd-cell sd-batch">${batchMark(b, currentBatch)}</td>`;
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
      ${batchCell(a.batch_no)}
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
      ${batchCell(attLogInfo.batchNo)}
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
          <th class="sd-run">触发方式</th><th class="sd-result">结果</th><th class="sd-batch">批次</th><th class="sd-error">发送情况</th><th class="sd-time">发送时间</th>
        </tr></thead>
        <tbody>
          ${attemptRows}${legacyRow}
          ${noRows ? `<tr><td colspan="9" class="sd-blank">${emptyText}</td></tr>` : ''}
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
  // 每次进入"发送任务"界面都是重新渲染，选中态不应跨界面残留
  clearTimeout(campDetailTimer);
  selectedCampaignId = null;
  const campaigns = await loadCampaignList();
  if (campaigns.some(c => c.is_running)) startPolling();

  document.getElementById('btnCreateCampaign').onclick = () => openCampaignForm(null);

  const selectedId = () => selectedCampaignId;
  document.getElementById('btnCampStart').onclick = () => startCampaign(selectedId());
  document.getElementById('btnCampPause').onclick = () => stopCampaign(selectedId());
  document.getElementById('btnCampResume').onclick = () => resumeCampaign(selectedId());
  document.getElementById('btnCampResendAll').onclick = () => resendAllCampaign(selectedId());
  document.getElementById('btnCampDelete').onclick = () => deleteCampaign(selectedId());
}

/* ===========================================================================
 * v2.26 创建发送任务（需求2）/ v2.42 同表单支持编辑任何不在发送中的任务（需求6）
 *  - 任务名称必填、且至少选中 1 位客户时"创建任务"才可用（v2.29 需求 3）
 *  - 新建时默认选中当前全部有效客户（v2.29 需求 4）
 *  - 发送间隔以"分钟"设置，立即发送与定时发送各自独立、与单选项同一行
 *  - 收件人改为"选择客户"按钮 + 分页选择列表
 *  - 定期自动发送已裁撤
 * =========================================================================== */

/** 创建任务弹窗的收件人选择结果（跨分页累积，关闭创建弹窗时重置） */
const campCust = { selected: new Set(), filterDesc: '' };
/** "选择客户"弹窗内部状态（分页 + 已应用的筛选条件） */
let cpk = null;
/** 弹窗打开时的"确认按钮可用性"同步钩子（选择客户列表在叠加层里改动选择集时要回写底层按钮） */
let campFormSync = null;

function resetCampCust() {
  campCust.selected = new Set();
  campCust.filterDesc = '';
  // v2.44 需求 2：编辑有历史的任务时，"选择客户"列表要排除该任务历史批次已发出过的客户
  campCust.excludeCampaignId = null;
  cpk = null;
  campFormSync = null;
}

/** 筛选条件的可读描述，空条件即"全部有效客户" */
function cpkFilterDesc(filters) {
  const parts = [];
  if (filters.name) parts.push(`姓名含“${filters.name}”`);
  if (filters.email) parts.push(`邮箱含“${filters.email}”`);
  if (filters.country) parts.push(`国家含“${filters.country}”`);
  if (filters.tags) parts.push(`标签含“${filters.tags}”`);
  return parts.length ? parts.join('、') : '全部有效客户';
}

function renderCampCustSummary() {
  const el = document.getElementById('campCustSummary');
  if (campFormSync) campFormSync();
  if (!el) return;
  el.innerHTML = campCust.selected.size === 0
    ? '<span class="cust-summary-empty">尚未选择客户</span>'
    : `已选中 <b>${campCust.selected.size}</b> 位客户 · 使用到的筛选条件：${escHtml(campCust.filterDesc)}`;
}

/**
 * 创建 / 编辑发送任务。
 * @param campaign 传入任务对象即进入编辑模式（v2.42 需求6：只要不在发送中都可编辑）；为空即新建
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
  // v2.44 需求 2：只有"已经发过信"的任务才需要排除历史收件人——新建与从未发出的编辑任务，
  // "选择客户"候选列表仍是全部有效客户，行为与上版一致。
  campCust.excludeCampaignId = editing && (campaign.sent + campaign.failed) > 0 ? campaign.id : null;
  const defaultSmtp = smtpConfigs.find(s => s.is_default) || smtpConfigs[0];
  const templateId = editing ? campaign.template_id : templates[0].id;
  const smtpId = editing ? campaign.smtp_config_id : defaultSmtp.id;
  const intervalMin = editing ? (campaign.interval_min || 1) : 1;
  const scheduleType = editing ? (campaign.schedule_type === 'one-time' ? 'one-time' : 'manual') : 'manual';
  const scheduleDatetime = editing ? editDatetimeValue(campaign.schedule_config) : '';
  if (editing) {
    (campaign.recipientIds || []).forEach(id => campCust.selected.add(id));
    campCust.filterDesc = `沿用第 ${campaign.current_batch || 1} 批（当前批次）收件人`;
  } else {
    // v2.29 需求 4：新建任务默认选中当前全部有效客户（可在"选择客户"列表里增减）
    (activeIdsRes.code === 0 ? activeIdsRes.data || [] : []).forEach(id => campCust.selected.add(id));
    campCust.filterDesc = cpkFilterDesc({});
  }

  // v2.42 需求6：编辑已发出过邮件的任务时，先把"留痕抹不掉"这条规则写在名单选择处
  // v2.43 需求 1.2：口径由"强制保留收件人"改为"历史批次只读留痕"，弹窗里只勾当前批次的收件人
  // v2.44 需求 2：候选列表不再列出历史批次已发出过的客户，并把批次数一并说清楚
  const keepNote = editing && (campaign.sent + campaign.failed) > 0
    ? `<div class="cust-keep-note">该任务已发出 ${campaign.sent + campaign.failed} 封（成功 ${campaign.sent}、失败 ${campaign.failed}），共 ${campaign.batch_count || 1} 个批次。这些记录连同其状态与发送时间不会被改写，保存后作为历史批次在"发送记录 / 批次概览"里查看；本弹窗列出的是第 ${campaign.current_batch || 1} 批（当前批次）收件人。<b>「选择客户」候选列表已自动剔除此前批次发出过的客户与失效客户</b>，所以这里勾到的都是没发过的新收件人，保存后与仍未发出的收件人一起进入下一批；要向老收件人重发请改用工具栏的「全部重发」。进度与各项统计仍按全部批次合计。</div>`
    : '';

  const root = Modal.show({
    title: editing ? '编辑发送任务' : '创建发送任务',
    large: true,
    content: `
      <div class="form-group">
        <label>任务名称 <b class="required-mark">*</b></label>
        <input class="form-input" id="campName" value="${escHtml(editing ? campaign.name : '')}" placeholder="如：9月开发信批量" autocomplete="off">
        <div class="field-error" id="campNameError">任务名称为必填项</div>
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
            ${smtpConfigs.map(s => `<option value="${s.id}" ${s.id === smtpId ? 'selected' : ''}>${escHtml(s.name)} (${escHtml(s.host)})</option>`).join('')}
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
        <label>选择客户 <b class="required-mark">*</b></label>
        <div class="cust-pick-row">
          <button type="button" class="btn btn-sm btn-secondary" id="btnPickCustomers">👥 选择客户</button>
          <span class="cust-summary" id="campCustSummary"></span>
        </div>
        ${keepNote}
        <div class="field-error" id="campCustError">请至少选择 1 位收件客户</div>
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
      if (r.code !== 0) { showToast(r.message, 'error'); return true; }
      const d = r.data;
      // v2.42 需求6：编辑会把"到底动了哪些收件人、留痕保住多少"直接说清楚
      // v2.43 需求 1.2：名单变动时一并说明进入了第几批、历史批次是否原样保留
      const batchTip = editing && d && d.batch_opened
        ? ` · 已进入第 ${d.batch_no} 批，此前已发出的记录作为历史批次保留`
        : '';
      showToast(editing && d
        ? `任务已更新：收件人 ${d.total} 位（新增 ${d.added}、移出 ${d.removed}），已发送 ${d.sent}、失败 ${d.failed}、待发送 ${d.pending}${batchTip}`
        : r.message, 'success', 4200);
      resetCampCust();
      loadCampaignList();
      refreshOpenDetail();
    },
  });

  const nameInput = root.querySelector('#campName');
  const confirmBtn = root.querySelector('.m-btn-confirm');
  const nameError = root.querySelector('#campNameError');
  const custError = root.querySelector('#campCustError');
  // v2.29 需求3：任务名称非空（全空格也算空）且至少选中 1 位收件客户，"创建任务"才可用
  const syncConfirmState = () => {
    const nameEmpty = !nameInput.value.trim();
    const noCustomer = campCust.selected.size === 0;
    confirmBtn.disabled = nameEmpty || noCustomer;
    nameError.style.display = nameEmpty && nameInput.value.length > 0 ? 'block' : 'none';
    custError.style.display = noCustomer ? 'block' : 'none';
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

  root.querySelector('#btnPickCustomers').onclick = openCustomerPicker;
  renderCampCustSummary();
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
 * v2.42 需求6：编辑任务入口。只要任务不在发送中就可以编辑；
 * v2.43 需求 1.4 起入口改为"双击任务行"（工具栏的编辑按钮已撤掉），
 * v2.43 需求 1.2 起收件人只回填当前批次，历史批次作为留痕保留、不再强制勾选。
 * <p>收件人回填必须把该任务的全部日志取全：/logs 是分页接口，一次只返回一页，
 * 只取第一页会让第一页之外的收件人被当成"移出"而在保存时删除其待发送记录。
 */
window.editCampaign = async function(id) {
  const campaign = await findCampaignById(id);
  if (!campaign) return;
  if (campaign.is_running || campaign.status === 'running') {
    showToast('任务正在发送中，请先暂停后再编辑', 'error');
    return;
  }
  campaign.recipientIds = await loadCampaignRecipientIds(campaign);
  openCampaignForm(campaign);
};

/** 分页取全该任务"当前批次"的收件人 ID（历史批次的收件人只作留痕，不进编辑弹窗的勾选态） */
async function loadCampaignRecipientIds(campaign) {
  const size = 1000;
  const ids = [];
  for (let p = 1; p <= 200; p++) {
    const res = await api.get(`/api/campaigns/${campaign.id}/logs?page=${p}&page_size=${size}`);
    if (res.code !== 0) break;
    const logs = res.data.logs || [];
    const currentBatch = res.data.current_batch || 1;
    logs.forEach(l => { if (l.customer_id && (l.batch_no || 1) === currentBatch) ids.push(l.customer_id); });
    if (logs.length < size) break;
  }
  return ids;
}

/* ---------------------------- 选择客户分页列表 ---------------------------- */

function cpkQuery(filters) {
  const p = new URLSearchParams();
  if (filters.name) p.set('name', filters.name);
  if (filters.email) p.set('email', filters.email);
  if (filters.country) p.set('country', filters.country);
  if (filters.tags) p.set('tags', filters.tags);
  // v2.44 需求 2：编辑已发出过的任务时，候选列表直接剔除"该任务历史批次已发过"的有效客户
  // （失效客户本来就由 /active 接口排除），这样"编辑 → 发下一批"只可能勾到新收件人。
  if (campCust.excludeCampaignId) p.set('exclude_campaign_id', campCust.excludeCampaignId);
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
  if (!cpk) cpk = { page: 1, pageSize: 10, total: 0, filters: { name: '', email: '', country: '', tags: '' } };
  const f = cpk.filters;

  cpk.box = Modal.show({
    title: '选择客户',
    wide: true,
    stacked: true,
    confirmText: '确定',
    content: `
      <div class="picker-filters">
        <div class="form-group"><label for="cpkName">姓名</label><input class="form-input" id="cpkName" value="${escHtml(f.name)}" placeholder="按姓名筛选"></div>
        <div class="form-group"><label for="cpkEmail">邮箱</label><input class="form-input" id="cpkEmail" value="${escHtml(f.email)}" placeholder="按邮箱筛选"></div>
        <div class="form-group"><label for="cpkCountry">国家</label><input class="form-input" id="cpkCountry" value="${escHtml(f.country)}" placeholder="按国家筛选"></div>
        <div class="form-group"><label for="cpkTags">标签</label><input class="form-input" id="cpkTags" value="${escHtml(f.tags)}" placeholder="按标签筛选"></div>
      </div>
      <div class="picker-toolbar">
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
      campCust.filterDesc = cpkFilterDesc(cpk.filters);
      renderCampCustSummary();
    },
  });

  const readFilters = () => ({
    name: cpkEl('cpkName').value.trim(),
    email: cpkEl('cpkEmail').value.trim(),
    country: cpkEl('cpkCountry').value.trim(),
    tags: cpkEl('cpkTags').value.trim(),
  });

  cpkEl('cpkSearch').onclick = () => {
    cpk.filters = readFilters();
    cpk.page = 1;
    loadCpkPage();
  };
  cpkEl('cpkReset').onclick = () => {
    ['cpkName', 'cpkEmail', 'cpkCountry', 'cpkTags'].forEach(id => { cpkEl(id).value = ''; });
    cpk.filters = { name: '', email: '', country: '', tags: '' };
    cpk.page = 1;
    loadCpkPage();
  };
  ['cpkName', 'cpkEmail', 'cpkCountry', 'cpkTags'].forEach(id => {
    cpkEl(id).onkeydown = (e) => {
      if (e.key === 'Enter') cpkEl('cpkSearch').click();
    };
  });

  cpkEl('cpkPickAll').onclick = () => applyCpkMatchedSelection(true);
  cpkEl('cpkPickNone').onclick = () => applyCpkMatchedSelection(false);
  cpkEl('cpkCheckAll').onchange = function() {
    const checked = this.checked;
    cpkBoxes().forEach(cb => { cb.checked = checked; });
    syncCpkSelectionFromCheckboxes();
  };

  loadCpkPage();
}

/** 选择 / 取消当前筛选条件下命中的全部有效客户（跨页，用后端返回的命中 ID 集合） */
async function applyCpkMatchedSelection(select) {
  const res = await api.get(`/api/customers/active/ids?${cpkQuery(cpk.filters)}`);
  if (res.code !== 0) { showToast('客户列表加载失败', 'error'); return; }
  const ids = res.data || [];
  if (ids.length === 0) { showToast('当前筛选条件没有命中的有效客户', 'error'); return; }
  ids.forEach(id => { select ? campCust.selected.add(id) : campCust.selected.delete(id); });
  cpkBoxes().forEach(cb => { cb.checked = select; });
  cpkEl('cpkCheckAll').checked = select;
  renderCpkSummary();
}

async function loadCpkPage() {
  const body = cpkEl('cpkBody');
  if (!body) return;
  const res = await api.get(`/api/customers/active?${cpkQuery(cpk.filters)}&page=${cpk.page}&page_size=${cpk.pageSize}`);
  if (res.code !== 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--danger)">客户列表加载失败</td></tr>`;
    return;
  }
  const customers = res.data.customers || [];
  cpk.total = res.data.total || 0;
  // v2.44 需求 2：编辑任务时后端会额外告诉界面"因为历史批次而少掉了多少候选"
  cpk.excludedCount = res.data.excluded_count || 0;

  body.innerHTML = customers.length > 0 ? customers.map(c => `
    <tr class="clickable-row" data-id="${c.id}">
      <td><input type="checkbox" class="cpk-check" value="${c.id}" ${campCust.selected.has(c.id) ? 'checked' : ''}></td>
      <td>${escHtml(c.customer_no) || '-'}</td>
      <td>${escHtml(c.name)}</td>
      <td>${escHtml(c.email)}</td>
      <td>${escHtml(c.country) || '-'}</td>
      <td>${c.tags ? `<span class="badge badge-info">${escHtml(c.tags)}</span>` : '-'}</td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="empty-state"><p>${cpk.excludedCount
        ? `没有符合筛选条件的新客户可选（另有 ${cpk.excludedCount} 位在本任务此前的批次已发出过，已从候选中排除）`
        : '没有符合筛选条件的有效客户'}</p></td></tr>`;

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

/** 把本页复选框状态同步进已选集合（其他页的选择保持不变） */
function syncCpkSelectionFromCheckboxes() {
  const boxes = cpkBoxes();
  boxes.forEach(cb => {
    const id = parseInt(cb.value, 10);
    if (cb.checked) campCust.selected.add(id);
    else campCust.selected.delete(id);
  });
  cpkEl('cpkCheckAll').checked = boxes.length > 0 && boxes.every(cb => cb.checked);
  renderCpkSummary();
}

function renderCpkSummary() {
  // 选择集在叠加层里增减时，底层"创建任务"按钮的可用性要同步（v2.29 需求3）
  if (campFormSync) campFormSync();
  const el = cpkEl('cpkSummary');
  if (!el) return;
  // v2.44 需求 2：把"为什么这里看不到某个已经发过信的客户"写在同一行，避免界面显得在漏人
  const excludedTip = cpk.excludedCount
    ? ` · <span class="cpk-excluded" title="这些客户在本任务此前的批次里已经发出过（有成功或失败留痕），同一任务不会向他们重发，故不再列为候选；要向老收件人重发请用任务工具栏的「全部重发」">已排除 ${cpk.excludedCount} 位本任务已发出的客户</span>`
    : '';
  el.innerHTML = `已选中 <b>${campCust.selected.size}</b> 位客户 · 筛选条件：${escHtml(cpkFilterDesc(cpk.filters))} · 命中 ${cpk.total} 位有效客户${excludedTip}`;
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
