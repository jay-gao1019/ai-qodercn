function CustomersPage() {
  return `
    <div class="page-header">
      <h1>客户管理</h1>
      <div class="toolbar">
        <button class="btn btn-secondary" id="btnImport">📥 导入</button>
        <button class="btn btn-secondary" id="btnExportCsv">导出 CSV</button>
        <button class="btn btn-secondary" id="btnExportExcel">导出 Excel</button>
        <button class="btn btn-primary" id="btnAddCustomer">+ 添加客户</button>
      </div>
    </div>
    <div class="search-bar customers-bar">
      <input class="search-input" id="customerSearch" placeholder="搜索客户号、姓名、邮箱、公司、标签...">
      <select class="form-select" id="customerStatusFilter" style="width:130px">
        <option value="">全部状态</option>
        <option value="active">仅有效客户</option>
        <option value="inactive">仅失效客户</option>
      </select>
      <button class="btn btn-sm btn-secondary" id="btnSearch">搜索</button>
      <span class="search-divider"></span>
      <!-- v2.38 需求2.1：去掉工具栏的"编辑"按钮，编辑统一走"双击整行 → 客户详情 → 编辑" -->
      <button class="btn btn-sm btn-secondary" id="btnBatchActivate" disabled>生效</button>
      <button class="btn btn-sm btn-secondary" id="btnBatchDeactivate" disabled>失效</button>
      <button class="btn btn-sm btn-danger" id="btnBatchDelete" disabled>删除</button>
      <!-- v2.36 需求2.1：选中提示（共 N 条 / 已全部选中 / 全部选中·取消全选）放在"删除"按钮右侧，
           不再独占列表上方一行，列表位置不随选中态上下移动 -->
      <div class="sel-inline" id="custSelectionBanner"></div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="width:40px"><input type="checkbox" id="checkAll" title="全选当前页"></th>
            <!-- v2.40 需求2：加"客户号"列、去"电话"列（电话仅保留在数据库/接口与详情、编辑、导出中） -->
            <th>客户号</th><th>姓名</th><th>邮箱</th><th>公司</th><th>国家</th><th>标签</th><th>状态</th>
          </tr></thead>
          <tbody id="customerList"></tbody>
        </table>
      </div>
      <div id="customerPagination" class="pag-bar"></div>
    </div>
  `;
}

let customerPage = 1;
let customerSearch = '';
let customerStatusFilter = '';
let customerPageSize = 15;
let selectedIds = [];
// “全选当前筛选条件”状态：跨页选中所有匹配记录，excludeIds 为其下被反选排除的项
let selectAllMatching = false;
let excludeIds = [];
let customerTotal = 0;

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function customerFormHTML(c = {}) {
  return `
    <div class="form-row">
      <div class="form-group"><label>姓名 *</label><input class="form-input" id="cName" value="${c.name || ''}"></div>
      <div class="form-group"><label>邮箱 *</label><input class="form-input" id="cEmail" type="email" value="${c.email || ''}" placeholder="example@domain.com"><div id="emailError" style="color:#e53e3e;font-size:12px;margin-top:4px;display:none">请输入有效的邮箱地址</div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>公司</label><input class="form-input" id="cCompany" value="${c.company || ''}"></div>
      <div class="form-group"><label>电话</label><input class="form-input" id="cPhone" value="${c.phone || ''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>国家</label><input class="form-input" id="cCountry" value="${c.country || ''}"></div>
      <div class="form-group"><label>标签</label><input class="form-input" id="cTags" value="${c.tags || ''}" placeholder="多个标签用逗号分隔"></div>
    </div>
    <div class="form-group">
      <label>客户有效性</label>
      <select class="form-select" id="cStatus">
        <option value="active" ${c.status !== 'inactive' ? 'selected' : ''}>有效（可参与发送任务）</option>
        <option value="inactive" ${c.status === 'inactive' ? 'selected' : ''}>失效（不会出现在发送任务客户列表）</option>
      </select>
    </div>
    <div class="form-group"><label>备注</label><textarea class="form-textarea" id="cNotes">${c.notes || ''}</textarea></div>
  `;
}

function readCustomerForm() {
  const statusEl = document.getElementById('cStatus');
  return {
    name: document.getElementById('cName').value.trim(),
    email: document.getElementById('cEmail').value.trim(),
    company: document.getElementById('cCompany').value.trim(),
    phone: document.getElementById('cPhone').value.trim(),
    country: document.getElementById('cCountry').value.trim(),
    tags: document.getElementById('cTags').value.trim(),
    notes: document.getElementById('cNotes').value.trim(),
    status: statusEl ? statusEl.value : 'active',
  };
}

function validateCustomerForm(data) {
  if (!data.name) { showToast('姓名为必填项', 'error'); return false; }
  if (!data.email) { showToast('邮箱为必填项', 'error'); return false; }
  const errEl = document.getElementById('emailError');
  if (!isValidEmail(data.email)) {
    if (errEl) errEl.style.display = 'block';
    showToast('请输入有效的邮箱地址', 'error');
    return false;
  }
  if (errEl) errEl.style.display = 'none';
  return true;
}

function setupEmailValidation() {
  const emailInput = document.getElementById('cEmail');
  if (!emailInput) return;
  const check = () => {
    const val = emailInput.value.trim();
    const errEl = document.getElementById('emailError');
    if (!errEl) return;
    if (val && !isValidEmail(val)) {
      errEl.style.display = 'block';
      emailInput.style.borderColor = '#e53e3e';
    } else {
      errEl.style.display = 'none';
      emailInput.style.borderColor = '';
    }
  };
  emailInput.addEventListener('blur', check);
  emailInput.addEventListener('input', check);
}

async function loadCustomers() {
  const statusParam = customerStatusFilter ? `&status=${encodeURIComponent(customerStatusFilter)}` : '';
  const res = await api.get(`/api/customers?search=${encodeURIComponent(customerSearch)}&page=${customerPage}&page_size=${customerPageSize}${statusParam}`);
  const tbody = document.getElementById('customerList');

  // 每次加载后按当前选择模式重建 DOM 勾选态与按钮，
  // 保证批量操作按钮的文案（生效/失效/删除）与可用态彻底同步
  selectedIds = [];

  if (res.code === 0 && res.data.customers.length > 0) {
    customerTotal = res.data.total;
    tbody.innerHTML = res.data.customers.map(c => {
      const isActive = c.status !== 'inactive';
      const statusBadge = isActive
        ? '<span class="badge badge-success">有效</span>'
        : '<span class="badge badge-danger">失效</span>';
      return `<tr data-id="${c.id}" data-status="${isActive ? 'active' : 'inactive'}" class="clickable-row"${isActive ? '' : ' style="opacity:0.6"'}>
      <td><input type="checkbox" class="cust-check" value="${c.id}"></td>
      <td class="cust-no">${c.customer_no || '-'}</td>
      <td>${c.name}</td>
      <td>${c.email}</td>
      <td>${c.company || '-'}</td>
      <td>${c.country || '-'}</td>
      <td>${c.tags ? `<span class="badge badge-info">${c.tags}</span>` : '-'}</td>
      <td>${statusBadge}</td>
    </tr>`;
    }).join('');

    const total = res.data.total;
    document.getElementById('customerPagination').innerHTML = renderPagination({
      total, page: customerPage, pageSize: customerPageSize, unit: '位客户',
      gotoFn: 'gotoCustomerPage', sizeFn: 'setCustomerPageSize',
    });

    document.querySelectorAll('.cust-check').forEach(cb => {
      cb.onchange = (e) => { e.stopPropagation(); updateSelection(); };
    });

    document.querySelectorAll('.clickable-row').forEach(row => {
      row.onclick = function(e) {
        if (e.target.type === 'checkbox') return;
        // v2.36 需求2.2：多选只走复选框；单击某条记录则取消其他所有选择，只选中这一条，
        // 随即可以用工具栏的"生效/失效"操作这一行（跨页全选模式也一并退出）
        selectAllMatching = false;
        excludeIds = [];
        selectedIds = [parseInt(this.dataset.id)];
        applyCheckboxState();
      };
      // v2.42 需求1：整行双击直接进入编辑态
      row.ondblclick = function() {
        window.showCustomerDetail(parseInt(this.dataset.id, 10), null, { edit: true });
      };
      row.style.cursor = 'pointer';
      row.title = '双击编辑该客户信息';
    });
  } else {
    customerTotal = res.code === 0 ? res.data.total : 0;
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>暂无客户数据</p></td></tr>';
    document.getElementById('customerPagination').innerHTML = renderPagination({
      total: 0, page: 1, pageSize: customerPageSize, unit: '位客户',
      gotoFn: 'gotoCustomerPage', sizeFn: 'setCustomerPageSize',
    });
  }

  // 恢复勾选状态：全选模式下本页除排除项外均为选中
  applyCheckboxState();
}

window.gotoCustomerPage = function(p) {
  const totalPages = Math.max(1, Math.ceil(customerTotal / customerPageSize));
  customerPage = Math.min(Math.max(1, p), totalPages);
  loadCustomers();
};

window.setCustomerPageSize = function(s) {
  customerPageSize = parseInt(s);
  customerPage = 1;
  loadCustomers();
};

/** 把当前选择模式映射到本页复选框的勾选状态 */
function applyCheckboxState() {
  const excludeSet = new Set(excludeIds);
  const selectedSet = new Set(selectedIds);
  document.querySelectorAll('#customerList tr[data-id]').forEach(tr => {
    const id = parseInt(tr.dataset.id);
    const cb = tr.querySelector('.cust-check');
    cb.checked = selectAllMatching ? !excludeSet.has(id) : selectedSet.has(id);
  });
  const boxes = [...document.querySelectorAll('.cust-check')];
  document.getElementById('checkAll').checked = boxes.length > 0 && boxes.every(cb => cb.checked);
  updateSelectionButtons();
  renderSelectionBanner();
}

/** 当前有效选中数（全选模式 = 筛选总数 - 排除数） */
function getEffectiveCount() {
  return selectAllMatching ? Math.max(0, customerTotal - excludeIds.length) : selectedIds.length;
}

/** 筛选条件的可读描述，用于提示条 */
function filterDescription() {
  const parts = [];
  parts.push(customerSearch ? `关键字“${customerSearch}”` : '无关键字');
  const statusLabel = { active: '仅有效客户', inactive: '仅失效客户' }[customerStatusFilter];
  parts.push(statusLabel || '全部状态');
  return parts.join('、');
}

/**
 * v2.25：跨页全选的"全部选中 / 取消全选"复选按钮对（需求2）。
 * 两者互斥：已全选时"全部选中"为选中且置灰、"取消全选"可点；未全选时相反。
 */
function selectionCheckboxes(allOn) {
  return `<span class="banner-checks">
    <label class="banner-check${allOn ? ' is-checked' : ''}"><input type="checkbox" ${allOn ? 'checked disabled' : ''} onchange="selectAllMatchingCustomers()" title="${allOn ? '当前已是全部选中，如需取消请点右侧“取消全选”' : `勾选后选中当前筛选条件下的全部 ${customerTotal} 条记录`}"> 全部选中</label>
    <label class="banner-check${allOn ? '' : ' is-disabled'}"><input type="checkbox" ${allOn ? '' : 'disabled'} onchange="clearCustomerSelection()" title="${allOn ? '取消全部选中，回到未选中状态' : '勾选“全部选中”后可用'}"> 取消全选</label>
  </span>`;
}

function renderSelectionBanner() {
  // v2.36 需求2.1：提示内容渲染进工具栏右侧的 #custSelectionBanner（.sel-inline），不再独占一行。
  // 工具栏同一行还要放下搜索框与四个批量按钮，所以这里只显示"选中数 + 可操作项"，
  // 完整的筛选条件说明放进 title 悬停显示；窄视口下被省略号截断的也只有这段说明文字。
  const el = document.getElementById('custSelectionBanner');
  if (!el) return;
  const n = getEffectiveCount();
  if (n === 0) { el.innerHTML = ''; el.title = ''; return; }
  el.title = `筛选条件：${filterDescription()}，共 ${customerTotal} 条`
    + (excludeIds.length ? `，已排除 ${excludeIds.length} 条` : '');
  const total = `<span class="banner-conds" title="${el.title}">共 ${customerTotal} 条</span>`;

  if (selectAllMatching) {
    el.innerHTML = `
      <span class="banner-strong">✓ 已全选 ${customerTotal} 条</span>
      ${selectionCheckboxes(true)}
      ${excludeIds.length ? `<span class="banner-conds" title="${el.title}">已排除 ${excludeIds.length} 条</span>` : total}`;
    return;
  }

  const pageBoxes = [...document.querySelectorAll('.cust-check')];
  const allPageChecked = pageBoxes.length > 0 && pageBoxes.every(cb => cb.checked);
  if (allPageChecked && customerTotal > selectedIds.length) {
    el.innerHTML = `
      <span class="banner-strong">当前页 ${selectedIds.length} 条已全部选中</span>
      ${selectionCheckboxes(false)}
      ${total}`;
  } else {
    // "清除选择"是可操作项，排在装饰性的"共 N 条"之前，窄视口下被截断的只会是后者
    el.innerHTML = `
      <span class="banner-strong">已选中 ${selectedIds.length} 条</span>
      <a onclick="clearCustomerSelection()">清除选择</a>
      ${total}`;
  }
}

window.selectAllMatchingCustomers = function() {
  selectAllMatching = true;
  excludeIds = [];
  selectedIds = [];
  applyCheckboxState();
};

window.clearCustomerSelection = function() {
  selectAllMatching = false;
  excludeIds = [];
  selectedIds = [];
  document.querySelectorAll('.cust-check, #checkAll').forEach(cb => { cb.checked = false; });
  updateSelectionButtons();
  renderSelectionBanner();
};

function updateSelection() {
  const boxes = [...document.querySelectorAll('.cust-check')];
  if (selectAllMatching) {
    // 全选模式下复选框表示“排除/恢复”，而非追加选中
    boxes.forEach(cb => {
      const id = parseInt(cb.value);
      if (!cb.checked && !excludeIds.includes(id)) excludeIds.push(id);
      if (cb.checked) excludeIds = excludeIds.filter(x => x !== id);
    });
  } else {
    selectedIds = boxes.filter(cb => cb.checked).map(cb => parseInt(cb.value));
  }
  document.getElementById('checkAll').checked = boxes.length > 0 && boxes.every(cb => cb.checked);
  updateSelectionButtons();
  renderSelectionBanner();
}

/**
 * 读取当前选中记录的状态集合。
 * 以 selectedIds 为唯一依据（而非 DOM 勾选态），避免列表刷新前后
 * DOM 未同步导致计数残留。
 * @returns {{active: number, inactive: number}} 各状态的选中数量
 */
function getSelectedStatusCount() {
  let active = 0, inactive = 0;
  const idSet = new Set(selectedIds);
  document.querySelectorAll('#customerList tr[data-id]').forEach(tr => {
    const id = parseInt(tr.dataset.id);
    if (!idSet.has(id)) return;
    if (tr.dataset.status === 'inactive') inactive++;
    else active++;
  });
  return { active, inactive };
}

function updateSelectionButtons() {
  const delBtn = document.getElementById('btnBatchDelete');
  const actBtn = document.getElementById('btnBatchActivate');
  const deactBtn = document.getElementById('btnBatchDeactivate');

  // 按钮尚未渲染时直接返回，避免抛异常中断后续流程
  if (!delBtn || !actBtn || !deactBtn) return;

  const n = getEffectiveCount();

  if (selectAllMatching) {
    // 跨页全选：后端按筛选条件整体变更，生效/失效始终可用；
    // 删除仅支持逐条/按页选择，避免误操作全部数据
    actBtn.disabled = n === 0;
    deactBtn.disabled = n === 0;
    actBtn.textContent = n ? `生效 (${n})` : '生效';
    deactBtn.textContent = n ? `失效 (${n})` : '失效';
    actBtn.title = `将当前筛选条件下选中的 ${n} 个客户设置为生效`;
    deactBtn.title = `将当前筛选条件下选中的 ${n} 个客户设置为失效`;

    delBtn.disabled = true;
    delBtn.textContent = '删除';
    delBtn.title = '批量删除仅支持在页面内勾选具体客户，请先取消全选';
    return;
  }

  const { active, inactive } = getSelectedStatusCount();

  // 选中记录状态混合（既有生效又有失效）时，仅允许删除；
  // 否则仅当存在需要变更的记录时对应按钮才可用
  const isMixed = active > 0 && inactive > 0;

  // 「删除」仅在「所选记录全部为失效状态」时可用
  const allInactive = n > 0 && active === 0;
  delBtn.disabled = !allInactive;
  delBtn.textContent = allInactive ? `删除 (${n})` : '删除';

  // 「生效」仅在「全部为失效客户」时可用；「失效」仅在「全部为生效客户」时可用
  actBtn.disabled = isMixed || inactive === 0;
  deactBtn.disabled = isMixed || active === 0;

  actBtn.textContent = (!isMixed && inactive > 0) ? `生效 (${inactive})` : '生效';
  deactBtn.textContent = (!isMixed && active > 0) ? `失效 (${active})` : '失效';

  // 提示用户禁用原因
  if (isMixed) {
    actBtn.title = '所选客户状态不一致，请仅执行删除操作';
    deactBtn.title = '所选客户状态不一致，请仅执行删除操作';
  } else {
    actBtn.title = inactive === 0
      ? (n === 0 ? '请先选择客户' : '所选客户均已是生效状态')
      : `将 ${inactive} 个失效客户恢复为生效`;
    deactBtn.title = active === 0
      ? (n === 0 ? '请先选择客户' : '所选客户均已是失效状态')
      : `将 ${active} 个生效客户设为失效`;
  }

  // 删除的禁用提示：区分「未选择」「全部生效」「混合」三种情况
  if (n === 0) {
    delBtn.title = '请先选择客户';
  } else if (isMixed) {
    delBtn.title = '所选客户状态不一致，仅可删除全部为失效状态的客户';
  } else if (active > 0) {
    delBtn.title = '只有失效状态的客户才能删除，请先将选中的客户设为失效';
  } else {
    delBtn.title = `删除选中的 ${n} 个失效客户`;
  }
}

/**
 * 批量设置客户有效性
 * @param {string} status active=生效 / inactive=失效
 */
function batchSetCustomerStatus(status) {
  const isActive = status === 'active';
  const action = isActive ? '生效' : '失效';

  // 跨页全选模式：由后端按筛选条件批量变更（携带排除项）
  if (selectAllMatching) {
    const n = getEffectiveCount();
    if (n === 0) { showToast('没有符合条件的客户', 'error'); return; }
    Modal.show({
      title: `批量${action}（全部筛选结果）`,
      content: `<p>将对<strong>当前筛选条件下</strong>的全部 <strong>${n}</strong> 个客户执行“${action}”。</p>
        <p style="margin-top:6px;font-size:13px;color:var(--text-secondary)">筛选条件：${filterDescription()}${excludeIds.length ? `，已排除 ${excludeIds.length} 条` : ''}</p>
        ${!isActive ? '<p style="margin-top:8px;font-size:13px;color:var(--text-secondary)">失效客户不会出现在发送任务的客户选择列表中。</p>' : ''}`,
      confirmText: '确定',
      onConfirm: async () => {
        const r = await api.post('/api/customers/batch-status-by-filter', {
          search: customerSearch,
          status: customerStatusFilter,
          exclude_ids: excludeIds,
          target_status: status,
        });
        showToast(r.message, r.code === 0 ? 'success' : 'error');
        clearCustomerSelection();
        loadCustomers();
      }
    });
    return;
  }

  if (selectedIds.length === 0) return;
  // 只处理需要变更的记录（以 selectedIds 为准，避免 DOM 勾选态不同步）
  const idSet = new Set(selectedIds);
  const targets = [];
  document.querySelectorAll('#customerList tr[data-id]').forEach(tr => {
    const id = parseInt(tr.dataset.id);
    if (!idSet.has(id)) return;
    const cur = tr.dataset.status === 'inactive' ? 'inactive' : 'active';
    if (cur !== status) targets.push(id);
  });

  if (targets.length === 0) {
    showToast('所选客户无需变更', 'error');
    return;
  }

  Modal.show({
    title: `批量${action}`,
    content: `<p>确定要将选中的 <strong>${targets.length}</strong> 个客户设置为<strong>${action}</strong>吗？</p>
      ${!isActive ? '<p style="margin-top:8px;font-size:13px;color:var(--text-secondary)">失效客户不会出现在发送任务的客户选择列表中。</p>' : ''}`,
    confirmText: '确定',
    onConfirm: async () => {
      const r = await api.post('/api/customers/batch-status', { ids: targets, status });
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      clearCustomerSelection();
      loadCustomers();
    }
  });
}

/** 客户列表页未挂载时（从发送记录等其他界面弹窗编辑）不能去刷新不存在的表格 */
function refreshCustomerListIfOpen() {
  if (document.getElementById('customerList')) loadCustomers();
}

/**
 * v2.39 需求2：客户详情的只读态与编辑态共用这一份 markup 与同一批控件，
 * 只切换"是否可编辑"，因此两个界面的大小、字体、样式完全一致，
 * 也不再需要只读视图底部那行说明小字。
 * 控件 id 与"新增客户"表单同名（cName / cEmail / …），故 readCustomerForm、
 * validateCustomerForm、setupEmailValidation 三处校验逻辑原样复用。
 * <p>v2.43 需求 1.3：两个入口（客户管理双击行、发送记录双击行）都用这一份 markup，
 * 因此两处的编辑界面样式完全一致。字段按需求分列，且顺序是**列优先**——
 * CSS 用 grid-auto-flow: column 先填满左列再排右列，所以这里的书写顺序即
 * 左列（客户号/公司/电话/标签/备注）→ 右列（姓名/邮箱/国家/有效性）。
 * v2.44 需求 1：创建时间、最后修改时间不再显示（客户号仍是只读纯文本），
 * 因此两列各 5/4 行，窗口宽度也按"除备注外不换行"重新放宽。
 * @param {object} c 客户行
 * @param {boolean} editing 是否编辑态（渲染时的初值，切换由 setCustomerDetailEditable 就地完成）
 */
function customerDetailHTML(c, editing) {
  const item = (label, control) =>
    `<div class="cd-item"><span class="cd-label">${label}</span>${control}</div>`;
  const req = '<span class="cd-req"> *</span>';
  // 渲染时即带上只读限制，避免"窗口刚打开的那一瞬字段可写"
  const ro = editing ? '' : ' readonly placeholder="-"';
  const input = (id, value, type = 'text') =>
    `<input class="cd-input" id="${id}" type="${type}" value="${escHtml(value || '')}"${ro}>`;
  return `<div class="customer-detail${editing ? ' is-editing' : ''}" id="customerDetailBox">
    ${item('客户号', `<span class="cd-value">${escHtml(c.customer_no || '-')}</span>`)}
    ${item('公司', input('cCompany', c.company))}
    ${item('电话', input('cPhone', c.phone))}
    ${item('标签', input('cTags', c.tags))}
    ${item('备注', `<textarea class="cd-input" id="cNotes"${ro}>${escHtml(c.notes || '')}</textarea>`)}
    ${item(`姓名${req}`, input('cName', c.name))}
    ${item(`邮箱${req}`, `<div class="cd-field">${input('cEmail', c.email, 'email')}<div class="cd-error" id="emailError">请输入有效的邮箱地址</div></div>`)}
    ${item('国家', input('cCountry', c.country))}
    ${item('客户有效性', `<select class="cd-select" id="cStatus" tabindex="${editing ? 0 : -1}">
        <option value="active" ${c.status !== 'inactive' ? 'selected' : ''}>有效（可参与发送任务）</option>
        <option value="inactive" ${c.status === 'inactive' ? 'selected' : ''}>失效（不会出现在发送任务客户列表）</option>
      </select>`)}
  </div>`;
}

/**
 * 切换客户详情的可编辑状态（不重建 DOM，所以窗口尺寸/字体/样式两态一致）。
 * 只读态：输入框加 readonly、下拉框退出 Tab 序（CSS 另把 pointer-events 关掉），
 * 并把控件画成无边框无底色的纯文本；空值以"-"占位，编辑态则不留占位以免被误读为内容。
 */
function setCustomerDetailEditable(editable) {
  const box = document.getElementById('customerDetailBox');
  if (!box) return;
  box.classList.toggle('is-editing', editable);
  box.querySelectorAll('.cd-input').forEach(el => {
    if (editable) {
      el.removeAttribute('readonly');
      el.removeAttribute('placeholder');
    } else {
      el.setAttribute('readonly', '');
      el.setAttribute('placeholder', '-');
      el.style.borderColor = '';
    }
  });
  const sel = document.getElementById('cStatus');
  if (sel) sel.tabIndex = editable ? 0 : -1;
  const errEl = document.getElementById('emailError');
  if (errEl && !editable) errEl.style.display = 'none';
}

/**
 * 打开"客户详情"对话框（v2.38 需求2.2 取代原"编辑客户"窗口）。
 * v2.39 需求2：只读态与编辑态在同一个弹窗、同一份 DOM 内切换——
 * 点"编辑"就地解除控件的只读限制（确认按钮同时变为"保存"），点"保存"才提交。
 * v2.42 需求1：opts.edit 为真时直接以编辑态打开（客户管理双击行走这条路），
 * 标题与按钮文字随初始态一并确定；客户号始终只是纯文本。
 * v2.43 需求1.3：发送记录双击行也走 edit=true，两处用的是同一个窗口实现，样式天然一致。
 * v2.44 需求 1：窗口里不再显示创建时间/最后修改时间，尺寸也从 compact(504px) 放宽到 778px，
 * 让除"备注"（唯一多行文本域）之外的字段内容都能在一行内完整显示。
 * @param {number} id 客户 ID
 * @param {Function} [onSaved] 保存成功后的回调，供非客户管理页的调用方刷新自己的列表（v2.35 需求3.4 → v2.38 需求3.1）
 * @param {{edit?: boolean}} [opts] edit=true 表示直接进入编辑态
 */
window.showCustomerDetail = async function(id, onSaved, opts) {
  const res = await api.get(`/api/customers/${id}`);
  const c = res.code === 0 ? res.data : null;
  if (!c) { showToast(res.message || '未找到该客户，可能已被删除', 'error'); return; }

  let editing = !!(opts && opts.edit);
  Modal.show({
    title: editing ? '编辑客户信息' : '客户详情',
    compact: true,
    content: customerDetailHTML(c, editing),
    confirmText: editing ? '保存' : '编辑',
    cancelText: '关闭',
    onConfirm: async () => {
      if (!editing) {
        editing = true;
        setCustomerDetailEditable(true);
        document.getElementById('modalTitle').textContent = '编辑客户信息';
        document.getElementById('modalConfirm').textContent = '保存';
        // 必须返回 true：否则弹窗会在切换到编辑态后立即关闭
        return true;
      }
      const data = readCustomerForm();
      if (!validateCustomerForm(data)) return true;
      const r = await api.put(`/api/customers/${id}`, data);
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      if (r.code !== 0) return true;
      refreshCustomerListIfOpen();
      if (onSaved) await onSaved();
    },
  });
  setupEmailValidation();
};

async function bindCustomersEvents() {
  await loadCustomers();

  document.getElementById('checkAll').onchange = function() {
    document.querySelectorAll('.cust-check').forEach(cb => { cb.checked = this.checked; });
    updateSelection();
  };

  document.getElementById('btnSearch').onclick = () => {
    customerSearch = document.getElementById('customerSearch').value.trim();
    customerStatusFilter = document.getElementById('customerStatusFilter').value;
    customerPage = 1;
    // 筛选条件变化后旧的全选语义失效，需重置
    clearCustomerSelection();
    loadCustomers();
  };
  document.getElementById('customerSearch').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('btnSearch').click();
  };

  document.getElementById('btnAddCustomer').onclick = () => {
    Modal.show({
      title: '添加客户',
      content: customerFormHTML(),
      confirmText: '添加',
      onConfirm: async () => {
        const data = readCustomerForm();
        if (!validateCustomerForm(data)) return;
        const r = await api.post('/api/customers', data);
        showToast(r.message, r.code === 0 ? 'success' : 'error');
        loadCustomers();
      }
    });
    setTimeout(() => setupEmailValidation(), 100);
  };

  document.getElementById('btnBatchActivate').onclick = () => batchSetCustomerStatus('active');
  document.getElementById('btnBatchDeactivate').onclick = () => batchSetCustomerStatus('inactive');

  document.getElementById('btnBatchDelete').onclick = () => {
    if (selectedIds.length === 0) return;
    Modal.show({
      title: '批量删除',
      content: `<p>确定要删除选中的 ${selectedIds.length} 个客户吗？</p>`,
      confirmText: '删除',
      onConfirm: async () => {
        const r = await api.post('/api/customers/batch-delete', { ids: selectedIds });
        showToast(r.message, r.code === 0 ? 'success' : 'error');
        loadCustomers();
      }
    });
  };

  document.getElementById('btnImport').onclick = () => {
    Modal.show({
      title: '导入客户',
      content: `
        <div class="upload-area" id="uploadArea">
          <div style="font-size:32px">📁</div>
          <p>点击或拖拽文件到此处</p>
          <p>支持 .xlsx 和 .csv 格式</p>
          <input type="file" id="importFile" accept=".xlsx,.csv" style="display:none">
        </div>
        <div style="margin-top:12px;text-align:center">
          <a href="/api/customers/import-template" style="color:var(--primary);text-decoration:underline;font-size:13px">📥 下载导入模板 (Excel)</a>
        </div>
        <div id="importResult" style="margin-top:12px"></div>
      `,
      large: true,
      confirmText: '导入',
      onConfirm: async () => {
        const fileInput = document.getElementById('importFile');
        if (!fileInput.files.length) { showToast('请选择文件', 'error'); return; }
        const fd = new FormData();
        fd.append('file', fileInput.files[0]);
        const r = await api.post('/api/customers/import', fd, true);
        showToast(r.message, r.code === 0 ? 'success' : 'error');
        loadCustomers();
      }
    });
    setTimeout(() => {
      const area = document.getElementById('uploadArea');
      const fileInput = document.getElementById('importFile');
      area.onclick = () => fileInput.click();
      fileInput.onchange = () => {
        if (fileInput.files.length) {
          document.getElementById('importResult').innerHTML = `<span class="badge badge-info">已选择: ${fileInput.files[0].name}</span>`;
        }
      };
    }, 100);
  };

  document.getElementById('btnExportCsv').onclick = () => downloadExport('csv');
  document.getElementById('btnExportExcel').onclick = () => downloadExport('excel');
}

function downloadExport(format) {
  const a = document.createElement('a');
  a.href = `/api/customers/export?format=${format}`;
  a.download = `customers.${format === 'excel' ? 'xlsx' : 'csv'}`;
  a.click();
}
