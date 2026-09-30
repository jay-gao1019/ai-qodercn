package com.emailsystem.task;

import com.emailsystem.entity.Campaign;
import com.emailsystem.entity.CampaignLog;
import com.emailsystem.entity.CampaignRun;
import com.emailsystem.entity.CampaignSendAttempt;
import com.emailsystem.entity.Customer;
import com.emailsystem.entity.SmtpConfig;
import com.emailsystem.entity.Template;
import com.emailsystem.mapper.CampaignLogMapper;
import com.emailsystem.mapper.CampaignMapper;
import com.emailsystem.mapper.CampaignRunMapper;
import com.emailsystem.mapper.CampaignSendAttemptMapper;
import com.emailsystem.mapper.CustomerMapper;
import com.emailsystem.mapper.SmtpConfigMapper;
import com.emailsystem.mapper.TemplateMapper;
import com.emailsystem.service.CustomerService;
import com.emailsystem.service.EmailService;
import com.emailsystem.service.VariableService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.AsyncResult;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Future;

@Component
public class CampaignExecutor {

    private static final Logger log = LoggerFactory.getLogger(CampaignExecutor.class);

    private final CampaignMapper campaignMapper;
    private final CampaignLogMapper campaignLogMapper;
    private final CampaignRunMapper campaignRunMapper;
    private final CampaignSendAttemptMapper campaignSendAttemptMapper;
    private final TemplateMapper templateMapper;
    private final SmtpConfigMapper smtpConfigMapper;
    private final CustomerMapper customerMapper;
    private final EmailService emailService;
    private final VariableService variableService;
    private final CampaignTaskManager taskManager;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public CampaignExecutor(CampaignMapper campaignMapper,
                            CampaignLogMapper campaignLogMapper,
                            CampaignRunMapper campaignRunMapper,
                            CampaignSendAttemptMapper campaignSendAttemptMapper,
                            TemplateMapper templateMapper,
                            SmtpConfigMapper smtpConfigMapper,
                            CustomerMapper customerMapper,
                            EmailService emailService,
                            VariableService variableService,
                            CampaignTaskManager taskManager,
                            ObjectMapper objectMapper,
                            TransactionTemplate transactionTemplate) {
        this.campaignMapper = campaignMapper;
        this.campaignLogMapper = campaignLogMapper;
        this.campaignRunMapper = campaignRunMapper;
        this.campaignSendAttemptMapper = campaignSendAttemptMapper;
        this.templateMapper = templateMapper;
        this.smtpConfigMapper = smtpConfigMapper;
        this.customerMapper = customerMapper;
        this.emailService = emailService;
        this.variableService = variableService;
        this.taskManager = taskManager;
        this.objectMapper = objectMapper;
        this.transactionTemplate = transactionTemplate;
    }

    @Async("campaignTaskExecutor")
    public Future<?> executeCampaignAsync(Long campaignId, String runType) {
        Long runId = openRun(campaignId, runType);
        log.info("Starting campaign execution: {} (run {})", campaignId, runId);
        try {
            doExecute(campaignId, runId);
        } catch (Exception e) {
            log.error("Campaign {} execution error: {}", campaignId, e.getMessage(), e);
            finishRunAbnormally(runId);
        } finally {
            taskManager.removeTask(campaignId);
        }
        return new AsyncResult<>(null);
    }

    private Long openRun(Long campaignId, String runType) {
        try {
            CampaignRun run = new CampaignRun();
            run.setCampaignId(campaignId);
            run.setRunType(runType != null ? runType : CampaignRun.TYPE_FIRST_BATCH);
            run.setStatus("running");
            run.setSent(0);
            run.setFailed(0);
            // 本次运行处理的是所有尚未发送成功的日志
            long total = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                    .eq(CampaignLog::getCampaignId, campaignId)
                    .ne(CampaignLog::getStatus, "sent"));
            run.setTotal((int) total);
            campaignRunMapper.insert(run);
            return run.getId();
        } catch (Exception e) {
            log.warn("Failed to open run for campaign {}: {}", campaignId, e.getMessage());
            return null;
        }
    }

    private void finishRunAbnormally(Long runId) {
        if (runId == null) return;
        try {
            campaignRunMapper.update(null, new LambdaUpdateWrapper<CampaignRun>()
                    .eq(CampaignRun::getId, runId)
                    .set(CampaignRun::getStatus, "cancelled")
                    .setSql("finished_at = CURRENT_TIMESTAMP"));
        } catch (Exception e) {
            log.warn("Failed to close run {}: {}", runId, e.getMessage());
        }
    }

    private void doExecute(Long campaignId, Long runId) {
        Campaign campaign = campaignMapper.selectById(campaignId);
        if (campaign == null) {
            finishRunAbnormally(runId);
            return;
        }

        Template template = templateMapper.selectById(campaign.getTemplateId());
        SmtpConfig smtp = template == null ? null : smtpConfigMapper.selectById(campaign.getSmtpConfigId());
        if (template == null || smtp == null) {
            // 模板或 SMTP 配置缺失，任务无法执行：保持原有日志状态，仅关闭本次运行记录
            log.warn("Campaign {} missing template or smtp config, run aborted", campaignId);
            finishRunAbnormally(runId);
            return;
        }

        List<CampaignLog> logs = campaignLogMapper.selectList(
                new LambdaQueryWrapper<CampaignLog>()
                        .eq(CampaignLog::getCampaignId, campaignId)
                        .orderByAsc(CampaignLog::getId)
        );

        Map<String, String> globalVars = variableService.getGlobalVarsMap();
        Map<String, String> customVars = parseJson(campaign.getCustomVars());
        Map<String, String> allCustomVars = new HashMap<>(globalVars);
        if (customVars != null) {
            allCustomVars.putAll(customVars);
        }

        transactionTemplate.executeWithoutResult(status -> {
            campaignMapper.update(null, new LambdaUpdateWrapper<Campaign>()
                    .eq(Campaign::getId, campaignId)
                    .set(Campaign::getStatus, "running")
                    .setSql("started_at = CURRENT_TIMESTAMP")
                    .setSql("finished_at = NULL"));
        });

        int intervalMin = campaign.getIntervalMin() != null ? campaign.getIntervalMin() : 1;
        boolean interrupted = false;
        int runSent = 0;
        int runFailed = 0;

        for (CampaignLog logEntry : logs) {
            if (Thread.currentThread().isInterrupted()) {
                interrupted = true;
                break;
            }
            if ("sent".equals(logEntry.getStatus())) {
                continue;
            }

            Customer customer = customerMapper.selectById(logEntry.getCustomerId());
            if (customer == null) {
                // 客户已被删除：记为失败，避免日志永远停留在待发送
                String reason = "客户不存在，跳过发送";
                transactionTemplate.executeWithoutResult(s -> {
                    campaignLogMapper.update(null, new LambdaUpdateWrapper<CampaignLog>()
                            .eq(CampaignLog::getId, logEntry.getId())
                            .set(CampaignLog::getStatus, "failed")
                            .set(CampaignLog::getErrorMessage, reason)
                            .setSql("sent_at = CURRENT_TIMESTAMP"));
                    campaignMapper.update(null, new LambdaUpdateWrapper<Campaign>()
                            .eq(Campaign::getId, campaignId)
                            .setSql("failed = failed + 1"));
                    recordAttempt(campaignId, runId, logEntry, AttemptSnapshot.EMPTY, "failed", reason);
                });
                runFailed++;
                continue;
            }

            Map<String, String> varMap = buildVarMap(customer, allCustomVars);
            String subject = emailService.replaceTemplateVars(template.getSubject(), varMap);
            AttemptSnapshot snapshot = new AttemptSnapshot(customer, template, smtp, subject);

            String finalStatus;
            String errorMsg;
            if (CustomerService.STATUS_INACTIVE.equals(customer.getStatus())) {
                // 失效客户跳过发送，标记为失败并记录原因
                finalStatus = "failed";
                errorMsg = "客户已失效，跳过发送";
            } else {
                String body = emailService.replaceTemplateVars(template.getBody(), varMap);
                EmailService.SendResult result = emailService.sendSingleEmail(
                        smtp.getHost(), smtp.getPort(), smtp.getUsername(), smtp.getPassword(),
                        Boolean.TRUE.equals(smtp.getUseSsl()), Boolean.TRUE.equals(smtp.getUseTls()),
                        customer.getEmail(), subject, body
                );
                finalStatus = result.success() ? "sent" : "failed";
                errorMsg = result.error();
            }
            boolean success = "sent".equals(finalStatus);

            transactionTemplate.executeWithoutResult(s -> {
                campaignLogMapper.update(null, new LambdaUpdateWrapper<CampaignLog>()
                        .eq(CampaignLog::getId, logEntry.getId())
                        .set(CampaignLog::getStatus, finalStatus)
                        .set(CampaignLog::getErrorMessage, errorMsg)
                        .setSql("sent_at = CURRENT_TIMESTAMP"));

                campaignMapper.update(null, new LambdaUpdateWrapper<Campaign>()
                        .eq(Campaign::getId, campaignId)
                        .setSql(success ? "sent = sent + 1" : "failed = failed + 1"));

                recordAttempt(campaignId, runId, logEntry, snapshot, finalStatus, errorMsg);
            });

            if (success) {
                runSent++;
            } else {
                runFailed++;
            }

            try {
                Thread.sleep(intervalMin * 60_000L);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                interrupted = true;
                break;
            }
        }

        finalizeCampaignAndRun(campaignId, runId, interrupted, runSent, runFailed);
    }

    /**
     * 运行收尾：以 campaign_logs 的真实状态重算任务计数，
     * 仅当不存在待发送日志时才把任务置为已完成；被停止的任务置为已取消。
     */
    private void finalizeCampaignAndRun(Long campaignId, Long runId, boolean interrupted, int runSent, int runFailed) {
        long sentCount = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId).eq(CampaignLog::getStatus, "sent"));
        long failedCount = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId).eq(CampaignLog::getStatus, "failed"));
        long pendingCount = campaignLogMapper.selectCount(new LambdaQueryWrapper<CampaignLog>()
                .eq(CampaignLog::getCampaignId, campaignId).eq(CampaignLog::getStatus, "pending"));

        String campaignStatus = (interrupted || pendingCount > 0) ? "cancelled" : "completed";
        transactionTemplate.executeWithoutResult(status -> {
            campaignMapper.update(null, new LambdaUpdateWrapper<Campaign>()
                    .eq(Campaign::getId, campaignId)
                    .set(Campaign::getStatus, campaignStatus)
                    .set(Campaign::getSent, (int) sentCount)
                    .set(Campaign::getFailed, (int) failedCount)
                    .set(Campaign::getFinishedAt, java.time.LocalDateTime.now()));

            if (runId != null) {
                campaignRunMapper.update(null, new LambdaUpdateWrapper<CampaignRun>()
                        .eq(CampaignRun::getId, runId)
                        .set(CampaignRun::getStatus, interrupted ? "cancelled" : "completed")
                        .set(CampaignRun::getSent, runSent)
                        .set(CampaignRun::getFailed, runFailed)
                        .setSql("finished_at = CURRENT_TIMESTAMP"));
            }
        });

        log.info("Campaign {} finished with status {}, sent={}, failed={}, pending={}",
                campaignId, campaignStatus, sentCount, failedCount, pendingCount);
    }

    /**
     * 写入一条发送尝试留痕，并保存发送当时的客户/模板/SMTP 数据快照，
     * 后续这些资料被调整或客户被删除都不影响"发送详情"的历史呈现。
     */
    private void recordAttempt(Long campaignId, Long runId, CampaignLog logEntry,
                               AttemptSnapshot snapshot, String status, String errorMsg) {
        if (runId == null) return;
        CampaignSendAttempt attempt = new CampaignSendAttempt();
        attempt.setCampaignId(campaignId);
        attempt.setRunId(runId);
        attempt.setCampaignLogId(logEntry.getId());
        attempt.setCustomerId(logEntry.getCustomerId());
        attempt.setCustomerName(snapshot.customerName);
        attempt.setCustomerEmail(snapshot.customerEmail);
        attempt.setCustomerCompany(snapshot.customerCompany);
        attempt.setTemplateName(snapshot.templateName);
        attempt.setTemplateSubject(snapshot.templateSubject);
        attempt.setSmtpName(snapshot.smtpName);
        attempt.setStatus(status);
        attempt.setErrorMessage(errorMsg);
        attempt.setSentAt(java.time.LocalDateTime.now());
        campaignSendAttemptMapper.insert(attempt);
    }

    /** 发送尝试的数据快照 */
    private record AttemptSnapshot(String customerName, String customerEmail, String customerCompany,
                                   String templateName, String templateSubject, String smtpName) {

        /** 收件客户已被删除时使用：没有可快照的资料 */
        static final AttemptSnapshot EMPTY = new AttemptSnapshot("", "", "", "", "", "");

        AttemptSnapshot(Customer customer, Template template, SmtpConfig smtp, String renderedSubject) {
            this(nullSafe(customer.getName()), nullSafe(customer.getEmail()), nullSafe(customer.getCompany()),
                    nullSafe(template.getName()), nullSafe(renderedSubject), nullSafe(smtp.getName()));
        }

        private static String nullSafe(String s) {
            return s != null ? s : "";
        }
    }

    private Map<String, String> buildVarMap(Customer customer, Map<String, String> customVars) {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("cust_name", nullSafe(customer.getName()));
        map.put("cust_email", nullSafe(customer.getEmail()));
        map.put("cust_company", nullSafe(customer.getCompany()));
        map.put("cust_phone", nullSafe(customer.getPhone()));
        map.put("cust_country", nullSafe(customer.getCountry()));
        map.put("cust_tags", nullSafe(customer.getTags()));
        map.put("cust_notes", nullSafe(customer.getNotes()));
        map.putAll(customVars);
        return map;
    }

    private String nullSafe(String s) {
        return s != null ? s : "";
    }

    private Map<String, String> parseJson(String json) {
        if (json == null || json.isEmpty()) return new HashMap<>();
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, String>>() {});
        } catch (Exception e) {
            return new HashMap<>();
        }
    }
}
