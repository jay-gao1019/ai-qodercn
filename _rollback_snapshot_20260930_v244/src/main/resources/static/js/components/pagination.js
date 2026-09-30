/**
 * 通用分页条：共 N 条 + 每页条数选择 + 上一页 + 阿拉伯数字页码 + 下一页。
 * 页码数量随当前每页记录数动态生成，点击页码跳转到对应页。
 */
function buildPageNumbers(current, totalPages) {
  const items = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) items.push(i);
    return items;
  }
  items.push(1);
  let start = Math.max(2, current - 2);
  let end = Math.min(totalPages - 1, current + 2);
  if (current <= 3) { start = 2; end = 5; }
  if (current >= totalPages - 2) { start = totalPages - 4; end = totalPages - 1; }
  if (start > 2) items.push('...');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < totalPages - 1) items.push('...');
  items.push(totalPages);
  return items;
}

/**
 * @param {object} opts
 *   total      总记录数
 *   page       当前页
 *   pageSize   每页条数
 *   unit       统计文案单位，如“位客户”
 *   gotoFn     点击页码/上下页调用的全局函数名，签名 fn(page)
 *   sizeFn     切换每页条数调用的全局函数名，签名 fn(size)；不传则不渲染下拉
 *   pageSizes  每页条数可选项，默认 [5,10,15,20]
 * @returns {string} HTML
 */
function renderPagination(opts) {
  const { total, page, pageSize, unit = '', gotoFn, sizeFn, pageSizes = [5, 10, 15, 20] } = opts;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const sizeSelect = sizeFn ? `
    <select class="form-select pag-size" onchange="${sizeFn}(this.value)">
      ${pageSizes.map(s => `<option value="${s}" ${s === pageSize ? 'selected' : ''}>${s}条/页</option>`).join('')}
    </select>` : '';

  const nums = buildPageNumbers(page, totalPages).map(p => p === '...'
    ? '<span class="pag-ellipsis">…</span>'
    : `<button class="pag-btn ${p === page ? 'active' : ''}" onclick="${gotoFn}(${p})">${p}</button>`
  ).join('');

  return `
    <span class="pag-info">共 ${total} ${unit}，第 ${page}/${totalPages} 页</span>
    <div class="pag-controls">
      ${sizeSelect}
      <button class="pag-btn" ${page <= 1 ? 'disabled' : ''} onclick="${gotoFn}(${page - 1})">‹ 上一页</button>
      ${nums}
      <button class="pag-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${gotoFn}(${page + 1})">下一页 ›</button>
    </div>
  `;
}
