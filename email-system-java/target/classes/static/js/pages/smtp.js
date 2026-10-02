function SMTPPage() {
  return `
    <div class="page-header">
      <h1>SMTP 配置</h1>
      <button class="btn btn-primary" id="btnAddSmtp">+ 添加配置</button>
    </div>
    <!-- v2.47 需求2.1/2.2：原每行的"测试/删除"收敛到这条工具栏（形态同客户管理/模板/任务），
         单击选中某条配置后才可用；"编辑"改成双击列表行触发
         v2.48 需求3：工具栏里的提示文字整体删除，选中状态只靠行底色高亮 -->
    <div class="search-bar smtp-bar">
      <button class="btn btn-sm btn-secondary" id="btnSmtpTest" disabled>测试</button>
      <button class="btn btn-sm btn-danger" id="btnSmtpDelete" disabled>删除</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>名称</th><th>服务器</th><th>端口</th><th>用户名</th><th>SSL</th><th>默认</th></tr></thead>
          <tbody id="smtpList"><tr><td colspan="6" style="text-align:center;color:var(--text-secondary)">加载中...</td></tr></tbody>
        </table>
      </div>
      <div id="smtpPagination" style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;font-size:13px;color:var(--text-secondary)"></div>
    </div>
  `;
}

let smtpPage = 1;
let smtpPageSize = 15;
let smtpAllData = [];
// v2.47 需求2.1：工具栏操作对象。列表是前端切片分页，选中项在 smtpAllData 里始终可见，翻页不会丢
let selectedSmtpId = null;

function smtpFormHTML(cfg = {}) {
  // Common SMTP presets
  const presets = [
    { name: 'QQ邮箱', host: 'smtp.qq.com', port: 465, ssl: true, tls: false, note: '需使用授权码' },
    { name: '163邮箱', host: 'smtp.163.com', port: 465, ssl: true, tls: false, note: '需使用授权码' },
    { name: '阿里云企业邮箱', host: 'smtp.qiye.aliyun.com', port: 465, ssl: true, tls: false, note: '' },
    { name: 'Gmail', host: 'smtp.gmail.com', port: 465, ssl: true, tls: false, note: '需开启应用专用密码' },
    { name: 'Outlook', host: 'smtp.office365.com', port: 587, ssl: false, tls: true, note: '' },
  ];
  
  const presetOptions = presets.map(p => 
    `<option value="${p.host}" data-port="${p.port}" data-ssl="${p.ssl}" data-tls="${p.tls}">${p.name}</option>`
  ).join('');
  
  return `
    <div class="form-group"><label>配置名称</label><input class="form-input" id="smtpName" value="${cfg.name || ''}" placeholder="如：公司企业邮箱"></div>
    
    <div class="form-group">
      <label>快速选择 <span style="color:#aaa;font-weight:normal">(可选)</span></label>
      <select class="form-select" id="smtpPreset" onchange="applySmtpPreset()">
        <option value="">-- 手动输入 --</option>
        ${presetOptions}
      </select>
      <div id="presetNote" style="font-size:12px;color:var(--primary);margin-top:4px;display:none"></div>
    </div>
    
    <div class="form-row">
      <div class="form-group"><label>SMTP 服务器</label><input class="form-input" id="smtpHost" value="${cfg.host || ''}" placeholder="smtp.example.com"></div>
      <div class="form-group"><label>端口</label><input class="form-input" id="smtpPort" value="${cfg.port || 465}" type="number"></div>
    </div>
    
    <div class="form-group"><label>用户名</label><input class="form-input" id="smtpUser" value="${cfg.username || ''}" placeholder="your@email.com"></div>
    <div class="form-group"><label>密码</label><input class="form-input" id="smtpPass" type="password" value="${cfg.password || ''}" placeholder="邮箱密码或授权码"></div>
    
    <div style="background:var(--bg);padding:12px;border-radius:8px;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">加密方式：</div>
      <div class="form-row">
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="smtpSSL" ${cfg.use_ssl ? 'checked' : ''}> 使用 SSL (推荐 465 端口)</label></div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="smtpTLS" ${cfg.use_tls ? 'checked' : ''}> 使用 TLS (推荐 587 端口)</label></div>
      </div>
      <div id="encryptionHint" style="font-size:12px;color:var(--primary);margin-top:8px"></div>
    </div>
    
    <div class="form-group">
      <label class="checkbox-label"><input type="checkbox" id="smtpDefault" ${cfg.is_default ? 'checked' : ''}> 设为默认</label>
      <!-- v2.48 需求4：这里的说明文字已按要求删除；"默认全局唯一 + 只剩一条时自动为默认"仍由后端 enforceSoleConfigIsDefault 保证 -->
    </div>
  `;
}

// Global variable to store presets
const SMTP_PRESETS = [
  { name: 'QQ邮箱', host: 'smtp.qq.com', port: 465, ssl: true, tls: false, note: '⚠️ 需使用授权码，非登录密码。获取方式：QQ邮箱设置 → 账户 → POP3/IMAP/SMTP服务 → 生成授权码' },
  { name: '163邮箱', host: 'smtp.163.com', port: 465, ssl: true, tls: false, note: '⚠️ 需使用客户端授权码。获取方式：163邮箱设置 → POP3/SMTP/IMAP → 开启服务并获取授权码' },
  { name: '阿里云企业邮箱', host: 'smtp.qiye.aliyun.com', port: 465, ssl: true, tls: false, note: '✅ 使用正常登录密码' },
  { name: 'Gmail', host: 'smtp.gmail.com', port: 465, ssl: true, tls: false, note: '⚠️ 需开启"应用专用密码"。获取方式：Google账户安全设置 → 应用专用密码' },
  { name: 'Outlook/Office365', host: 'smtp.office365.com', port: 587, ssl: false, tls: true, note: '✅ 使用正常登录密码' },
];

window.applySmtpPreset = function() {
  const select = document.getElementById('smtpPreset');
  const selectedOption = select.options[select.selectedIndex];
  const host = selectedOption.value;
  
  if (!host) {
    document.getElementById('presetNote').style.display = 'none';
    return;
  }
  
  const preset = SMTP_PRESETS.find(p => p.host === host);
  if (!preset) return;
  
  // Auto-fill form fields
  document.getElementById('smtpHost').value = preset.host;
  document.getElementById('smtpPort').value = preset.port;
  document.getElementById('smtpSSL').checked = preset.ssl;
  document.getElementById('smtpTLS').checked = preset.tls;
  
  // Show note
  const noteDiv = document.getElementById('presetNote');
  noteDiv.textContent = preset.note;
  noteDiv.style.display = 'block';
  
  // Update encryption hint
  updateEncryptionHint();
};

function updateEncryptionHint() {
  const useSSL = document.getElementById('smtpSSL').checked;
  const useTLS = document.getElementById('smtpTLS').checked;
  const port = parseInt(document.getElementById('smtpPort').value) || 465;
  const hintDiv = document.getElementById('encryptionHint');
  
  if (useSSL && useTLS) {
    hintDiv.textContent = '⚠️ 警告：SSL 和 TLS 不能同时启用！请只选择一个。';
    hintDiv.style.color = 'var(--danger)';
  } else if (useSSL && port !== 465) {
    hintDiv.textContent = `💡 提示：SSL 通常使用 465 端口，当前端口为 ${port}`;
    hintDiv.style.color = 'var(--warning)';
  } else if (useTLS && port !== 587) {
    hintDiv.textContent = `💡 提示：TLS 通常使用 587 端口，当前端口为 ${port}`;
    hintDiv.style.color = 'var(--warning)';
  } else if (!useSSL && !useTLS) {
    hintDiv.textContent = '⚠️ 警告：未选择任何加密方式，邮件将以明文发送（不安全）！';
    hintDiv.style.color = 'var(--danger)';
  } else {
    hintDiv.textContent = '✅ 配置正确';
    hintDiv.style.color = 'var(--success)';
  }
}

function readSmtpForm() {
  return {
    name: document.getElementById('smtpName').value.trim(),
    host: document.getElementById('smtpHost').value.trim(),
    port: parseInt(document.getElementById('smtpPort').value) || 465,
    username: document.getElementById('smtpUser').value.trim(),
    password: document.getElementById('smtpPass').value,
    use_ssl: document.getElementById('smtpSSL').checked,
    use_tls: document.getElementById('smtpTLS').checked,
    is_default: document.getElementById('smtpDefault').checked,
  };
}

async function loadSmtpList() {
  const res = await api.get('/api/smtp/configs');
  smtpAllData = res.code === 0 ? res.data : [];
  renderSmtpPage();
}

/** v2.47 需求2.1：当前选中那条配置；删除或数据刷新后不在列表里时为 null */
function getSelectedSmtp() {
  return smtpAllData.find(c => c.id === selectedSmtpId) || null;
}

function updateSmtpToolbar() {
  const cfg = getSelectedSmtp();
  ['btnSmtpTest', 'btnSmtpDelete'].forEach(bid => {
    const el = document.getElementById(bid);
    if (!el) return;
    el.disabled = !cfg;
    el.title = cfg ? `对"${cfg.name}"执行${el.textContent.trim()}` : '请先单击选中一条配置';
  });
}

window.rowSelectSmtp = function(id) {
  selectedSmtpId = id;
  document.querySelectorAll('#smtpList tr').forEach(tr => {
    tr.classList.toggle('row-selected', Number(tr.dataset.sid) === id);
  });
  updateSmtpToolbar();
};

function renderSmtpPage() {
  const tbody = document.getElementById('smtpList');
  const total = smtpAllData.length;
  const totalPages = Math.ceil(total / smtpPageSize) || 1;
  if (smtpPage > totalPages) smtpPage = totalPages;
  const start = (smtpPage - 1) * smtpPageSize;
  const pageData = smtpAllData.slice(start, start + smtpPageSize);
  if (!smtpAllData.some(c => c.id === selectedSmtpId)) selectedSmtpId = null;

  if (pageData.length > 0) {
    tbody.innerHTML = pageData.map(c => `<tr class="clickable-row${c.id === selectedSmtpId ? ' row-selected' : ''}" data-sid="${c.id}" title="单击选中该配置并用上方工具栏操作，双击编辑" onclick="rowSelectSmtp(${c.id})" ondblclick="editSmtp(${c.id})">
      <td>${c.name}</td>
      <td>${c.host}</td>
      <td>${c.port}</td>
      <td>${c.username}</td>
      <td>${c.use_ssl ? '✅' : '❌'}</td>
      <td>${c.is_default ? '<span class="badge badge-success">默认</span>' : ''}</td>
    </tr>`).join('');
  } else {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>暂无 SMTP 配置，请添加</p></td></tr>';
  }
  updateSmtpToolbar();

  const pagDiv = document.getElementById('smtpPagination');
  if (pagDiv) {
    pagDiv.innerHTML = `
      <span>共 ${total} 条配置，第 ${smtpPage}/${totalPages} 页</span>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="smtpPageSizeSelect" class="form-select" style="padding:4px 8px;font-size:13px">
          <option value="5" ${smtpPageSize === 5 ? 'selected' : ''}>5条/页</option>
          <option value="10" ${smtpPageSize === 10 ? 'selected' : ''}>10条/页</option>
          <option value="15" ${smtpPageSize === 15 ? 'selected' : ''}>15条/页</option>
          <option value="20" ${smtpPageSize === 20 ? 'selected' : ''}>20条/页</option>
        </select>
        <button class="btn btn-sm btn-secondary" ${smtpPage <= 1 ? 'disabled' : ''} onclick="smtpPage--;renderSmtpPage()">上一页</button>
        <button class="btn btn-sm btn-secondary" ${smtpPage >= totalPages ? 'disabled' : ''} onclick="smtpPage++;renderSmtpPage()">下一页</button>
      </div>
    `;
    document.getElementById('smtpPageSizeSelect').onchange = function() {
      smtpPageSize = parseInt(this.value);
      smtpPage = 1;
      renderSmtpPage();
    };
  }
}

window.editSmtp = async function(id) {
  let cfg = smtpAllData.find(c => c.id === id);
  if (!cfg) {
    const res = await api.get('/api/smtp/configs');
    cfg = (res.data || []).find(c => c.id === id);
  }
  if (!cfg) return;
  Modal.show({
    title: '编辑 SMTP 配置',
    content: smtpFormHTML(cfg),
    confirmText: '保存',
    onConfirm: async () => {
      const data = readSmtpForm();
      // Validate SSL/TLS configuration
      if (!data.use_ssl && !data.use_tls) {
        showToast('请至少选择一种加密方式（SSL 或 TLS）', 'error');
        return;
      }
      if (data.use_ssl && data.use_tls) {
        showToast('SSL 和 TLS 不能同时启用，请只选择一个', 'error');
        return;
      }
      const r = await api.put(`/api/smtp/configs/${id}`, data);
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      loadSmtpList();
    },
    onOpen: () => {
      // Add event listeners for real-time validation
      setTimeout(() => {
        ['smtpSSL', 'smtpTLS', 'smtpPort'].forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            el.onchange = updateEncryptionHint;
            if (id === 'smtpPort') el.oninput = updateEncryptionHint;
          }
        });
        // Initial hint update
        updateEncryptionHint();
      }, 100);
    }
  });
};

window.testSmtp = function(id) {
  Modal.show({
    title: '发送测试邮件',
    content: '<div class="form-group"><label>收件人邮箱</label><input class="form-input" id="testToEmail" placeholder="test@example.com"></div>',
    confirmText: '发送',
    onConfirm: async () => {
      const to_email = document.getElementById('testToEmail').value.trim();
      if (!to_email) { showToast('请输入收件人邮箱', 'error'); return; }
      const r = await api.post('/api/smtp/test', { smtp_config_id: id, to_email, subject: '测试邮件', body: '这是一封测试邮件，来自外贸邮件发送系统。' });
      showToast(r.message, r.code === 0 ? 'success' : 'error');
    }
  });
};

window.deleteSmtp = function(id) {
  const cfg = smtpAllData.find(c => c.id === id);
  Modal.show({
    title: '确认删除',
    content: `<p>确定要删除 SMTP 配置${cfg ? ` "${escHtml(cfg.name)}"` : ''}吗？</p>`,
    confirmText: '删除',
    onConfirm: async () => {
      const r = await api.del(`/api/smtp/configs/${id}`);
      if (id === selectedSmtpId) selectedSmtpId = null;
      showToast(r.message, 'success');
      loadSmtpList();
    }
  });
};

async function bindSmtpEvents() {
  await loadSmtpList();

  // v2.47 需求2.1：工具栏两枚按钮作用于当前单击选中的那条配置
  document.getElementById('btnSmtpTest').onclick = () => {
    const cfg = getSelectedSmtp();
    if (!cfg) { showToast('请先单击选中一条配置', 'error'); return; }
    testSmtp(cfg.id);
  };
  document.getElementById('btnSmtpDelete').onclick = () => {
    const cfg = getSelectedSmtp();
    if (!cfg) { showToast('请先单击选中一条配置', 'error'); return; }
    deleteSmtp(cfg.id);
  };

  document.getElementById('btnAddSmtp').onclick = () => {
    Modal.show({
      title: '添加 SMTP 配置',
      content: smtpFormHTML(),
      confirmText: '添加',
      onConfirm: async () => {
        const data = readSmtpForm();
        if (!data.name || !data.host || !data.username || !data.password) {
          showToast('请填写完整信息', 'error');
          return;
        }
        // Validate SSL/TLS configuration
        if (!data.use_ssl && !data.use_tls) {
          showToast('请至少选择一种加密方式（SSL 或 TLS）', 'error');
          return;
        }
        if (data.use_ssl && data.use_tls) {
          showToast('SSL 和 TLS 不能同时启用，请只选择一个', 'error');
          return;
        }
        const r = await api.post('/api/smtp/configs', data);
        showToast(r.message, r.code === 0 ? 'success' : 'error');
        loadSmtpList();
      },
      onOpen: () => {
        // Add event listeners for real-time validation
        setTimeout(() => {
          ['smtpSSL', 'smtpTLS', 'smtpPort'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
              el.onchange = updateEncryptionHint;
              if (id === 'smtpPort') el.oninput = updateEncryptionHint;
            }
          });
        }, 100);
      }
    });
  };
}
