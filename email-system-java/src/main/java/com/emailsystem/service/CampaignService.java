package com.emailsystem.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.emailsystem.common.BusinessException;
import com.emailsystem.dto.request.CampaignCreateDTO;
import com.emailsystem.dto.response.StatsVO;
import com.emailsystem.entity.Campaign;
import com.emailsystem.entity.CampaignLog;
import com.emailsystem.entity.CampaignRun;
import com.emailsystem.entity.CampaignSendAttempt;
import com.emailsystem.entity.Customer;
import com.emailsystem.mapper.CampaignLogMapper;
import com.emailsystem.mapper.CampaignMapper;
import com.emailsystem.mapper.CampaignSendAttemptMapper;
import com.emailsystem.mapper.CustomerMapper;
import com.emailsystem.task.CampaignExecutor;
import com.emailsystem.task.CampaignTaskManager;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.RejectedExecutionException;

@Service
@RequiredArgsConstructor
public class CampaignService {

    private static final Logger log = LoggerFactory.getLogger(CampaignService.class);

    private final CampaignMapper campaignMapper;
    private final CampaignLogMapper campaignLogMapper;
    private final CampaignSendAttemptMapper campaignSendAttemptMapper;
    private final CustomerMapper customerMapper;
    private final CampaignTaskManager taskManager;
    private final CampaignExecutor campaignExecutor;
    private final ObjectMapper objectMapper;
    private final TemplateCrudService templateCrudService;
    private final CustomerService customerService;
    private final TransactionTemplate transactionTemplate;

    /** 并行发送上限，与 campaignTaskExecutor 的 max-size 同一个配置项 */
    @Value("${email.task.pool.max-size:30}")
    private int maxParallelCampaigns;

    private String parallelLimitTip() {
        return "最多支持 " + maxParallelCampaigns + " 个任务同时发送，请先停止部分任务或等其发送完成";
    }

    /**
     * 提交一次发送运行。
     * <p>先按上限预检：继续发送/全部重发会先把失败记录重置为待发送，必须把"发不出去"挡在改数据之前。
     * 预检与提交之间仍可能被并发请求抢先，线程池的拒绝异常一并翻译成同样的提示。
     */
    private void submitSend(Long campaignId, String runType) {
        if (taskManager.runningCount() >= maxParallelCampaigns) {
            throw new BusinessException(parallelLimitTip());
        }
        try {
            taskManager.registerTask(campaignId, campaignExecutor.executeCampaignAsync(campaignId, runType));
        } catch (RejectedExecutionException e) {
            throw new BusinessException(parallelLimitTip());
        }
    }

    /**
     * 单个任务的详情（v2.32 需求1）：状态栏要显示待发送数，而待发送只能由发送日志真实状态得出
     * （重置/继续发送后统计列会同步归零），故这里附带一次 pending 计数，避免前端再拉全量列表。
     */
    public Map<String, Object> getDetail(Long campaignId) {
        Map<String, Object> campaign = campaignMapper.selectByIdWithDetails(campaignId);
        if (campaign == null) throw new BusinessException("任务不存在");
        campaign.put("pending_count", campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId)
                .eq(CampaignLog::getStatus, "pending")));
        decorateRow(campaign);
        return campaign;
    }

    public List<Map<String, Object>> listAll() {
        List<Map<String, Object>> rows = campaignMapper.selectAllWithDetails();
        rows.forEach(this::decorateRow);
        return rows;
    }

    public Map<String, Object> listPaged(int page, int pageSize) {
        int offset = (page - 1) * pageSize;
        List<Map<String, Object>> rows = campaignMapper.selectWithDetailsPaged(pageSize, offset);
        rows.forEach(this::decorateRow);
        int total = campaignMapper.countAll();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("campaigns", rows);
        result.put("total", total);
        return result;
    }

    /** 任务行的运行态与展示态都由服务端补充：前者是内存态，后者要跨四个字段推导，都不能交给前端算 */
    private void decorateRow(Map<String, Object> row) {
        Object idObj = row.get("id");
        Long id = idObj instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(idObj));
        boolean running = id != null && taskManager.isRunning(id);
        row.put("is_running", running);
        row.put("display_status", resolveDisplayStatus(row, running));
    }

    /**
     * v2.35 需求3.2：任务状态对外统一为五态，数据库的 pending/running/completed/cancelled 只是内部流转标记。
     * <ul>
     *   <li>running 发送中：本进程正在发送，或已开过发但仍有未发出的记录；</li>
     *   <li>pending 待发送：新建后一封都没发过；</li>
     *   <li>paused 已暂停：发过但被手动停止（数据库 cancelled）且仍有未发出的记录；</li>
     *   <li>completed 已完成 / uncompleted 未完成：全部发完，按有无失败记录区分。</li>
     * </ul>
     * 未发出数用 total - sent - failed 推导，与状态栏"待发送"同一口径。
     */
    private String resolveDisplayStatus(Map<String, Object> row, boolean running) {
        String dbStatus = String.valueOf(row.getOrDefault("status", ""));
        if (running || "running".equals(dbStatus)) return "running";
        int total = intOf(row.get("total"));
        int sent = intOf(row.get("sent"));
        int failed = intOf(row.get("failed"));
        if (sent + failed == 0) return "pending";
        if (total - sent - failed > 0) return "cancelled".equals(dbStatus) ? "paused" : "running";
        return failed > 0 ? "uncompleted" : "completed";
    }

    private int intOf(Object value) {
        return value instanceof Number n ? n.intValue() : 0;
    }

    public Map<String, Object> create(CampaignCreateDTO dto) {
        List<Long> customerIds = resolveActiveCustomerIds(dto.getCustomerIds());
        if (customerIds.isEmpty()) {
            throw new BusinessException("没有选择客户");
        }

        String customVarsJson = toJson(dto.getCustomVars());
        String scheduleConfigJson = toJson(dto.getScheduleConfig());

        Campaign campaign = new Campaign();
        campaign.setName(dto.getName().trim());
        campaign.setTemplateId(dto.getTemplateId());
        campaign.setSmtpConfigId(dto.getSmtpConfigId());
        campaign.setStatus("pending");
        campaign.setTotal(customerIds.size());
        campaign.setSent(0);
        campaign.setFailed(0);
        campaign.setIntervalMin(dto.getIntervalMin() != null ? dto.getIntervalMin() : 1);
        campaign.setCustomVars(customVarsJson);
        campaign.setScheduleType(dto.getScheduleType() != null ? dto.getScheduleType() : "manual");
        campaign.setScheduleConfig(scheduleConfigJson);

        transactionTemplate.executeWithoutResult(status -> {
            campaignMapper.insert(campaign);
            for (Long cid : customerIds) {
                CampaignLog log = new CampaignLog();
                log.setCampaignId(campaign.getId());
                log.setCustomerId(cid);
                log.setStatus("pending");
                campaignLogMapper.insert(log);
            }
        });

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("campaign_id", campaign.getId());
        data.put("total", customerIds.size());
        return data;
    }

    /**
     * v2.27：编辑任务。<strong>只允许编辑"新建后一封都还没发出去"的任务</strong>；
     * 只要存在已发送/失败留痕或逐次尝试明细，就拒绝修改，保证历史发送记录不可被篡改。
     * <p>正因为前提就是"零留痕"，这里对待发送记录的删除/新增不可能碰到任何发送痕迹。
     */
    public Map<String, Object> edit(Long campaignId, CampaignCreateDTO dto) {
        Campaign campaign = campaignMapper.selectById(campaignId);
        if (campaign == null) throw new BusinessException("任务不存在");
        if (taskManager.isRunning(campaignId) || "running".equals(campaign.getStatus())) {
            throw new BusinessException("任务正在发送中，请先停止后再编辑");
        }
        if (!isNeverSent(campaignId, campaign)) {
            throw new BusinessException("该任务已发送过邮件，不支持编辑");
        }

        List<Long> targetIds = resolveActiveCustomerIds(dto.getCustomerIds());
        if (targetIds.isEmpty()) throw new BusinessException("没有有效的收件人");

        int intervalMin = dto.getIntervalMin() != null ? dto.getIntervalMin() : 1;
        String scheduleType = dto.getScheduleType() != null ? dto.getScheduleType() : "manual";
        String scheduleConfigJson = toJson(dto.getScheduleConfig());

        transactionTemplate.executeWithoutResult(status -> {
            Set<Long> pendingIds = new HashSet<>();
            for (CampaignLog l : campaignLogMapper.selectList(new LambdaQueryWrapper<CampaignLog>()
                    .eq(CampaignLog::getCampaignId, campaignId)
                    .eq(CampaignLog::getStatus, "pending"))) {
                pendingIds.add(l.getCustomerId());
            }

            campaignLogMapper.delete(new LambdaQueryWrapper<CampaignLog>()
                    .eq(CampaignLog::getCampaignId, campaignId)
                    .eq(CampaignLog::getStatus, "pending")
                    .notIn(CampaignLog::getCustomerId, targetIds));

            for (Long cid : targetIds) {
                if (pendingIds.contains(cid)) continue;
                CampaignLog log = new CampaignLog();
                log.setCampaignId(campaignId);
                log.setCustomerId(cid);
                log.setStatus("pending");
                campaignLogMapper.insert(log);
            }

            campaignMapper.update(null, new LambdaUpdateWrapper<Campaign>()
                    .eq(Campaign::getId, campaignId)
                    .set(Campaign::getName, dto.getName().trim())
                    .set(Campaign::getTemplateId, dto.getTemplateId())
                    .set(Campaign::getSmtpConfigId, dto.getSmtpConfigId())
                    .set(Campaign::getIntervalMin, intervalMin)
                    .set(Campaign::getScheduleType, scheduleType)
                    .set(Campaign::getScheduleConfig, scheduleConfigJson)
                    .set(Campaign::getTotal, targetIds.size()));
        });

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("campaign_id", campaignId);
        data.put("total", targetIds.size());
        return data;
    }

    /** 任务是否"一封都没发出去过"：统计字段与两张留痕表都要为空，任一有痕迹即视为已发送 */
    private boolean isNeverSent(Long campaignId, Campaign campaign) {
        if (campaign.getSent() != null && campaign.getSent() > 0) return false;
        if (campaign.getFailed() != null && campaign.getFailed() > 0) return false;
        long logged = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId)
                .in(CampaignLog::getStatus, "sent", "failed"));
        if (logged > 0) return false;
        long attempts = campaignSendAttemptMapper.selectCount(new LambdaQueryWrapper<CampaignSendAttempt>()
                .eq(CampaignSendAttempt::getCampaignId, campaignId));
        return attempts == 0;
    }

    public void startCampaign(Long campaignId) {
        Campaign campaign = campaignMapper.selectById(campaignId);
        if (campaign == null) throw new BusinessException("任务不存在");
        if ("running".equals(campaign.getStatus()) && !taskManager.isRunning(campaignId)) {
            // 上次进程异常退出留下的“发送中”残留状态，视为可继续
            log.warn("Campaign {} 状态为 running 但内存中无运行任务，按中断恢复处理", campaignId);
        }
        if ("running".equals(campaign.getStatus()) && taskManager.isRunning(campaignId)) {
            throw new BusinessException("任务正在运行中");
        }
        if ("completed".equals(campaign.getStatus())) throw new BusinessException("任务已完成，请使用“全部重发”");

        // 已有成功记录的启动视为继续发送
        String runType = campaign.getSent() != null && campaign.getSent() > 0
                ? CampaignRun.TYPE_RESUME : CampaignRun.TYPE_FIRST_BATCH;
        submitSend(campaignId, runType);
    }

    public void cancelCampaign(Long campaignId) {
        if (taskManager.cancelTask(campaignId)) {
            campaignMapper.update(null, new LambdaUpdateWrapper<Campaign>()
                    .eq(Campaign::getId, campaignId)
                    .set(Campaign::getStatus, "cancelled"));
        }
    }

    public void delete(Long campaignId) {
        Campaign campaign = campaignMapper.selectById(campaignId);
        if (campaign == null) throw new BusinessException("任务不存在");
        if ("running".equals(campaign.getStatus()) || taskManager.isRunning(campaignId)) {
            throw new BusinessException("无法删除正在运行的任务");
        }

        transactionTemplate.executeWithoutResult(status -> {
            campaignLogMapper.delete(new LambdaQueryWrapper<CampaignLog>()
                    .eq(CampaignLog::getCampaignId, campaignId));
            campaignMapper.deleteById(campaignId);
        });
    }

    /**
     * 继续发送：用于网络/系统故障或手动停止后的恢复。
     * <p>仅把状态不是“已发送”（待发送 / 失败 / 发送中断）的日志重置为待发送并重新执行，
     * 本次任务中已成功发送的邮件不会重复发送。
     */
    public int resume(Long campaignId) {
        Campaign campaign = campaignMapper.selectById(campaignId);
        if (campaign == null) throw new BusinessException("任务不存在");
        if (taskManager.isRunning(campaignId)) throw new BusinessException("任务正在运行中");

        long pendingCount = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId)
                .eq(CampaignLog::getStatus, "pending"));
        long failedCount = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId)
                .eq(CampaignLog::getStatus, "failed"));
        long unfinished = pendingCount + failedCount;
        if (unfinished == 0) return 0;

        if (failedCount > 0) {
            transactionTemplate.executeWithoutResult(status -> {
                campaignLogMapper.update(null, new LambdaUpdateWrapper<CampaignLog>()
                        .eq(CampaignLog::getCampaignId, campaignId)
                        .eq(CampaignLog::getStatus, "failed")
                        .set(CampaignLog::getStatus, "pending")
                        .set(CampaignLog::getErrorMessage, "")
                        .setSql("sent_at = NULL"));

                campaignMapper.update(null, new LambdaUpdateWrapper<Campaign>()
                        .eq(Campaign::getId, campaignId)
                        .set(Campaign::getStatus, "pending")
                        .set(Campaign::getFailed, 0)
                        .setSql("finished_at = NULL"));
            });
        }

        submitSend(campaignId, CampaignRun.TYPE_RESUME);
        return (int) unfinished;
    }

    public int resendAll(Long campaignId) {
        Campaign campaign = campaignMapper.selectById(campaignId);
        if (campaign == null) throw new BusinessException("任务不存在");
        if (taskManager.isRunning(campaignId)) throw new BusinessException("任务正在运行中");

        long totalCount = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId));

        if (totalCount == 0) return 0;

        transactionTemplate.executeWithoutResult(status -> {
            campaignLogMapper.update(null, new LambdaUpdateWrapper<CampaignLog>()
                    .eq(CampaignLog::getCampaignId, campaignId)
                    .set(CampaignLog::getStatus, "pending")
                    .set(CampaignLog::getErrorMessage, "")
                    .setSql("sent_at = NULL"));

            campaignMapper.update(null, new LambdaUpdateWrapper<Campaign>()
                    .eq(Campaign::getId, campaignId)
                    .set(Campaign::getStatus, "pending")
                    .set(Campaign::getSent, 0)
                    .set(Campaign::getFailed, 0)
                    .setSql("finished_at = NULL"));
        });

        submitSend(campaignId, CampaignRun.TYPE_RESEND_ALL);
        return (int) totalCount;
    }

    /** 任务每次发送的尝试明细，可按运行、发送状态、客户过滤（status 为空表示全部） */
    public Map<String, Object> getSendAttempts(Long campaignId, Long runId, String status, Long customerId, int page, int pageSize) {
        String st = normalizeLogStatus(status);
        long total = campaignSendAttemptMapper.countAttempts(campaignId, runId, st, customerId);
        int offset = (page - 1) * pageSize;
        List<Map<String, Object>> attempts = campaignSendAttemptMapper.selectAttemptsPaged(campaignId, runId, st, customerId, pageSize, offset);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("attempts", attempts);
        data.put("total", total);
        return data;
    }

    /** 任务发送记录，可按状态过滤：空=全部（总数），sent=已发送，failed=失败，pending=待发送（v2.32 需求1） */
    public Map<String, Object> getLogs(Long campaignId, String status, int page, int pageSize) {
        String st = normalizeLogStatus(status);
        LambdaQueryWrapper<CampaignLog> countQuery = new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId);
        if (st != null) countQuery.eq(CampaignLog::getStatus, st);
        long total = campaignLogMapper.selectCount(countQuery);

        int offset = (page - 1) * pageSize;
        List<Map<String, Object>> logs = campaignLogMapper.selectLogsWithCustomer(campaignId, st, pageSize, offset);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("logs", logs);
        data.put("total", total);
        return data;
    }

    /** 仅接受 sent / failed / pending 三个过滤值，其余（含"全部"对应的空值）一律不过滤 */
    private String normalizeLogStatus(String status) {
        if ("sent".equals(status) || "failed".equals(status) || "pending".equals(status)) return status;
        return null;
    }

    public StatsVO getStats() {
        StatsVO stats = new StatsVO();
        stats.setCustomerCount(customerService.count());
        stats.setTemplateCount(templateCrudService.count());
        stats.setTotalCampaigns(campaignMapper.selectCount(null));
        // v2.19/v2.22：发送统计卡片要展示全部 + 当天/本周（周一起）/本月/本年五个同口径计数，
        // v2.32 需求6 合并为一次条件聚合查询（原来 5 次全表 COUNT）。
        LocalDate today = LocalDate.now();
        Map<String, Object> counts = campaignLogMapper.selectSendRecordCounts(
                today.atStartOfDay(),
                today.minusDays(today.getDayOfWeek().getValue() - 1L).atStartOfDay(),
                today.withDayOfMonth(1).atStartOfDay(),
                today.withDayOfYear(1).atStartOfDay());
        stats.setSendRecordCount(toLong(counts, "total"));
        stats.setSendRecordToday(toLong(counts, "today"));
        stats.setSendRecordWeek(toLong(counts, "week"));
        stats.setSendRecordMonth(toLong(counts, "month"));
        stats.setSendRecordYear(toLong(counts, "year"));
        return stats;
    }

    private long toLong(Map<String, Object> row, String key) {
        Object v = row == null ? null : row.get(key);
        return v instanceof Number n ? n.longValue() : 0L;
    }

    /**
     * 解析任务的目标客户：只保留其中的"有效"客户，
     * 防止前端传入已失效或被删除的客户 ID。
     * <p>沿用"非失效即有效"的判定，与 {@code /api/customers/active} 一致，
     * 避免历史数据 status 为 NULL 时被漏掉。
     */
    private List<Long> resolveActiveCustomerIds(List<Long> selected) {
        if (selected == null || selected.isEmpty()) {
            return List.of();
        }
        return customerMapper.selectList(
                        new LambdaQueryWrapper<Customer>()
                                .select(Customer::getId)
                                .in(Customer::getId, selected)
                                .and(w -> w.ne(Customer::getStatus, CustomerService.STATUS_INACTIVE)
                                        .or().isNull(Customer::getStatus)))
                .stream().map(Customer::getId).toList();
    }

    private String toJson(Object obj) {
        if (obj == null) return "{}";
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }
}
