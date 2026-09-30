package com.emailsystem.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.emailsystem.common.BusinessException;
import com.emailsystem.dto.request.CampaignCreateDTO;
import com.emailsystem.dto.response.StatsVO;
import com.emailsystem.entity.Campaign;
import com.emailsystem.entity.CampaignBatch;
import com.emailsystem.entity.CampaignLog;
import com.emailsystem.entity.CampaignRun;
import com.emailsystem.entity.Customer;
import com.emailsystem.mapper.CampaignBatchMapper;
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
    private final CampaignBatchMapper campaignBatchMapper;
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

    /** v2.44 需求 2：批次说明的两种取值，只在建批次行时写入，之后不再改写 */
    static final String BATCH_NOTE_FIRST = "创建任务的初始批次";
    static final String BATCH_NOTE_EDITED = "编辑变动收件人名单后开启";

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
        attachBatchSummary(List.of(campaign), campaignBatchMapper.selectBatchCountByCampaign());
        decorateRow(campaign);
        return campaign;
    }

    /**
     * v2.44 需求 2：任务行补上"批次数 / 当前批次"，供仪表盘"任务发送统计"和任务列表显示批次。
     * <p>批次数一次分组查出全部任务（避免每行一条 COUNT 的 N+1）；批次表由建任务/编辑/发送维护，
     * 迁移前的老任务即使已回填过，这里也统一用"没查到 = 0 批、当前第 1 批"兜底，界面不会出现空值。
     */
    private void attachBatchSummary(List<Map<String, Object>> rows, List<Map<String, Object>> batchRows) {
        Map<Long, Map<String, Object>> byCampaign = new LinkedHashMap<>();
        batchRows.forEach(r -> byCampaign.put(Long.parseLong(String.valueOf(r.get("campaign_id"))), r));
        rows.forEach(row -> {
            Map<String, Object> r = byCampaign.get(Long.parseLong(String.valueOf(row.get("id"))));
            row.put("batch_count", r == null ? 0 : intOf(r.get("batch_count")));
            row.put("current_batch", r == null ? 1 : intOf(r.get("current_batch")));
        });
    }

    public List<Map<String, Object>> listAll() {
        List<Map<String, Object>> rows = campaignMapper.selectAllWithDetails();
        attachBatchSummary(rows, campaignBatchMapper.selectBatchCountByCampaign());
        rows.forEach(this::decorateRow);
        return rows;
    }

    public Map<String, Object> listPaged(int page, int pageSize) {
        int offset = (page - 1) * pageSize;
        List<Map<String, Object>> rows = campaignMapper.selectWithDetailsPaged(pageSize, offset);
        attachBatchSummary(rows, campaignBatchMapper.selectBatchCountByCampaign());
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
                log.setBatchNo(1);
                campaignLogMapper.insert(log);
            }
            // v2.44 需求 2：建任务即开第 1 批，收件人全部是本批新增
            campaignBatchMapper.insertBatchRow(campaign.getId(), 1, BATCH_NOTE_FIRST, customerIds.size(), 0);
            campaignBatchMapper.refreshCampaignBatches(campaign.getId());
        });

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("campaign_id", campaign.getId());
        data.put("total", customerIds.size());
        return data;
    }

    /**
     * v2.42 需求6：任务只要<strong>不在发送中</strong>就可以编辑（名称、模板、SMTP、发送间隔、发送方式、收件人列表）。
     * <p>v2.43 需求 1.2：编辑导致收件人名单变动时<strong>开一个新的发送批次</strong>，
     * 批次号写进 campaign_logs.batch_no，让"这一批要发给谁"与"上一批发成了什么样"分开留痕：
     * <ul>
     *   <li>已发出（sent/failed）的记录一行都不动——状态、错误信息、发送时间、批次号全部保持原值，
     *       它们连同自己当时的批次成为"历史批次"，界面用批次标记区分；</li>
     *   <li>新加入的收件人以 pending 落在新批次；本批仍在名单且尚未发出的记录只把批次号推进到新批次
     *       （pending 还没有任何发送事实，改批次号不算篡改留痕）；</li>
     *   <li>本批被移出名单且尚未发出的记录直接删除（从未发出，删掉不会抹掉任何已发生的发送）；</li>
     *   <li>被移出名单但已发出的记录保留为历史，不再属于当前批次，因此编辑弹窗里它们是未勾选状态；
     *       即便在这里重新勾上他也不会再插一条记录——一个客户在该任务下始终只有一条日志，
     *       否则"全部重发"会把他发两遍；重发历史收件人的正确入口是"全部重发"。</li>
     * </ul>
     * 统计口径按用户确认的"全部计入"维持不变：total/sent/failed 仍按该任务<strong>全部</strong>日志聚合
     * （含历史批次），故编辑后进度 x/y 与各项发送统计依旧连续可用，只有两张列表用批次标记区分新旧。
     * total/sent/failed 与任务状态都按日志实态重算：有未发出记录即置为 cancelled（界面显示"已暂停"，
     * 可继续发送），一封都没发过是 pending，全部发完是 completed。
     */
    public Map<String, Object> edit(Long campaignId, CampaignCreateDTO dto) {
        Campaign campaign = campaignMapper.selectById(campaignId);
        if (campaign == null) throw new BusinessException("任务不存在");
        if (taskManager.isRunning(campaignId) || "running".equals(campaign.getStatus())) {
            throw new BusinessException("任务正在发送中，请先暂停后再编辑");
        }

        List<CampaignLog> existingLogs = campaignLogMapper.selectList(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId));
        // v2.44 需求 2：当前批次号只认批次表（每个开过的批次都有行），不再从日志的最大值推导，
        // 否则"整批收件人被移出"后日志最大值会回退，编辑时就会算出和已有批次冲突的批次号。
        int maxBatch = campaignBatchMapper.selectCurrentBatch(campaignId);

        Set<Long> existingCustomerIds = new LinkedHashSet<>();
        Set<Long> currentRosterIds = new LinkedHashSet<>();
        List<Long> removableLogIds = new ArrayList<>();
        List<Long> keepPendingLogIds = new ArrayList<>();
        for (CampaignLog l : existingLogs) {
            existingCustomerIds.add(l.getCustomerId());
            if (batchOf(l) == maxBatch) currentRosterIds.add(l.getCustomerId());
        }
        int sentCount = (int) existingLogs.stream().filter(l -> "sent".equals(l.getStatus())).count();
        int failedCount = (int) existingLogs.stream().filter(l -> "failed".equals(l.getStatus())).count();

        List<Long> requestedIds = resolveActiveCustomerIds(dto.getCustomerIds());
        if (requestedIds.isEmpty()) throw new BusinessException("没有有效的收件人");
        Set<Long> requested = new LinkedHashSet<>(requestedIds);
        for (CampaignLog l : existingLogs) {
            // 只有 pending 是"还没发出"，其余状态都是不可抹掉、也不可改动的发送留痕
            if (!"pending".equals(l.getStatus())) continue;
            if (requested.contains(l.getCustomerId())) keepPendingLogIds.add(l.getId());
            else removableLogIds.add(l.getId());
        }
        List<Long> addedCustomerIds = new ArrayList<>();
        // 与"该任务历史上出现过的客户"比较，而不是只比当前批次：历史批次里那位收件人的终态记录已经是留痕，
        // 再勾一次他不应产生第二条同客户日志（否则"全部重发"会给他发两遍）。要重发历史收件人请用"全部重发"。
        for (Long cid : requested) {
            if (!existingCustomerIds.contains(cid)) addedCustomerIds.add(cid);
        }
        boolean rosterChanged = !addedCustomerIds.isEmpty() || !removableLogIds.isEmpty()
                || currentRosterIds.stream().anyMatch(cid -> !requested.contains(cid));
        // 新批次只在"确实有待发送记录落进去"时才成立：若只移除了几个已发出的收件人而没有任何新工作，
        // 推进批次号后没有任何行属于新批次，历史标记反而会失真。
        // 另外，一封都还没发出过的任务不存在"历史批次"可隔开，此时推进批次号只会让界面凭空出现"第 2 批"，
        // 故还要求该任务已有 sent/failed 记录。
        boolean openBatch = rosterChanged && sentCount + failedCount > 0
                && (!addedCustomerIds.isEmpty() || !keepPendingLogIds.isEmpty());
        int newBatch = openBatch ? maxBatch + 1 : maxBatch;

        int total = existingLogs.size() - removableLogIds.size() + addedCustomerIds.size();
        int unfinished = total - sentCount - failedCount;
        String newStatus;
        if (sentCount + failedCount == 0) {
            newStatus = "pending";
        } else if (unfinished > 0) {
            newStatus = "cancelled";
        } else {
            newStatus = "completed";
        }
        // 编辑后仍有未发出的记录，原先的"结束时间"就成了假信息，必须一并清掉
        boolean clearFinishedAt = unfinished > 0 || sentCount + failedCount == 0;

        int intervalMin = dto.getIntervalMin() != null ? dto.getIntervalMin() : 1;
        String scheduleType = dto.getScheduleType() != null ? dto.getScheduleType() : "manual";
        String scheduleConfigJson = toJson(dto.getScheduleConfig());

        transactionTemplate.executeWithoutResult(status -> {
            if (!removableLogIds.isEmpty()) {
                campaignLogMapper.deleteBatchIds(removableLogIds);
            }
            if (openBatch && !keepPendingLogIds.isEmpty()) {
                // 只推进批次号：这些 pending 记录的 status/error_message/sent_at 一律不写
                campaignLogMapper.update(null, new LambdaUpdateWrapper<CampaignLog>()
                        .in(CampaignLog::getId, keepPendingLogIds)
                        .set(CampaignLog::getBatchNo, newBatch));
            }
            for (Long cid : addedCustomerIds) {
                CampaignLog log = new CampaignLog();
                log.setCampaignId(campaignId);
                log.setCustomerId(cid);
                log.setStatus("pending");
                log.setBatchNo(newBatch);
                campaignLogMapper.insert(log);
            }

            if (openBatch) {
                // v2.44 需求 2：新批次落一行，记下面对本次名单做了什么；unique key 保证同一批只记一次
                campaignBatchMapper.insertBatchRow(campaignId, newBatch, BATCH_NOTE_EDITED,
                        addedCustomerIds.size(), removableLogIds.size());
            }
            campaignBatchMapper.refreshCampaignBatches(campaignId);

            LambdaUpdateWrapper<Campaign> update = new LambdaUpdateWrapper<Campaign>()
                    .eq(Campaign::getId, campaignId)
                    .set(Campaign::getName, dto.getName().trim())
                    .set(Campaign::getTemplateId, dto.getTemplateId())
                    .set(Campaign::getSmtpConfigId, dto.getSmtpConfigId())
                    .set(Campaign::getIntervalMin, intervalMin)
                    .set(Campaign::getScheduleType, scheduleType)
                    .set(Campaign::getScheduleConfig, scheduleConfigJson)
                    .set(Campaign::getTotal, total)
                    .set(Campaign::getSent, sentCount)
                    .set(Campaign::getFailed, failedCount)
                    .set(Campaign::getStatus, newStatus);
            if (clearFinishedAt) {
                update.setSql("finished_at = NULL");
            }
            campaignMapper.update(null, update);
        });

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("campaign_id", campaignId);
        data.put("total", total);
        data.put("sent", sentCount);
        data.put("failed", failedCount);
        data.put("pending", Math.max(0, unfinished));
        data.put("added", addedCustomerIds.size());
        data.put("removed", removableLogIds.size());
        data.put("status", newStatus);
        data.put("batch_no", newBatch);
        data.put("batch_opened", openBatch);
        return data;
    }

    /** 日志的批次号：迁移前写入的历史行取不到该列值时按第 1 批处理 */
    private int batchOf(CampaignLog campaignLog) {
        return campaignLog.getBatchNo() == null ? 1 : campaignLog.getBatchNo();
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
            // v2.44 需求 2：批次表是日志的派生汇总，日志删光后留着行就是幽灵批次，一并清掉
            campaignBatchMapper.delete(new LambdaQueryWrapper<CampaignBatch>()
                    .eq(CampaignBatch::getCampaignId, campaignId));
            campaignMapper.deleteById(campaignId);
        });
    }

    /**
     * 继续发送：用于网络/系统故障或手动停止后的恢复。
     * <p>仅把状态不是“已发送”（待发送 / 失败 / 发送中断）的日志重置为待发送并重新执行，
     * 本次任务中已成功发送的邮件不会重复发送。
     * <p>v2.43 需求 1.2：这里的"日志"只算<strong>当前批次</strong>——历史批次是上一份收件人名单留下的事实，
     * 即便其中还有失败记录，也不会因为一次"继续发送"又被发给已经移出名单的客户。
     */
    public int resume(Long campaignId) {
        Campaign campaign = campaignMapper.selectById(campaignId);
        if (campaign == null) throw new BusinessException("任务不存在");
        if (taskManager.isRunning(campaignId)) throw new BusinessException("任务正在运行中");

        int currentBatch = campaignBatchMapper.selectCurrentBatch(campaignId);
        long pendingCount = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId)
                .eq(CampaignLog::getBatchNo, currentBatch)
                .eq(CampaignLog::getStatus, "pending"));
        long failedCount = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId)
                .eq(CampaignLog::getBatchNo, currentBatch)
                .eq(CampaignLog::getStatus, "failed"));
        long unfinished = pendingCount + failedCount;
        if (unfinished == 0) return 0;

        if (failedCount > 0) {
            // 历史批次的失败数仍然计入 campaigns.failed（统计口径为"全部批次"）
            long historyFailed = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                    .eq(CampaignLog::getCampaignId, campaignId)
                    .eq(CampaignLog::getStatus, "failed")) - failedCount;
            transactionTemplate.executeWithoutResult(status -> {
                campaignLogMapper.update(null, new LambdaUpdateWrapper<CampaignLog>()
                        .eq(CampaignLog::getCampaignId, campaignId)
                        .eq(CampaignLog::getBatchNo, currentBatch)
                        .eq(CampaignLog::getStatus, "failed")
                        .set(CampaignLog::getStatus, "pending")
                        .set(CampaignLog::getErrorMessage, "")
                        .setSql("sent_at = NULL"));

                campaignMapper.update(null, new LambdaUpdateWrapper<Campaign>()
                        .eq(Campaign::getId, campaignId)
                        .set(Campaign::getStatus, "pending")
                        .set(Campaign::getFailed, (int) historyFailed)
                        .setSql("finished_at = NULL"));

                // v2.44 需求 2：失败数从本批挪回待发送，批次汇总跟着日志实态走
                campaignBatchMapper.refreshCampaignBatches(campaignId);
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

            // v2.44 需求 2：全部重发将每个批次都重置为待发送，逐批汇总一并刷新
            campaignBatchMapper.refreshCampaignBatches(campaignId);
        });

        submitSend(campaignId, CampaignRun.TYPE_RESEND_ALL);
        return (int) totalCount;
    }

    /** 任务每次发送的尝试明细，可按运行、发送状态、客户、批次过滤（status 为空表示全部） */
    public Map<String, Object> getSendAttempts(Long campaignId, Long runId, String status, Long customerId,
                                               Integer batchNo, int page, int pageSize) {
        String st = normalizeLogStatus(status);
        long total = campaignSendAttemptMapper.countAttempts(campaignId, runId, st, customerId, batchNo);
        int offset = (page - 1) * pageSize;
        List<Map<String, Object>> attempts = campaignSendAttemptMapper
                .selectAttemptsPaged(campaignId, runId, st, customerId, batchNo, pageSize, offset);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("attempts", attempts);
        data.put("total", total);
        // v2.43 需求 1.2：批次号小于当前批次的留痕属于历史批次
        data.put("current_batch", campaignBatchMapper.selectCurrentBatch(campaignId));
        return data;
    }

    /** 任务发送记录，可按状态、批次过滤：状态空=全部（总数），批次 null=全部批次 */
    public Map<String, Object> getLogs(Long campaignId, String status, Integer batchNo, int page, int pageSize) {
        String st = normalizeLogStatus(status);
        LambdaQueryWrapper<CampaignLog> countQuery = new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId);
        if (st != null) countQuery.eq(CampaignLog::getStatus, st);
        if (batchNo != null) countQuery.eq(CampaignLog::getBatchNo, batchNo);
        long total = campaignLogMapper.selectCount(countQuery);

        int offset = (page - 1) * pageSize;
        List<Map<String, Object>> logs = campaignLogMapper
                .selectLogsWithCustomer(campaignId, st, batchNo, pageSize, offset);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("logs", logs);
        data.put("total", total);
        // v2.43 需求 1.2：同页记录带上"当前批次号"，前端据此把批次号更小的行标成历史批次
        data.put("current_batch", campaignBatchMapper.selectCurrentBatch(campaignId));
        return data;
    }

    /**
     * v2.44 需求 2：该任务的逐批次概览（"发送记录"弹窗的第二个页签、编辑任务时的批次说明都用这份数据）。
     * <p>每批一行：收件人数、成功/失败/待发送、开批时间、首末发送时间、本次新增/移出人数与批次状态；
     * 数字全部来自 campaign_batches（由日志聚合维护），所以点某一页签不必再把整批日志读出来。
     * 另外标出 is_current，让界面知道哪一批是"正在发的这一批"。
     */
    public Map<String, Object> getBatches(Long campaignId) {
        if (campaignMapper.selectById(campaignId) == null) throw new BusinessException("任务不存在");
        List<Map<String, Object>> batches = campaignBatchMapper.selectBatches(campaignId);
        int currentBatch = campaignBatchMapper.selectCurrentBatch(campaignId);
        batches.forEach(b -> b.put("is_current", intOf(b.get("batch_no")) == currentBatch));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("batches", batches);
        data.put("current_batch", currentBatch);
        data.put("total", batches.size());
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
