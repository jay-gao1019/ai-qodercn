const Modal = {
  /**
   * 显示弹窗
   * @param {string}  title        标题
   * @param {string}  content      内容 HTML
   * @param {string}  confirmText  确认按钮文字
   * @param {string}  cancelText   取消按钮文字
   * @param {boolean} large        宽版（720px）
   * @param {boolean} compact     客户详情/编辑专用尺寸（778px），v2.44 需求 1 按"除备注外不换行"放宽
   * @param {boolean} wide         大尺寸：占视口 80% 宽高，屏幕居中
   * @param {boolean} hideConfirm  隐藏确认按钮（纯查看类弹窗）
   * @param {boolean} stacked      以叠加层显示，盖在当前弹窗之上（如创建任务时打开"选择客户"列表）
   * @param {Function} onConfirm   点击确认
   * @param {Function} onCancel    点击取消
   */
  show({ title, content, confirmText = '确认', cancelText = '取消', onConfirm, onCancel, large, compact, wide, hideConfirm, stacked }) {
    let root;
    if (stacked) {
      root = document.createElement('div');
      root.className = 'modal-stack';
      document.body.appendChild(root);
    } else {
      root = document.getElementById('modal-root');
    }
    const close = () => {
      root.innerHTML = '';
      if (stacked) root.remove();
    };
    const sizeClass = wide ? 'wide' : (large ? 'large' : (compact ? 'compact' : ''));
    // 叠加弹窗的按钮只带类名、不带 id：与底层弹窗共用同名 id 时，全局 getElementById 会命中底层弹窗的按钮
    const cls = stacked ? '-stack' : '';
    const openId = stacked ? '' : 'id="';
    const closeId = stacked ? '' : '"';
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-box ${sizeClass}">
          <div class="modal-title" ${openId}modalTitle${closeId}>${title}</div>
          <div class="modal-body">${content}</div>
          <div class="modal-actions">
            <button class="btn btn-secondary m-btn-cancel${cls}" ${openId}modalCancel${closeId}>${cancelText}</button>
            ${hideConfirm ? '' : `<button class="btn btn-primary m-btn-confirm${cls}" ${openId}modalConfirm${closeId}>${confirmText}</button>`}
          </div>
        </div>
      </div>
    `;
    const cancelBtn = root.querySelector(`.m-btn-cancel${cls}`);
    cancelBtn.onclick = () => { onCancel && onCancel(); close(); };
    // onConfirm 显式返回 true 时保持弹窗打开（用于详情弹窗内的“刷新”、表单校验不通过）
    const confirmBtn = root.querySelector(`.m-btn-confirm${cls}`);
    if (confirmBtn) confirmBtn.onclick = async () => {
      const keepOpen = await onConfirm?.();
      if (keepOpen !== true) close();
    };
    return root;
  },
  close() {
    document.getElementById('modal-root').innerHTML = '';
    document.querySelectorAll('.modal-stack').forEach(node => node.remove());
  },
};
