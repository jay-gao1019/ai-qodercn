package com.emailsystem.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ApplicationArguments;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 启动时执行幂等的数据库结构迁移与状态对账。
 * <p>
 * Spring Boot 的 sql.init 只会执行 schema.sql，而
 * "CREATE TABLE IF NOT EXISTS" 无法为已存在的表补充新列，
 * 因此这里对历史库做增量升级。
 */
@Component
public class SchemaMigrationRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SchemaMigrationRunner.class);

    private final JdbcTemplate jdbcTemplate;

    public SchemaMigrationRunner(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        addCustomerStatusColumn();
        addCustomerStatusIndex();
        addCustomerNoColumn();
        refreshCustomerNoComment();
        migrateCampaignIntervalUnit();
        dropDeprecatedScheduleColumn();
        addAttemptSnapshotColumns();
        migrateRunTypeFirstBatch();
        optimizeQueryIndexes();
        reconcileInterruptedCampaigns();
    }

    private void addCustomerStatusColumn() {
        if (columnExists("customers", "status")) {
            log.debug("customers.status 已存在，跳过");
            return;
        }
        log.info("迁移: 为 customers 表添加 status 字段");
        jdbcTemplate.execute(
                "ALTER TABLE customers ADD COLUMN status VARCHAR(20) DEFAULT 'active' "
                        + "COMMENT '有效性: active=有效 / inactive=失效'");
        // 历史数据默认置为有效
        jdbcTemplate.update("UPDATE customers SET status = 'active' WHERE status IS NULL OR status = ''");
        log.info("迁移完成: customers.status");
    }

    private void addCustomerStatusIndex() {
        if (indexExists("customers", "idx_status")) {
            return;
        }
        log.info("迁移: 为 customers.status 添加索引 idx_status");
        jdbcTemplate.execute("ALTER TABLE customers ADD INDEX idx_status (status)");
    }

    /** 客户号的唯一生成规则，SQL 侧与 {@code CustomerService.formatCustomerNo()} 保持逐字节一致。 */
    private static final String CUSTOMER_NO_RULE_SQL = "CONCAT('C', LPAD(id, 5, '0'))";

    /**
     * v2.40 需求2 / v2.41 需求1：为客户表补充"客户号"列，并按主键回填 C + 5 位数字（共 6 位）。
     * <p>回填规则与 {@code CustomerService.formatCustomerNo()} 完全一致（CONCAT('C', LPAD(id, 5, '0'))），
     * 因此老数据与新数据同规则、且由主键保证唯一；先回填再建唯一索引，
     * 条件同时覆盖"从未编号"与"不符合当前规则"两类行，故既补新行也纠正历史脏值。
     */
    private void addCustomerNoColumn() {
        addColumnIfMissing("customers", "customer_no",
                "VARCHAR(12) DEFAULT NULL COMMENT '客户号: C+5位数字共6位，系统按主键自动生成，不可修改'");
        // 显式把 updated_at 赋回自身：MySQL 只有在 UPDATE 没有给该列赋值时才会用 ON UPDATE CURRENT_TIMESTAMP
        // 自动刷新它，否则本轮"改编号"会把 1557 位客户的"最后修改时间"统一刷成迁移时刻。
        int backfilled = jdbcTemplate.update(
                "UPDATE customers SET customer_no = " + CUSTOMER_NO_RULE_SQL + ", updated_at = updated_at"
                        + " WHERE customer_no IS NULL OR customer_no = '' OR customer_no <> " + CUSTOMER_NO_RULE_SQL);
        if (backfilled > 0) {
            log.info("迁移: {} 个客户已按主键回填/纠正客户号", backfilled);
        }
        if (indexExists("customers", "uk_customer_no")) {
            return;
        }
        try {
            log.info("迁移: 为 customers.customer_no 添加唯一索引 uk_customer_no");
            jdbcTemplate.execute("ALTER TABLE customers ADD UNIQUE INDEX uk_customer_no (customer_no)");
        } catch (RuntimeException e) {
            log.warn("创建唯一索引 uk_customer_no 失败（存在重复客户号？），本轮跳过：{}", e.getMessage());
        }
    }

    /**
     * v2.41 需求1：把已建库遗留的"C+11 位"列注释刷新为当前规则，仅改元数据、不动任何数据。
     * <p>列类型仍是 VARCHAR(12)：主键超过 99999 时编号会自然延长到 7 位，缩到 VARCHAR(6) 会让未来的写入被截断。
     */
    private void refreshCustomerNoComment() {
        String comment;
        try {
            comment = jdbcTemplate.queryForObject(
                    "SELECT COLUMN_COMMENT FROM information_schema.COLUMNS "
                            + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'customer_no'",
                    String.class);
        } catch (RuntimeException e) {
            return;
        }
        if (comment == null || comment.contains("C+5")) {
            return;
        }
        log.info("迁移: 刷新 customers.customer_no 的列注释（客户号规则由 C+11 位改为 C+5 位）");
        jdbcTemplate.execute("ALTER TABLE customers MODIFY COLUMN customer_no VARCHAR(12) DEFAULT NULL "
                + "COMMENT '客户号: C+5位数字共6位，系统按主键自动生成，不可修改'");
    }

    /**
     * v2.26：发送间隔单位由"秒"改为"分钟"。
     * 原 interval_sec 折算为不少于 1 分钟的 interval_min 后删除该列。
     */
    private void migrateCampaignIntervalUnit() {
        if (!columnExists("campaigns", "interval_sec")) {
            return;
        }
        if (!columnExists("campaigns", "interval_min")) {
            log.info("迁移: 为 campaigns 表添加 interval_min 字段（每份邮件发送间隔，分钟）");
            jdbcTemplate.execute("ALTER TABLE campaigns ADD COLUMN interval_min INT DEFAULT 1 "
                    + "COMMENT '每份邮件发送间隔（分钟）'");
        }
        int converted = jdbcTemplate.update(
                "UPDATE campaigns SET interval_min = GREATEST(1, ROUND(interval_sec / 60))");
        jdbcTemplate.execute("ALTER TABLE campaigns DROP COLUMN interval_sec");
        log.info("迁移完成: campaigns.interval_sec → interval_min（{} 行已折算）", converted);
    }

    /** v2.26：定期自动发送功能裁撤，next_run_at 一并删除 */
    private void dropDeprecatedScheduleColumn() {
        if (!columnExists("campaigns", "next_run_at")) {
            return;
        }
        log.info("迁移: 删除 campaigns.next_run_at（定期自动发送已裁撤）");
        jdbcTemplate.execute("ALTER TABLE campaigns DROP COLUMN next_run_at");
    }

    /**
     * v2.26：发送尝试明细补充发送时的客户/模板/SMTP 快照列，
     * 并把历史留痕按其任务当时的资料回填，使旧记录同样具备快照展示。
     */
    private void addAttemptSnapshotColumns() {
        addColumnIfMissing("campaign_send_attempts", "customer_company",
                "VARCHAR(200) DEFAULT '' COMMENT '客户公司快照'");
        addColumnIfMissing("campaign_send_attempts", "template_name",
                "VARCHAR(200) DEFAULT '' COMMENT '模板名称快照'");
        addColumnIfMissing("campaign_send_attempts", "template_subject",
                "VARCHAR(500) DEFAULT '' COMMENT '实际发送主题快照'");
        addColumnIfMissing("campaign_send_attempts", "smtp_name",
                "VARCHAR(100) DEFAULT '' COMMENT 'SMTP 配置名称快照'");

        int backfilled = jdbcTemplate.update(
                "UPDATE campaign_send_attempts a"
                        + " JOIN campaigns cp ON a.campaign_id = cp.id"
                        + " LEFT JOIN templates t ON cp.template_id = t.id"
                        + " LEFT JOIN smtp_configs s ON cp.smtp_config_id = s.id"
                        + " LEFT JOIN customers cu ON a.customer_id = cu.id"
                        + " SET a.customer_company = COALESCE(cu.company, ''),"
                        + "     a.template_name = COALESCE(t.name, ''),"
                        + "     a.template_subject = COALESCE(t.subject, ''),"
                        + "     a.smtp_name = COALESCE(s.name, '')"
                        + " WHERE a.template_name IS NULL OR a.template_name = ''");
        if (backfilled > 0) {
            log.info("迁移完成: {} 条历史发送留痕已回填快照", backfilled);
        }
    }

    private void addColumnIfMissing(String table, String column, String definition) {
        if (columnExists(table, column)) {
            return;
        }
        log.info("迁移: 为 {} 表添加 {} 字段", table, column);
        jdbcTemplate.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
    }

    /** v2.26：非"继续发送/全部重发"的运行统一记为"第一次批量" */
    private void migrateRunTypeFirstBatch() {
        int renamed = jdbcTemplate.update("UPDATE campaign_runs SET run_type = 'first_batch' WHERE run_type = 'start'");
        if (renamed > 0) {
            log.info("迁移: {} 条 campaign_runs.run_type='start' 已改为 'first_batch'", renamed);
        }
    }

    /**
     * v2.32 需求6：按各页面真实查询条件补齐组合索引，并用其前缀取代原先的单列索引。
     * <p>索引对应关系（左侧为被取代的单列索引）：
     * <ul>
     *   <li>campaign_logs(campaign_id, status) ← idx_campaign：任务详情的发送记录分页/计数、待发送数、"是否发送过"判定</li>
     *   <li>campaign_logs(customer_id, status) ← idx_customer：客户邮件发送统计聚合、客户发送明细钻取</li>
     *   <li>campaign_logs(status, sent_at) ← idx_status：仪表盘"发送统计"五计数、趋势与发送记录时间窗</li>
     *   <li>campaign_send_attempts(campaign_id, customer_id) ← idx_attempt_campaign：每邮箱发送次数与 attempt_no 序号</li>
     *   <li>campaign_send_attempts(campaign_id, status)：模板统计的"累计发出"子查询</li>
     * </ul>
     * 先建新索引再删旧索引，保证外键始终有可用索引；删除失败只告警，不影响启动。
     */
    private void optimizeQueryIndexes() {
        addIndexIfMissing("campaign_logs", "idx_log_campaign_status", "campaign_id, status");
        addIndexIfMissing("campaign_logs", "idx_log_customer_status", "customer_id, status");
        addIndexIfMissing("campaign_logs", "idx_log_status_sent", "status, sent_at");
        addIndexIfMissing("campaign_send_attempts", "idx_attempt_campaign_customer", "campaign_id, customer_id");
        addIndexIfMissing("campaign_send_attempts", "idx_attempt_campaign_status", "campaign_id, status");
        dropIndexIfExists("campaign_logs", "idx_campaign");
        dropIndexIfExists("campaign_logs", "idx_customer");
        dropIndexIfExists("campaign_logs", "idx_status");
        dropIndexIfExists("campaign_send_attempts", "idx_attempt_campaign");
    }

    private void addIndexIfMissing(String table, String index, String columns) {
        if (indexExists(table, index)) {
            return;
        }
        log.info("迁移: 为 {} 添加组合索引 {} ({})", table, index, columns);
        jdbcTemplate.execute("ALTER TABLE " + table + " ADD INDEX " + index + " (" + columns + ")");
    }

    private void dropIndexIfExists(String table, String index) {
        if (!indexExists(table, index)) {
            return;
        }
        try {
            log.info("迁移: 删除 {} 的冗余单列索引 {}（已由组合索引前缀覆盖）", table, index);
            jdbcTemplate.execute("ALTER TABLE " + table + " DROP INDEX " + index);
        } catch (RuntimeException e) {
            log.warn("删除索引 {}.{} 失败，保留该索引：{}", table, index, e.getMessage());
        }
    }

    /**
     * 进程崩溃/重启会遗留内存中已不存在的“发送中”任务，
     * 启动时按其真实发送日志重算计数并置为“已取消”，用户可通过“继续发送”恢复。
     */
    private void reconcileInterruptedCampaigns() {
        int runs = jdbcTemplate.update(
                "UPDATE campaign_runs SET status = 'cancelled', finished_at = NOW() WHERE status = 'running'");
        int counts = jdbcTemplate.update(
                "UPDATE campaigns c SET "
                        + "c.sent = (SELECT COUNT(*) FROM campaign_logs cl WHERE cl.campaign_id = c.id AND cl.status = 'sent'), "
                        + "c.failed = (SELECT COUNT(*) FROM campaign_logs cl WHERE cl.campaign_id = c.id AND cl.status = 'failed') "
                        + "WHERE c.status = 'running'");
        int campaigns = jdbcTemplate.update(
                "UPDATE campaigns SET status = 'cancelled', finished_at = NOW() WHERE status = 'running'");
        if (campaigns > 0 || runs > 0) {
            log.info("启动对账: {} 个中断任务已置为 cancelled，{} 条运行记录已关闭", campaigns, runs);
        }
    }

    private boolean columnExists(String table, String column) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                Integer.class, table, column);
        return count != null && count > 0;
    }

    private boolean indexExists(String table, String index) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
                Integer.class, table, index);
        return count != null && count > 0;
    }
}
