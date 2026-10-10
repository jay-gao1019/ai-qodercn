CREATE DATABASE IF NOT EXISTS email_system
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE email_system;

CREATE TABLE IF NOT EXISTS smtp_configs (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name        VARCHAR(100) NOT NULL COMMENT '配置名称',
    host        VARCHAR(200) NOT NULL COMMENT 'SMTP 服务器地址',
    port        INT          NOT NULL COMMENT '端口号',
    username    VARCHAR(200) NOT NULL COMMENT '登录用户名',
    password    VARCHAR(500) NOT NULL COMMENT '登录密码',
    use_ssl     TINYINT(1)   DEFAULT 0 COMMENT 'SSL 加密标志',
    use_tls     TINYINT(1)   DEFAULT 0 COMMENT 'STARTTLS 加密标志',
    is_default  TINYINT(1)   DEFAULT 0 COMMENT '默认配置标志',
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'
) ENGINE=InnoDB COMMENT='SMTP 配置表';

CREATE TABLE IF NOT EXISTS customers (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    customer_no VARCHAR(12)  DEFAULT NULL COMMENT '客户号: C+5位数字共6位，系统按主键自动生成，不可修改',
    name        VARCHAR(100) DEFAULT '' COMMENT '姓名',
    email       VARCHAR(200) NOT NULL COMMENT '邮箱',
    company     VARCHAR(200) DEFAULT '' COMMENT '公司',
    phone       VARCHAR(50)  DEFAULT '' COMMENT '电话',
    country     VARCHAR(100) DEFAULT '' COMMENT '国家',
    tags        VARCHAR(500) DEFAULT '' COMMENT '标签',
    notes       TEXT         COMMENT '备注',
    status      VARCHAR(20)  DEFAULT 'active' COMMENT '有效性: active=有效 / inactive=失效',
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE INDEX uk_customer_no (customer_no),
    INDEX idx_email (email),
    INDEX idx_name (name),
    INDEX idx_status (status)
) ENGINE=InnoDB COMMENT='客户表';

CREATE TABLE IF NOT EXISTS templates (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name        VARCHAR(200) NOT NULL COMMENT '模板名称',
    subject     VARCHAR(500) NOT NULL COMMENT '邮件主题',
    body        LONGTEXT     NOT NULL COMMENT '邮件正文 HTML',
    variables   JSON         COMMENT '变量列表 JSON',
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB COMMENT='模板表';

CREATE TABLE IF NOT EXISTS variables (
    id            BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name          VARCHAR(100) NOT NULL COMMENT '变量名',
    description   VARCHAR(500) DEFAULT '' COMMENT '描述',
    example_value VARCHAR(500) DEFAULT '' COMMENT '示例值',
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    UNIQUE INDEX uk_name (name)
) ENGINE=InnoDB COMMENT='全局变量表';

CREATE TABLE IF NOT EXISTS campaigns (
    id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
    name            VARCHAR(200) NOT NULL COMMENT '任务名称',
    template_id     BIGINT       NOT NULL COMMENT '关联模板 ID',
    smtp_config_id  BIGINT       NOT NULL COMMENT '关联 SMTP 配置 ID',
    status          VARCHAR(20)  DEFAULT 'pending' COMMENT '状态: pending/running/completed/cancelled',
    total           INT          DEFAULT 0 COMMENT '总收件人数',
    sent            INT          DEFAULT 0 COMMENT '已发送数',
    failed          INT          DEFAULT 0 COMMENT '失败数',
    interval_min    INT          DEFAULT 1 COMMENT '每份邮件发送间隔（分钟）',
    custom_vars     JSON         COMMENT '自定义变量 JSON',
    schedule_type   VARCHAR(20)  DEFAULT 'manual' COMMENT '调度类型: manual=立即发送 / one-time=定时发送（一次性）',
    schedule_config JSON         COMMENT '调度配置 JSON（one-time 时为 {"datetime":"yyyy-MM-dd HH:mm:ss"}）',
    started_at      DATETIME     COMMENT '开始时间',
    finished_at     DATETIME     COMMENT '完成时间',
    created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    INDEX idx_status (status),
    INDEX idx_template (template_id),
    INDEX idx_smtp (smtp_config_id)
) ENGINE=InnoDB COMMENT='发送任务表';

-- v2.54 需求1：客户快照列与 campaign_send_attempts 同一套口径。
-- 失效客户现在可以删除，删除后这条发送记录要照原样显示，故把发送时的客户号/姓名/邮箱留在这里；
-- 读取一律"客户表现存资料优先、查不到才用快照"，所以客户改名后实时同步的口径不受影响（v2.17 需求1）。
-- customer_id 保留 NOT NULL 且不再建外键：留痕要能指向已删除的客户，同时任务详情的"发送次数"
-- 与逐次发送历史仍按这个 ID 关联 campaign_send_attempts，置空会让历史次数退化。
CREATE TABLE IF NOT EXISTS campaign_logs (
    id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
    campaign_id     BIGINT       NOT NULL COMMENT '关联任务 ID',
    customer_id     BIGINT       NOT NULL COMMENT '关联客户 ID（客户删除后仍保留，用于关联逐次发送留痕）',
    status          VARCHAR(20)  DEFAULT 'pending' COMMENT '状态: pending/sent/failed',
    error_message   TEXT         COMMENT '错误信息',
    sent_at         DATETIME     COMMENT '发送时间',
    customer_no     VARCHAR(12)  DEFAULT '' COMMENT '客户号快照',
    customer_name   VARCHAR(100) DEFAULT '' COMMENT '客户姓名快照',
    customer_email  VARCHAR(200) DEFAULT '' COMMENT '客户邮箱快照',
    INDEX idx_log_campaign_status (campaign_id, status),
    INDEX idx_log_customer_status (customer_id, status),
    INDEX idx_log_status_sent (status, sent_at),
    CONSTRAINT fk_log_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='发送日志表（含收件人快照，客户删除后发送历史仍完整）';

CREATE TABLE IF NOT EXISTS campaign_runs (
    id          BIGINT       PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT       NOT NULL COMMENT '关联任务 ID',
    run_type    VARCHAR(20)  NOT NULL DEFAULT 'first_batch' COMMENT '运行类型: first_batch=第一次批量 / resume=继续发送 / resend_all=全部重发',
    status      VARCHAR(20)  DEFAULT 'running' COMMENT '状态: running/completed/cancelled',
    total       INT          DEFAULT 0 COMMENT '本次运行处理的收件人数',
    sent        INT          DEFAULT 0 COMMENT '本次运行发送成功数',
    failed      INT          DEFAULT 0 COMMENT '本次运行发送失败数',
    started_at  DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
    finished_at DATETIME     COMMENT '结束时间',
    INDEX idx_run_campaign (campaign_id),
    INDEX idx_run_started (started_at),
    CONSTRAINT fk_run_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='任务发送运行历史表';

CREATE TABLE IF NOT EXISTS campaign_send_attempts (
    id              BIGINT       PRIMARY KEY AUTO_INCREMENT,
    campaign_id     BIGINT       NOT NULL COMMENT '关联任务 ID',
    run_id          BIGINT       NOT NULL COMMENT '关联运行记录 ID',
    campaign_log_id BIGINT       NOT NULL COMMENT '关联发送日志 ID',
    customer_id     BIGINT       NOT NULL COMMENT '关联客户 ID',
    customer_name   VARCHAR(100) DEFAULT '' COMMENT '客户姓名快照',
    customer_email  VARCHAR(200) DEFAULT '' COMMENT '客户邮箱快照',
    customer_company VARCHAR(200) DEFAULT '' COMMENT '客户公司快照',
    template_name    VARCHAR(200) DEFAULT '' COMMENT '模板名称快照',
    template_subject VARCHAR(500) DEFAULT '' COMMENT '实际发送主题快照',
    smtp_name        VARCHAR(100) DEFAULT '' COMMENT 'SMTP 配置名称快照',
    status          VARCHAR(20)  NOT NULL COMMENT '本次结果: sent/failed',
    error_message   TEXT         COMMENT '错误信息',
    sent_at         DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
    INDEX idx_attempt_campaign_customer (campaign_id, customer_id),
    INDEX idx_attempt_campaign_status (campaign_id, status),
    INDEX idx_attempt_run (run_id),
    INDEX idx_attempt_sent_at (sent_at),
    CONSTRAINT fk_attempt_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    CONSTRAINT fk_attempt_run FOREIGN KEY (run_id) REFERENCES campaign_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='邮件发送尝试明细表（发送时的客户/模板/SMTP 数据快照，后续资料变更不影响）';
