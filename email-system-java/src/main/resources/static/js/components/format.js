/**
 * 全站共用的渲染格式化小工具。
 * 这些函数原先定义在 pages/campaigns.js 里，被其他页面跨文件调用，
 * 抽到 components 层后加载顺序不再影响可用性（v2.32 需求6）。
 */

/** HTML 转义：客户姓名/邮箱/公司/模板等资料均为自由文本，渲染前统一转义 */
function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 日期时间显示：后端 ISO 串统一成 "YYYY-MM-DD HH:mm:ss" */
function fmtDateTime(value) {
  return value ? String(value).replace('T', ' ').substring(0, 19) : '-';
}

/** 统计类数字：为 0 时统一显示"-"，避免满屏的 0 干扰阅读（v2.34 需求2 起沿用） */
function numOrDash(value) {
  return value > 0 ? value : '-';
}

/**
 * 任务状态徽章（v2.35 需求3.2）：五态文案由后端 display_status 决定，
 * 任务列表与仪表盘"任务发送统计"共用，避免两处口径漂移。
 */
const CAMPAIGN_STATUS_BADGES = {
  pending: '<span class="badge badge-info">待发送</span>',
  running: '<span class="badge badge-warning">发送中</span>',
  paused: '<span class="badge badge-muted">已暂停</span>',
  completed: '<span class="badge badge-success">已完成</span>',
  uncompleted: '<span class="badge badge-danger">未完成</span>',
};

function campaignStatusBadge(row) {
  const key = (row && (row.display_status || row.status)) || '';
  return CAMPAIGN_STATUS_BADGES[key] || escHtml(key || '-');
}
