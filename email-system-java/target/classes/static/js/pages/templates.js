function TemplatesPage() {
  return `
    <div class="page-header">
      <h1>邮件模板</h1>
      <button class="btn btn-primary" id="btnAddTemplate">+ 创建模板</button>
    </div>
    <div id="templateList"></div>
    <div class="card" style="margin-top:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="font-size:16px">变量管理</h3>
        <button class="btn btn-sm btn-primary" id="btnAddVariable">+ 添加变量</button>
      </div>
      <div id="variableList"></div>
    </div>
  `;
}

/* v2.22：模板列表与变量管理分页（与其他界面一致的 renderPagination，默认每页 5 条） */
let templatePage = 1;
let templatePageSize = 5;
let variablePage = 1;
let variablePageSize = 5;

function clampPage(page, total, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return page > totalPages ? totalPages : Math.max(1, page);
}

async function loadTemplateList() {
  const res = await api.get('/api/templates');
  const container = document.getElementById('templateList');
  const data = res.code === 0 ? res.data : [];
  templatePage = clampPage(templatePage, data.length, templatePageSize);
  const pageItems = data.slice((templatePage - 1) * templatePageSize, templatePage * templatePageSize);
  const pagBar = data.length > templatePageSize ? `
    <div class="card" style="padding:14px 24px"><div class="pag-bar" style="margin-top:0">${renderPagination({
      total: data.length, page: templatePage, pageSize: templatePageSize, unit: '个模板',
      gotoFn: 'gotoTemplatePage', sizeFn: 'setTemplatePageSize',
    })}</div></div>` : '';
  if (pageItems.length > 0) {
    container.innerHTML = pageItems.map(t => {
      let vars = [];
      try { vars = JSON.parse(t.variables || '[]'); } catch(e) {}
      const fmtFull = v => v ? String(v).replace('T', ' ').substring(0, 19) : '-';
      return `<div class="card template-card">
        <div class="template-card-info">
          <div class="template-card-row">
            <h3 class="template-card-name">${t.name}</h3>
            <div class="template-card-dates">
              <span title="创建时间 ${fmtFull(t.created_at)}">创建时间: ${fmtFull(t.created_at)}</span>
              <span title="更新时间 ${fmtFull(t.updated_at)}">更新时间: ${fmtFull(t.updated_at)}</span>
            </div>
          </div>
          <div class="template-card-subject" title="主题: ${t.subject}">主题: ${t.subject}</div>
          <div class="template-card-vars">变量: ${vars.length > 0 ? vars.map(v => `<span class="badge badge-info" style="margin-right:4px">\${${v}}</span>`).join('') : '<span style="color:#aaa">无</span>'}</div>
        </div>
        <div class="toolbar">
          <button class="btn btn-sm btn-secondary" onclick="previewTemplate(${t.id})">预览</button>
          <button class="btn btn-sm btn-secondary" onclick="editTemplate(${t.id})">编辑</button>
          <button class="btn btn-sm btn-secondary" onclick="duplicateTemplate(${t.id})">复制</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTemplate(${t.id})">删除</button>
        </div>
      </div>`;
    }).join('') + pagBar;
  } else {
    container.innerHTML = '<div class="empty-state"><p>暂无邮件模板，点击上方按钮创建</p></div>';
  }
}

window.gotoTemplatePage = function(p) {
  templatePage = p;
  loadTemplateList();
};

window.setTemplatePageSize = function(s) {
  templatePageSize = parseInt(s);
  templatePage = 1;
  loadTemplateList();
};

async function loadVariableList() {
  const res = await api.get('/api/variables');
  const container = document.getElementById('variableList');
  if (!container) return;
  const data = res.code === 0 ? res.data : [];
  variablePage = clampPage(variablePage, data.length, variablePageSize);
  const pageItems = data.slice((variablePage - 1) * variablePageSize, variablePage * variablePageSize);
  if (pageItems.length > 0) {
    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>变量名</th><th>描述</th><th>示例值</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            ${pageItems.map(v => `
              <tr>
                <td><code>\${${v.name}}</code></td>
                <td>${v.description || '-'}</td>
                <td>${v.example_value || '-'}</td>
                <td style="font-size:12px;color:#aaa">${(v.created_at || '').replace('T', ' ').substring(0, 19)}</td>
                <td>
                  <button class="btn btn-sm btn-secondary" onclick="editVariable(${v.id})">编辑</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteVariable(${v.id})">删除</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${data.length > variablePageSize ? `<div class="pag-bar">${renderPagination({
        total: data.length, page: variablePage, pageSize: variablePageSize, unit: '个变量',
        gotoFn: 'gotoVariablePage', sizeFn: 'setVariablePageSize',
      })}</div>` : ''}
    `;
  } else {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary)">暂无变量，点击上方按钮添加</div>';
  }
}

window.gotoVariablePage = function(p) {
  variablePage = p;
  loadVariableList();
};

window.setVariablePageSize = function(s) {
  variablePageSize = parseInt(s);
  variablePage = 1;
  loadVariableList();
};

function templateEditorHTML(t = {}) {
  return `
    <div class="template-form">
    <div class="form-group form-group-inline"><label>模板名称</label><input class="form-input" id="tName" value="${t.name || ''}" placeholder="如：开发信模板"></div>
    <div class="form-group form-group-inline"><label>邮件主题</label><input class="form-input" id="tSubject" value="${t.subject || ''}" placeholder="支持变量: \${cust_name}, \${cust_company}"></div>
    <div class="form-group">
      <label>邮件正文</label>
      <div class="editor-toolbar">
        <div class="editor-toolbar-group">
          <select class="editor-select" id="tFontFamily" title="字体" onchange="applyFontFamily(this.value)">
            <option value="">字体</option>
            <option value="Arial, Helvetica, sans-serif">Arial</option>
            <option value="'Times New Roman', Times, serif">Times New Roman</option>
            <option value="'Courier New', Courier, monospace">Courier New</option>
            <option value="Verdana, Geneva, sans-serif">Verdana</option>
            <option value="Tahoma, Geneva, sans-serif">Tahoma</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="'Microsoft YaHei', '微软雅黑', sans-serif">微软雅黑</option>
            <option value="'SimSun', '宋体', serif">宋体</option>
            <option value="'SimHei', '黑体', sans-serif">黑体</option>
            <option value="'KaiTi', '楷体', serif">楷体</option>
          </select>
          <select class="editor-select" id="tFontSize" title="字号" onchange="applyFontSize(this.value)">
            <option value="">字号</option>
            <option value="1">小 (8pt)</option>
            <option value="2">较小 (10pt)</option>
            <option value="3" selected>正常 (12pt)</option>
            <option value="4">中 (14pt)</option>
            <option value="5">大 (18pt)</option>
            <option value="6">很大 (24pt)</option>
            <option value="7">特大 (36pt)</option>
          </select>
        </div>

        <span class="editor-divider"></span>

        <div class="editor-toolbar-group">
          <button class="editor-btn" onclick="document.execCommand('bold')" title="加粗 Ctrl+B"><b>B</b></button>
          <button class="editor-btn" onclick="document.execCommand('italic')" title="斜体 Ctrl+I"><i>I</i></button>
          <button class="editor-btn" onclick="document.execCommand('underline')" title="下划线 Ctrl+U"><u>U</u></button>
          <button class="editor-btn" onclick="document.execCommand('strikeThrough')" title="删除线"><s>S</s></button>
        </div>

        <span class="editor-divider"></span>

        <div class="editor-toolbar-group">
          <label class="editor-color" title="文字颜色">
            <span style="color:#333">A</span>
            <input type="color" id="tForeColor" value="#333333" onchange="applyForeColor(this.value)">
          </label>
          <label class="editor-color" title="背景颜色">
            <span style="background:#ffff00;padding:0 4px">A</span>
            <input type="color" id="tBackColor" value="#ffff00" onchange="applyBackColor(this.value)">
          </label>
          <button class="editor-btn" onclick="clearFormat()" title="清除格式">✕ 清除</button>
        </div>

        <span class="editor-divider"></span>

        <div class="editor-toolbar-group">
          <button class="editor-btn" onclick="outdentText()" title="减少缩进">⇤ 减缩进</button>
          <button class="editor-btn" onclick="indentText()" title="增加缩进">⇥ 缩进</button>
        </div>

        <span class="editor-divider"></span>

        <div class="editor-toolbar-group">
          <button class="editor-btn" onclick="document.execCommand('insertUnorderedList')" title="无序列表">• 列表</button>
          <button class="editor-btn" onclick="document.execCommand('insertOrderedList')" title="有序列表">1. 列表</button>
        </div>

        <span class="editor-divider"></span>

        <div class="editor-toolbar-group">
          <button class="editor-btn" onclick="applyAlign('justifyLeft')" title="左对齐">⬅</button>
          <button class="editor-btn" onclick="applyAlign('justifyCenter')" title="居中">↔</button>
          <button class="editor-btn" onclick="applyAlign('justifyRight')" title="右对齐">➡</button>
        </div>

        <span class="editor-divider"></span>

        <div class="editor-toolbar-group">
          <select class="editor-select" id="tParaSpacing" title="段落间距（作用于光标所在段落，或选中的多个段落）" onchange="applyParagraphSpacing(this.value)">
            <option value="">段间距</option>
            <option value="0">无</option>
            <option value="6">小 6px</option>
            <option value="12">中 12px</option>
            <option value="20">大 20px</option>
            <option value="30">特大 30px</option>
          </select>
          <select class="editor-select" id="tLineHeight" title="行间距（段落内每行之间的距离）" onchange="applyLineHeight(this.value)">
            <option value="">行间距</option>
            <option value="1">1.0 倍</option>
            <option value="1.2">1.2 倍</option>
            <option value="1.5">1.5 倍</option>
            <option value="1.8">1.8 倍</option>
            <option value="2">2.0 倍</option>
            <option value="2.5">2.5 倍</option>
            <option value="3">3.0 倍</option>
          </select>
        </div>

        <span class="editor-divider"></span>

        <div class="editor-toolbar-group">
          <button class="editor-btn" onclick="insertLink()" title="插入链接">🔗 链接</button>
          <button class="editor-btn img-btn" onclick="showImageMenu()" title="插入图片">🖼 图片</button>
        </div>
      </div>
      <div class="editor-content" id="tBody" contenteditable="true">${t.body || ''}</div>
    </div>
    <div class="form-group">
      <label>可用变量 <span style="color:#aaa;font-weight:normal">(双击变量名可插入到光标位置)</span></label>
      <div id="availableVars" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;padding:12px;background:var(--bg);border-radius:8px">
        <span style="color:var(--text-secondary);font-size:13px">加载中...</span>
      </div>
    </div>
    </div>
  `;
}

/* ---------- 富文本编辑辅助函数 ---------- */

// 保存/恢复选区：点击工具栏时会丢失编辑器焦点，需要先缓存选区
let _savedRange = null;

// 记录最后一次获得焦点的插入目标：'subject'（邮件主题）或 'body'（邮件正文）
// 用于双击变量时判断应插入到哪个输入框
let _lastVarTarget = 'body';

// 缓存「邮件主题」的光标位置。部分浏览器在输入框失焦后会重置 selectionStart，
// 因此在其失焦/按键/点击时主动记录，确保双击变量时能插回原位置。
let _subjectCaret = null;

function saveEditorSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const editor = document.getElementById('tBody');
    if (editor && editor.contains(range.commonAncestorContainer)) {
      _savedRange = range.cloneRange();
    }
  }
}

function restoreEditorSelection() {
  const editor = document.getElementById('tBody');
  if (editor && _savedRange) {
    editor.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_savedRange);
  }
}

function applyFontFamily(family) {
  if (!family) return;
  restoreEditorSelection();
  document.execCommand('fontName', false, family);
  saveEditorSelection();
}

function applyFontSize(size) {
  if (!size) return;
  restoreEditorSelection();
  document.execCommand('fontSize', false, size);
  saveEditorSelection();
}

function applyForeColor(color) {
  restoreEditorSelection();
  document.execCommand('foreColor', false, color);
  saveEditorSelection();
}

function applyBackColor(color) {
  restoreEditorSelection();
  document.execCommand('backColor', false, color);
  saveEditorSelection();
}

function applyAlign(cmd) {
  restoreEditorSelection();
  document.execCommand(cmd, false, null);
  saveEditorSelection();
}

/* ---------- 段落间距 / 行间距 ---------- */

// 段落级属性作用的块级元素
const _BLOCK_SELECTOR = 'p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre';
const _BLOCK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']);

/**
 * 解析当前选区涉及的块级元素，仅返回最内层（真正的段落/列表项）。
 *
 * @param {HTMLElement} editor 编辑器根节点
 * @param {boolean} wrap 当光标处没有块级元素时，是否自动包裹为 <p>。
 *        仅在应用样式时传 true；读取状态时传 false，避免仅移动光标就改动内容。
 * @returns {HTMLElement[]}
 */
function resolveSelectedBlocks(editor, wrap = false) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor) return [];
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return [];

  // 非折叠选区：取出范围内命中的块，再剔除「包含其它命中块」的祖先，保留最内层
  if (!range.collapsed) {
    const hit = Array.from(editor.querySelectorAll(_BLOCK_SELECTOR))
      .filter(el => range.intersectsNode(el));
    const innermost = hit.filter(el => !hit.some(o => o !== el && el.contains(o)));
    if (innermost.length > 0) return innermost;
  }

  // 折叠选区（光标）或未命中块：向上寻找最近的块级祖先
  const findAncestorBlock = (node) => {
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== editor) {
      if (node.nodeType === Node.ELEMENT_NODE && _BLOCK_TAGS.has(node.tagName.toLowerCase())) return node;
      node = node.parentNode;
    }
    return null;
  };

  const ancestor = findAncestorBlock(range.startContainer);
  if (ancestor) return [ancestor];

  if (!wrap) return [];

  // 无块级祖先：把当前行包裹为段落，再重新定位
  document.execCommand('formatBlock', false, 'p');
  const sel2 = window.getSelection();
  if (sel2 && sel2.rangeCount > 0) {
    const wrapped = findAncestorBlock(sel2.getRangeAt(0).startContainer);
    if (wrapped) return [wrapped];
  }
  return [];
}

/**
 * 设置段落间距（段与段之间的距离）。
 * 统一由 margin-bottom 控制、margin-top 置 0，避免相邻段落间距叠加。
 * @param {string} px 像素值，"0" 表示无间距；空字符串表示未选择
 */
function applyParagraphSpacing(px) {
  if (px === '') return;
  restoreEditorSelection();
  const editor = document.getElementById('tBody');
  const blocks = resolveSelectedBlocks(editor, true);
  if (blocks.length === 0) return;

  const value = px + 'px';
  blocks.forEach(b => {
    b.style.marginTop = '0px';
    b.style.marginBottom = value;
  });
  saveEditorSelection();
  syncSpacingControls();
}

/**
 * 设置段落内的行间距（line-height）。
 * @param {string} ratio 倍数，如 "1.5"；空字符串表示未选择
 */
function applyLineHeight(ratio) {
  if (ratio === '') return;
  restoreEditorSelection();
  const editor = document.getElementById('tBody');
  const blocks = resolveSelectedBlocks(editor, true);
  if (blocks.length === 0) return;

  blocks.forEach(b => { b.style.lineHeight = ratio; });
  saveEditorSelection();
  syncSpacingControls();
}

/**
 * 将光标所在段落当前的间距设置回显到工具栏下拉框。
 * 多段落取值不一致时置空，避免误导。
 */
function syncSpacingControls() {
  const paraSel = document.getElementById('tParaSpacing');
  const lineSel = document.getElementById('tLineHeight');
  if (!paraSel || !lineSel) return;

  const editor = document.getElementById('tBody');
  const blocks = resolveSelectedBlocks(editor, false);  // 只读，不修改内容
  if (blocks.length === 0) {
    paraSel.value = '';
    lineSel.value = '';
    return;
  }

  const margins = new Set(blocks.map(b => (b.style.marginBottom || '0').replace('px', '')));
  const lines = new Set(blocks.map(b => b.style.lineHeight || ''));
  paraSel.value = margins.size === 1 ? Array.from(margins)[0] : '';
  lineSel.value = lines.size === 1 ? Array.from(lines)[0] : '';
}

// 增加缩进：优先作用于当前段落
function indentText() {
  restoreEditorSelection();
  const sel = window.getSelection();
  const editor = document.getElementById('tBody');
  if (!sel || sel.rangeCount === 0 || !editor) return;

  // 选中内容含块级元素时用块级缩进，否则用行内缩进
  const range = sel.getRangeAt(0);
  const blockTags = ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE'];
  let node = range.commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  let hasBlock = false;
  if (node && blockTags.includes(node.tagName)) hasBlock = true;
  else if (node && node.querySelector && node.querySelector(blockTags.join(','))) hasBlock = true;

  if (hasBlock) {
    document.execCommand('indent', false, null);
  } else {
    document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
  }
  saveEditorSelection();
}

// 减少缩进
function outdentText() {
  restoreEditorSelection();
  document.execCommand('outdent', false, null);
  saveEditorSelection();
}

function clearFormat() {
  restoreEditorSelection();
  document.execCommand('removeFormat', false, null);
  // removeFormat 仅清除行内样式，块级的段落间距/行间距需单独重置
  const editor = document.getElementById('tBody');
  resolveSelectedBlocks(editor, false).forEach(b => {
    b.style.marginTop = '';
    b.style.marginBottom = '';
    b.style.lineHeight = '';
  });
  saveEditorSelection();
  syncSpacingControls();
}

// 记录选区变化，供工具栏操作使用；同时回显段落间距设置
function bindEditorSelectionTracking() {
  const editor = document.getElementById('tBody');
  if (!editor) return;
  const onSelectionChange = () => {
    saveEditorSelection();
    syncSpacingControls();
  };
  editor.addEventListener('keyup', onSelectionChange);
  editor.addEventListener('mouseup', onSelectionChange);
  editor.addEventListener('focus', onSelectionChange);
  editor.addEventListener('blur', saveEditorSelection);
}

/**
 * 跟踪「邮件主题」与「邮件正文」的焦点，用于判断双击变量时应插入到哪个位置。
 * 同时也跟踪主题框的光标位置（用 selectionStart 记录）。
 */
function bindVariableTargetTracking() {
  const subjectInput = document.getElementById('tSubject');
  const editor = document.getElementById('tBody');

  if (subjectInput) {
    const markSubject = () => {
      _lastVarTarget = 'subject';
      // 记录当前光标位置，供失焦后双击变量插回
      if (subjectInput.selectionStart != null) {
        _subjectCaret = subjectInput.selectionStart;
      }
    };
    subjectInput.addEventListener('focus', markSubject);
    subjectInput.addEventListener('click', markSubject);
    subjectInput.addEventListener('keyup', markSubject);
    // blur 时最后再记录一次，防止浏览器重置 selectionStart
    subjectInput.addEventListener('blur', markSubject);
  }

  if (editor) {
    const markBody = () => { _lastVarTarget = 'body'; };
    editor.addEventListener('focus', markBody);
    editor.addEventListener('click', markBody);
    editor.addEventListener('keyup', markBody);
  }
}

function insertLink() {
  const url = prompt('请输入链接地址:', 'https://');
  if (url) document.execCommand('createLink', false, url);
}

function showImageMenu() {
  const overlay = document.createElement('div');
  overlay.className = 'img-menu-overlay';
  overlay.innerHTML = `
    <div class="img-menu-box">
      <div class="img-menu-title">插入图片</div>
      <button class="img-menu-option" id="imgByUrl">🔗 通过 URL 插入</button>
      <button class="img-menu-option" id="imgUpload">📁 本地上传</button>
      <button class="img-menu-cancel" id="imgMenuCancel">取消</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#imgMenuCancel').onclick = () => overlay.remove();
  overlay.querySelector('#imgByUrl').onclick = () => { overlay.remove(); insertImageByUrl(); };
  overlay.querySelector('#imgUpload').onclick = () => { overlay.remove(); uploadAndInsertImage(); };
}

function insertImageByUrl() {
  const url = prompt('请输入图片地址:', 'https://');
  if (url && url.trim()) {
    const editor = document.getElementById('tBody');
    editor.focus();
    document.execCommand('insertImage', false, url.trim());
  }
}

function uploadAndInsertImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      const editor = document.getElementById('tBody');
      editor.focus();
      document.execCommand('insertImage', false, e.target.result);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function loadAvailableVars() {
  const container = document.getElementById('availableVars');
  if (!container) return;

  const builtInVars = [
    { name: 'cust_name', description: '客户姓名' },
    { name: 'cust_email', description: '客户邮箱' },
    { name: 'cust_company', description: '客户公司' },
    { name: 'cust_phone', description: '客户电话' },
    { name: 'cust_country', description: '客户国家' },
    { name: 'cust_tags', description: '客户标签' },
    { name: 'cust_notes', description: '客户备注' },
  ];

  const res = await api.get('/api/variables');
  const customVars = res.code === 0 ? res.data : [];

  let html = '<div style="margin-bottom:8px"><strong style="font-size:12px;color:var(--text-secondary)">系统变量:</strong></div>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">';
  html += builtInVars.map(v => `
    <span class="var-badge" data-var="${v.name}" title="${v.description}" style="cursor:pointer;background:#E8F5E9;color:#2E7D32">
      \${${v.name}}
    </span>
  `).join('');
  html += '</div>';

  if (customVars.length > 0) {
    html += '<div style="margin-bottom:8px"><strong style="font-size:12px;color:var(--text-secondary)">自定义变量:</strong></div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
    html += customVars.map(v => `
      <span class="var-badge" data-var="${v.name}" title="${v.description || ''} - 示例: ${v.example_value || ''}" style="cursor:pointer">
        \${${v.name}}
      </span>
    `).join('');
    html += '</div>';
  } else {
    html += '<span style="color:var(--text-secondary);font-size:13px">暂无自定义变量，请在下方"变量管理"中添加</span>';
  }

  container.innerHTML = html;

  container.querySelectorAll('.var-badge').forEach(badge => {
    badge.ondblclick = function() {
      const varName = this.dataset.var;
      insertVariable(`\${${varName}}`);
    };
  });
}

/**
 * 将变量插入到「最后编辑过的」输入框光标位置。
 * 双击变量标签时，焦点已转移到标签上，无法再用 document.activeElement 判断，
 * 因此依赖 _lastVarTarget 与缓存的光标/选区位置。
 * @param {string} varText 形如 ${cust_name} 的变量文本
 */
function insertVariable(varText) {
  const subjectInput = document.getElementById('tSubject');
  const editor = document.getElementById('tBody');

  // 优先插入到邮件主题（当它是我最后一次编辑的目标）
  if (_lastVarTarget === 'subject' && subjectInput) {
    insertTextAtCursor(subjectInput, varText);
    return;
  }

  // 否则插入到邮件正文的缓存光标位置
  if (editor) {
    insertIntoBodyAtCaret(editor, varText);
    return;
  }

  // 兜底：插入到主题框
  if (subjectInput) insertTextAtCursor(subjectInput, varText);
}

/** 在 <input>/<textarea> 的光标位置插入文本，并保持光标在插入内容之后 */
function insertTextAtCursor(input, text) {
  // 优先使用缓存的光标位置（输入框可能已失焦，selectionStart 变得不可靠）
  let start;
  if (_subjectCaret != null && _lastVarTarget === 'subject') {
    start = Math.min(_subjectCaret, input.value.length);
  } else {
    start = input.selectionStart != null ? input.selectionStart : input.value.length;
  }
  const end = (input.selectionEnd != null && input.selectionEnd >= start)
    ? input.selectionEnd
    : start;

  const value = input.value;
  input.value = value.substring(0, start) + text + value.substring(end);
  const caret = start + text.length;
  input.selectionStart = input.selectionEnd = caret;
  _subjectCaret = caret;   // 更新缓存，支持连续插入
  input.focus();
}

/**
 * 在 contenteditable 编辑器的缓存选区处插入纯文本。
 * 若没有缓存选区（从未在编辑器中定位），则追加到末尾。
 */
function insertIntoBodyAtCaret(editor, text) {
  editor.focus();

  const sel = window.getSelection();
  let range = null;

  // 优先使用缓存的选区（双击变量时编辑器已失焦，实时选区不可靠）
  if (_savedRange && editor.contains(_savedRange.commonAncestorContainer)) {
    range = _savedRange.cloneRange();
  } else if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0).cloneRange();
  }

  if (range) {
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    // 无可用选区：把光标放到编辑器末尾
    const endRange = document.createRange();
    endRange.selectNodeContents(editor);
    endRange.collapse(false);
    sel.removeAllRanges();
    sel.addRange(endRange);
    range = endRange;
  }

  // insertText 会继承当前格式；插入后手动更新缓存选区
  document.execCommand('insertText', false, text);
  saveEditorSelection();
}

async function bindTemplatesEvents() {
  await loadTemplateList();
  await loadVariableList();
  document.getElementById('btnAddTemplate').onclick = () => openTemplateEditor();
  document.getElementById('btnAddVariable').onclick = () => openVariableEditor();
}

function openTemplateEditor(t = {}, editId = null) {
  Modal.show({
    title: editId ? '编辑模板' : '创建模板',
    content: templateEditorHTML(t),
    wide: true,
    confirmText: editId ? '保存' : '创建',
    onConfirm: async () => {
      const name = document.getElementById('tName').value.trim();
      const subject = document.getElementById('tSubject').value.trim();
      const body = document.getElementById('tBody').innerHTML;
      if (!name || !subject) { showToast('名称和主题为必填', 'error'); return; }

      const fullText = subject + ' ' + document.getElementById('tBody').innerText;
      const varRes = await api.post('/api/templates/extract-variables', { text: fullText });
      const variables = varRes.code === 0 ? varRes.data : [];

      const data = { name, subject, body, variables };
      let r;
      if (editId) {
        r = await api.put(`/api/templates/${editId}`, data);
      } else {
        r = await api.post('/api/templates', data);
      }
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      loadTemplateList();
    }
  });

  setTimeout(() => {
    _savedRange = null;
    _lastVarTarget = 'body';   // 默认插入到正文
    _subjectCaret = null;
    bindEditorSelectionTracking();
    bindVariableTargetTracking();
    loadAvailableVars();
    syncSpacingControls();
  }, 100);
}

window.editTemplate = async function(id) {
  const res = await api.get('/api/templates');
  const t = res.data.find(x => x.id === id);
  if (!t) return;
  openTemplateEditor(t, id);
};

window.previewTemplate = async function(id) {
  const res = await api.get('/api/templates');
  const t = res.data.find(x => x.id === id);
  if (!t) return;

  const r = await api.post('/api/templates/preview', { subject: t.subject, body: t.body });
  if (r.code === 0) {
    Modal.show({
      title: '模板预览',
      content: `
        <div class="template-preview">
          <div class="preview-subject">${r.data.subject}</div>
          <hr style="margin:12px 0;border:none;border-top:1px solid var(--border)">
          <div class="preview-body">${r.data.body}</div>
        </div>
        <p style="margin-top:12px;font-size:12px;color:var(--text-secondary)">* 预览使用示例数据，实际发送时将替换为真实客户信息</p>
      `,
      large: true,
      confirmText: '',
      cancelText: '关闭'
    });
    document.getElementById('modalConfirm').style.display = 'none';
  }
};

window.duplicateTemplate = async function(id) {
  const r = await api.post(`/api/templates/${id}/duplicate`);
  showToast(r.message, r.code === 0 ? 'success' : 'error');
  loadTemplateList();
};

window.deleteTemplate = function(id) {
  Modal.show({
    title: '确认删除',
    content: '<p>确定要删除此模板吗？</p>',
    confirmText: '删除',
    onConfirm: async () => {
      const r = await api.del(`/api/templates/${id}`);
      showToast(r.message, 'success');
      loadTemplateList();
    }
  });
};

function variableEditorHTML(v = {}) {
  return `
    <div class="form-group"><label>变量名</label><input class="form-input" id="varName" value="${v.name || ''}" placeholder="如：product_name"></div>
    <div class="form-group"><label>描述</label><input class="form-input" id="varDesc" value="${v.description || ''}" placeholder="变量的用途说明"></div>
    <div class="form-group"><label>示例值</label><input class="form-input" id="varExample" value="${v.example_value || ''}" placeholder="如：iPhone 15 Pro"></div>
  `;
}

function openVariableEditor(v = {}, editId = null) {
  Modal.show({
    title: editId ? '编辑变量' : '添加变量',
    content: variableEditorHTML(v),
    confirmText: editId ? '保存' : '添加',
    onConfirm: async () => {
      const name = document.getElementById('varName').value.trim();
      if (!name) { showToast('变量名为必填', 'error'); return; }

      const data = {
        name,
        description: document.getElementById('varDesc').value.trim(),
        example_value: document.getElementById('varExample').value.trim(),
      };

      let r;
      if (editId) {
        r = await api.put(`/api/variables/${editId}`, data);
      } else {
        r = await api.post('/api/variables', data);
      }
      showToast(r.message, r.code === 0 ? 'success' : 'error');
      if (r.code === 0) {
        loadVariableList();
      }
    }
  });
}

window.editVariable = async function(id) {
  const res = await api.get('/api/variables');
  const v = res.data.find(x => x.id === id);
  if (!v) return;
  openVariableEditor(v, id);
};

window.deleteVariable = function(id) {
  Modal.show({
    title: '确认删除',
    content: '<p>确定要删除此变量吗？</p>',
    confirmText: '删除',
    onConfirm: async () => {
      const r = await api.del(`/api/variables/${id}`);
      showToast(r.message, 'success');
      loadVariableList();
    }
  });
};
