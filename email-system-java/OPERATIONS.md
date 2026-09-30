# 外贸邮件发送系统 -- 运维文档

> 版本：v1.0.0
> 适用版本：Spring Boot 3.2.5 / Java 17 / MySQL 8.0

---

## 目录

1. [健康检查](#1-健康检查)
2. [常见故障排查](#2-常见故障排查)
3. [日志分析](#3-日志分析)
4. [性能调优](#4-性能调优)
5. [监控建议](#5-监控建议)
6. [安全加固](#6-安全加固)
7. [运维 Checklist](#7-运维-checklist)

---

## 1. 健康检查

### 1.1 健康检查接口

系统提供了一个轻量级的健康检查端点：

| 项目 | 值 |
|------|---|
| 路径 | `GET /api/health` |
| 认证 | 无需认证 |
| 响应格式 | JSON |

**请求示例：**

```bash
curl http://localhost:8000/api/health
```

**正常响应：**

```json
{
  "status": "ok"
}
```

**HTTP 状态码：**
- `200 OK` -- 应用运行正常
- 连接失败 -- 应用未启动或端口不可达

### 1.2 健康检查脚本

```bash
#!/bin/bash
# health_check.sh - 健康检查脚本

HEALTH_URL="http://localhost:8000/api/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null)

if [ "$RESPONSE" = "200" ]; then
    echo "[OK] Email system is healthy"
    exit 0
else
    echo "[FAIL] Email system returned HTTP $RESPONSE"
    exit 1
fi
```

### 1.3 自动化健康检查（crontab）

```bash
# 每 5 分钟检查一次，失败时发送告警
*/5 * * * * /opt/email-system/health_check.sh || echo "ALERT: Email system down" | mail -s "Service Down" admin@example.com
```

### 1.4 深度健康检查（手动）

除 `/api/health` 外，还可以通过以下方式验证各组件状态：

```bash
# 1. 检查数据库连接（通过 API 查询）
curl http://localhost:8000/api/customers?page=1&page_size=1

# 2. 检查 SMTP 连通性
curl -X POST http://localhost:8000/api/smtp/test \
  -H "Content-Type: application/json" \
  -d '{"smtp_config_id": 1, "to_email": "test@example.com", "subject": "Health Test", "body": "test"}'

# 3. 检查静态资源加载
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/index.html
```

---

## 2. 常见故障排查

### 2.1 数据库连接问题

| 现象 | 可能原因 | 排查步骤 | 解决方案 |
|------|---------|---------|---------|
| `Access denied for user` | 密码错误 | 检查 `DB_PASSWORD` 环境变量 | 修正密码配置 |
| `Unknown database 'email_system'` | 数据库不存在 | `mysql -u root -p -e "SHOW DATABASES"` | 执行 `CREATE DATABASE email_system ...` |
| `Communications link failure` | MySQL 未启动或网络不通 | `systemctl status mysql` 或 `ping <db_host>` | 启动 MySQL 或检查网络 |
| `Too many connections` | 连接数耗尽 | `SHOW VARIABLES LIKE 'max_connections'` | 增加 MySQL `max_connections` 或减少 HikariCP `maximum-pool-size` |
| `Table doesn't exist` | 表未创建 | `mysql -u root -p email_system -e "SHOW TABLES"` | 执行 `schema.sql` 建表脚本 |
| `Public Key Retrieval is not allowed` | MySQL 8.0 认证问题 | 检查连接 URL | 在 URL 中添加 `allowPublicKeyRetrieval=true` |

**数据库连接诊断命令：**

```bash
# 测试 MySQL 连接
mysql -h localhost -u root -p -e "SELECT 1"

# 查看当前连接数
mysql -u root -p -e "SHOW STATUS LIKE 'Threads_connected'"

# 查看慢查询
mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query%'"
```

### 2.2 SMTP 发送问题

| 现象 | 可能原因 | 排查步骤 | 解决方案 |
|------|---------|---------|---------|
| `SMTP 认证失败` / `MailAuthenticationException` | 用户名/密码错误（多为误用登录密码代替授权码） | 查看日志中的 `[SMTP Error]`，其中含服务器原始响应 | 改用授权码 / 客户端专用密码，详见 [2.2.1](#221-认证失败authentication-failed专项排查) |
| `无法连接到 SMTP 服务器` | 网络/防火墙/端口错误 | `telnet smtp.qq.com 465` | 开放出站端口，检查主机地址 |
| `SSL/TLS 配置冲突` | SSL 和 TLS 同时启用或端口不匹配 | 检查 `use_ssl` 和 `use_tls` 标志 | SSL 用于 465，TLS 用于 587 |
| `Connection timed out` | SMTP 服务器不可达 | `nc -zv smtp.gmail.com 587` | 检查网络连通性和防火墙规则 |
| `收件人被拒绝` | 目标邮箱不存在或被拒 | 查看日志中的错误详情 | 核实收件人邮箱地址 |
| 邮件被标记为垃圾邮件 | 发信域名的 SPF/DKIM 未配置 | 检查 SMTP 服务商设置 | 配置 SPF、DKIM、DMARC 记录 |

**SMTP 诊断步骤：**

```bash
# 1. 测试端口连通性
telnet smtp.qq.com 465
# 或
nc -zv smtp.qq.com 465

# 2. 检查出站防火墙规则
iptables -L OUTPUT -n | grep 465
iptables -L OUTPUT -n | grep 587

# 3. 使用系统工具发送测试邮件（排除应用问题）
# 安装 swaks（SMTP 测试工具）
# swaks --to test@example.com --server smtp.qq.com:465 --auth LOGIN
```

#### 2.2.1 认证失败（Authentication failed）专项排查

**现象**：测试 SMTP 时报 `SMTP 认证失败` 或 `MailAuthenticationException`。

**先看报错里的「服务器响应」**（v2.11 起已内置）。例如：

| 服务器响应 | 含义 | 处理方向 |
|-----------|------|---------|
| `526 Authentication failure[0]` | 阿里企业邮箱：密码错误 | 需使用「客户端专用密码」 |
| `535 Login Fail. Please enter your authorization code` | QQ/163：未用授权码 | 改用授权码 |
| `535 Authentication failed` | 通用密码错误 | 核对账号密码 |
| `550 User not found` | 账号不存在 | 核对用户名（需完整邮箱地址） |

**手工探测认证（不依赖应用）**：使用 `swaks` 可看到完整 SMTP 对话

```bash
# QQ 邮箱（465 隐式 SSL）
swaks --to your@qq.com --server smtp.qq.com:465 --auth LOGIN \
      --auth-user your@qq.com --auth-password <授权码> -tls

# 阿里企业邮箱
swaks --to you@company.com --server smtp.qiye.aliyun.com:465 --auth LOGIN \
      --auth-user you@company.com --auth-password <客户端专用密码>
```

**关键判断**：若握手能走到「password」提示后才失败，说明**网络、端口、SSL、用户名都正常，问题只在密码本身** —— 可直接聚焦凭据排查，无需检查网络。

**各服务商凭据要求**：

| 服务商 | SMTP 主机 | 凭据要求 | 获取路径 |
|--------|----------|---------|---------|
| QQ 邮箱 | smtp.qq.com:465 | **授权码**（16 位） | 设置 → 账户 → 开启 IMAP/SMTP 服务 → 生成授权码 |
| 163 邮箱 | smtp.163.com:465 | **授权码**（16 位） | 设置 → POP3/SMTP/IMAP → 开启服务 → 新增授权码 |
| 阿里企业邮箱 | smtp.qiye.aliyun.com:465 | **客户端专用密码** | 企业邮箱网页版 → 设置 → 安全设置 → 客户端专用密码 |
| Gmail | smtp.gmail.com:587 | **应用专用密码** | 需先开启两步验证，再生成应用密码 |
| 腾讯企业邮箱 | smtp.exmail.qq.com:465 | 邮箱登录密码 | 由管理员在管理后台确认 |

**常见误用**：

1. **用邮箱登录密码代替授权码** —— 最高频原因。QQ/163 的登录密码无法用于 SMTP。
2. **授权码被重置** —— 重新生成授权码会使旧码立即失效。
3. **复制时带入空格** —— QQ/163 授权码在页面上按 4 位分组显示（如 `abcd efgh ijkl mnop`），须去掉空格后粘贴（应为 16 位不连续字符串）。
4. **用户名不是完整邮箱** —— 应填 `user@domain.com`，而非 `user`。
5. **客户端专用密码未生成** —— 若企业邮箱管理员启用了「强制安全登录」，必须使用专用密码。

**验证凭据长度**：QQ / 163 授权码固定 16 位；阿里企业邮箱客户端专用密码通常为 16 位。若数据库中密码长度明显不符（如 13 位），很可能是误填了登录密码。

### 2.3 静态资源问题

| 现象 | 可能原因 | 排查步骤 | 解决方案 |
|------|---------|---------|---------|
| 页面白屏/404 | 静态资源路径错误 | `curl http://localhost:8000/index.html` | 检查 `src/main/resources/static/` 目录 |
| CSS/JS 加载失败 | 资源处理器配置问题 | 查看浏览器开发者工具 Network 面板 | 确认 `WebConfig.java` 中的资源映射 |
| API 返回 404 | 接口路径错误 | `curl http://localhost:8000/api/health` | 检查 Controller 的 `@RequestMapping` |
| 上传文件失败 | 文件大小超限 | 查看错误响应 | 检查 `max-file-size` 和 `max-request-size` 配置 |

**静态资源路径说明：**

```
请求路径          → 实际文件位置
/index.html       → src/main/resources/static/index.html
/css/style.css    → src/main/resources/static/css/style.css
/js/app.js        → src/main/resources/static/js/app.js
/static/**        → src/main/resources/static/**
```

### 2.4 发送任务问题

| 现象 | 可能原因 | 排查步骤 | 解决方案 |
|------|---------|---------|---------|
| 任务无法启动 | 状态不是 pending | 检查任务状态字段 | 确保任务处于 pending 状态 |
| 任务无法取消 | 线程未响应中断 | 查看线程池状态 | 检查 `Thread.sleep` 是否可被中断 |
| 发送速度异常慢 | 间隔设置过大 | 检查 `interval_sec` | 调整为合适的间隔值 |
| 大量发送失败 | SMTP 连接不稳定 | 查看日志中的 `[SMTP Error]` | 增加间隔、检查网络、联系 SMTP 服务商 |
| 重启后运行中任务丢失 | `ConcurrentHashMap` 为内存存储 | 这是已知限制（ARC-03） | 重启后需手动重新发送未完成的任务 |
| 任务编辑按钮不显示 | 任务正在发送中 | 查看 `is_running` / `status` | 仅"发送中"的任务不可编辑，请先取消再编辑 |
| 编辑任务后进度被重置 | 编辑会重建发送记录 | 属预期行为 | 编辑将清空日志并重置为待发送，如需保留进度请勿编辑 |
| 编辑已完成任务后无法再看到发送记录 | 编辑按"重置并重新发送全部"语义执行 | 查看 campaign_logs | 属预期行为；如仅需重发请用「全部重发」而非编辑 |
| 「生效」按钮置灰 | 所选客户均已是生效状态，或选中记录状态混合 | 查看客户状态列 | 属正常的互斥禁用，选择失效客户后即可用 |
| 「失效」按钮置灰 | 所选客户均已是失效状态，或选中记录状态混合 | 查看客户状态列 | 属正常的互斥禁用，选择生效客户后即可用 |
| 混合选择时三个操作按钮都置灰 | 设计如此：状态不一致时批量变更会造成部分生效的认知偏差 | 查看选中记录的状态列 | 此为预期行为；如需变更请先按状态筛选后再批量操作 |
| 「删除」按钮置灰（客户管理） | 所选客户不全是失效状态（含生效或混合） | 查看选中记录的「状态」列，悬停按钮看提示 | 先对选中的生效客户执行「失效」，再点「删除」 |
| 「删除」按钮置灰（发送任务） | 任务状态非「已完成/已取消」 | 查看任务状态列，悬停按钮看提示 | 待发送/发送中/失败的任务不可删除；如需清理请先取消任务 |
| 误删了客户 | 删除前未做备份 | 检查是否为失效客户 | 删除不可撤销，建议先「导出 CSV」备份；失效操作可逆，删除不可逆 |
| 部分客户未被发送 | 客户已被设为失效 | 查看 `customers.status` | 在客户管理中将客户“设为有效” |
| 日志出现“客户已失效，跳过发送” | 任务创建后客户被改为失效 | 查看 campaign_logs | 属预期拦截行为，该条记录标记为失败 |

**客户有效性排查命令：**

```sql
-- 统计各状态客户数量
SELECT status, COUNT(*) AS cnt FROM customers GROUP BY status;

-- 查看某任务中是否有失效客户残留
SELECT cl.id, cl.status, cl.error_message, c.name, c.email, c.status AS customer_status
FROM campaign_logs cl
JOIN customers c ON cl.customer_id = c.id
WHERE cl.campaign_id = <任务ID> AND c.status = 'inactive';
```

---

### 2.5 客户有效性管理

#### 2.5.1 状态说明

| 状态 | 值 | 行为 |
|------|----|------|
| 有效 | `active` | 可被发送任务选中并接收邮件 |
| 失效 | `inactive` | 不出现在发送任务的客户列表中；若任务中残留该客户，发送时跳过并记为失败 |

#### 2.5.2 变更方式

1. **单个客户**：客户管理 → 编辑 → 客户有效性下拉框
2. **批量设置**：客户管理 → 勾选多个客户 → 「生效」 / 「失效」

> **按钮互斥规则**：
> - 所选客户全部为生效状态时，「生效」置灰；
> - 全部为失效状态时，「失效」置灰；
> - 混合选择（既有生效又有失效）时，「生效」「失效」「删除」均置灰；
> - **「删除」仅在所选客户全部为失效状态时可用**。
>
> 按钮上的数字表示**本次实际会变更**的记录数。
>
> **删除生效客户的操作路径**：先勾选客户 → 点「失效」→ 再点「删除」。
>
> **禁用态视觉约定（全站统一）**：按钮不可用时统一显示为**灰色**（`#E5E7EB` 底 + 灰色文字）
> 且无法点击；可用时按语义着色（删除 = 红色，生效 = 灰色，失效 = 灰色）。
> 所有删除按钮**常驻显示**，不会因条件不满足而消失——用户可悬停查看禁用原因。

#### 2.5.3 注意事项

- 新建、导入的客户默认状态为**有效**
- 失效客户**不会**被删除，数据仍保留，可随时恢复为生效
- 创建/编辑发送任务时，“发送给全部客户”统计的仅为**有效客户**人数
- 后端会二次校验：即使通过接口传入失效客户 ID，也会被自动过滤
- 批量操作仅对**状态需要变更**的客户发起请求，已是目标状态的客户会被自动跳过

---

### 2.6 客户导入问题

#### 2.6.1 导入后中文显示乱码

**现象**：导入的客户，国家 / 标签等中文字段显示为 `����2` 这类乱码。

**原因**：CSV 文件编码与系统解码方式不一致。中文 Windows 下 Excel「另存为 CSV」默认使用 **ANSI（即 GBK）**，而早期版本按 UTF-8 解码，GBK 中文会被解析成 `U+FFFD` 替换字符。

**自 v2.14 起已修复**：系统会自动识别编码，兼容 UTF-8、UTF-8+BOM、GBK/GB2312、GB18030、UTF-16。

**排查命令**：

```bash
# 查看是否触发了编码回退（说明文件不是 UTF-8，已被正确按 GB18030 解码）
grep "按 GB18030 解码" logs/app.log

# 查看导入记录
grep "FileService" logs/app.log | tail -20
```

**若仍出现乱码**，按以下顺序检查：

| 检查项 | 说明 |
|--------|------|
| 文件是否为 `.xls`（旧格式） | 系统仅支持 `.csv` 与 `.xlsx`；`.xls` 会返回 0 条记录，需另存为 `.xlsx` |
| 是否含特殊字符 | 检查文件是否被其他工具二次转码 |
| 是否为 UTF-16（无 BOM） | 无 BOM 的 UTF-16 无法自动识别，建议另存为「CSV UTF-8」 |

> **推荐做法**：在 Excel 中保存时选择 **「CSV UTF-8（逗号分隔）」**，可彻底避免编码歧义。

#### 2.6.2 已乱码的数据无法自动修复

`U+FFFD` 表示「此处原有非法字节，但已无法还原」——原始字节信息**永久丢失**，
因此**不能通过程序批量修正**。

**处理方式**：

1. 先导出备份现有数据（客户管理 → 导出 CSV），便于比对
2. 删除乱码的客户记录
3. 用**正确编码的文件**重新导入

**定位乱码记录**（查找含替换字符的记录）：

```sql
-- 替换字符 U+FFFD 在 utf8mb4 下编码为 EF BF BD
SELECT id, name, country, tags
FROM customers
WHERE country LIKE CONCAT('%', UNHEX('EFBFBD'), '%')
   OR tags    LIKE CONCAT('%', UNHEX('EFBFBD'), '%')
   OR name    LIKE CONCAT('%', UNHEX('EFBFBD'), '%');
```

**预防**：导入前先确认文件编码；若从本系统导出后经 Excel 编辑，务必另存为「CSV UTF-8」再导入。

---

## 3. 日志分析

### 3.1 日志查看

```bash
# 查看实时日志
tail -f logs/email-system.log

# systemd 方式查看日志
journalctl -u email-system -f

# 查看最近 100 行日志
journalctl -u email-system -n 100

# 按时间范围查看
journalctl -u email-system --since "2026-09-10 10:00:00" --until "2026-09-10 12:00:00"
```

### 3.2 关键日志关键词

| 关键词 | 说明 | 出现场景 |
|--------|------|---------|
| `[SMTP Debug]` | SMTP 调试信息 | 邮件发送过程中的连接、登录、发送步骤 |
| `[SMTP Error]` | SMTP 错误信息 | 邮件发送失败时的详细错误（含 host/port/user 与服务器原始响应） |
| `SMTP 认证失败` | 认证失败（凭据错误） | 密码/授权码不正确，见 [2.2.1](#221-认证失败authentication-failed专项排查) |
| `SMTP 发送失败` | 发送阶段失败 | 连接、TLS 或收件人被拒等问题 |
| `按 GB18030 解码` | 导入的 CSV 非 UTF-8，已自动回退按 GB18030 解码 | 属正常的兼容处理；建议将文件另存为「CSV UTF-8」 |
| `导入成功` / `imported` | 客户导入完成 | 批量导入客户时 |
| `Started EmailSystemApplication` | 应用启动完成 | 正常启动 |
| `Tomcat started on port(s): 8000` | Tomcat 就绪 | 正常启动 |
| `Failed to configure a DataSource` | 数据库连接失败 | 数据库配置错误 |
| `BeanCreationException` | Spring Bean 创建失败 | 配置或依赖注入错误 |
| `OutOfMemoryError` | 内存溢出 | JVM 堆内存不足 |
| `RejectedExecutionException` | 线程池任务被拒绝 | 线程池已满，任务队列溢出 |

### 3.3 日志分析命令

```bash
# 统计 SMTP 错误次数
grep -c "\[SMTP Error\]" logs/email-system.log

# 查看所有 SMTP 错误详情
grep "\[SMTP Error\]" logs/email-system.log | tail -20

# 统计认证失败次数
grep "认证失败" logs/email-system.log | wc -l

# 查看今天的错误日志
grep "$(date +%Y-%m-%d)" logs/email-system.log | grep -i "error"

# 统计发送成功/失败比例
echo "成功: $(grep -c 'Email sent successfully' logs/email-system.log)"
echo "失败: $(grep -c '\[SMTP Error\]' logs/email-system.log)"

# 查找慢请求（如果有响应时间日志）
grep "Slow" logs/email-system.log
```

### 3.4 启用调试日志

临时启用更详细的日志（无需重启，通过配置调整）：

```yaml
# application.yml
logging:
  level:
    com.emailsystem: DEBUG              # 应用所有类的调试日志
    com.emailsystem.service.EmailService: DEBUG  # 仅邮件发送调试
    org.springframework.mail: DEBUG     # Spring Mail 框架调试
    com.zaxxer.hikari: DEBUG           # 连接池调试
```

---

## 4. 性能调优

### 4.1 发送线程池调优

线程池配置位于 `application.yml` 的 `email.task.pool` 节点：

| 参数 | 默认值 | 说明 | 调优建议 |
|------|--------|------|---------|
| `core-size` | 5 | 核心线程数 | 一般保持默认，若同时运行多个任务可适当增加 |
| `max-size` | 10 | 最大线程数 | 不建议超过 20，避免对 SMTP 服务器产生过大压力 |
| `queue-capacity` | 100 | 任务队列容量 | 如果有大量并发任务排队，可增加到 200-500 |

**调优示例：**

```yaml
email:
  task:
    pool:
      core-size: 5      # 保持 5 个核心线程处理发送任务
      max-size: 10      # 峰值时最多 10 个并发线程
      queue-capacity: 200  # 允许 200 个任务排队等待
```

**注意事项：**
- 线程数并非越大越好，SMTP 服务器通常有并发限制
- 发送间隔（`interval_sec`）是控制发送速率的主要手段
- 拒绝策略为 `CallerRunsPolicy`，队列满时提交线程会直接执行任务

### 4.2 HikariCP 连接池调优

| 参数 | 默认值 | 说明 | 调优建议 |
|------|--------|------|---------|
| `maximum-pool-size` | 20 | 最大连接数 | 一般 10-20 足够，公式：`核心数 * 2 + 磁盘数` |
| `minimum-idle` | 5 | 最小空闲连接 | 设为 `maximum-pool-size` 的 1/4 |
| `idle-timeout` | 300000 (5min) | 空闲连接超时 | 保持默认 |
| `max-lifetime` | 1800000 (30min) | 连接最大生命周期 | 必须小于 MySQL `wait_timeout` |
| `connection-timeout` | 30000 (30s) | 获取连接超时 | 高并发时可适当增加 |

**高并发场景推荐配置：**

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 30        # 增加连接池大小
      minimum-idle: 10             # 保持更多空闲连接
      idle-timeout: 300000
      max-lifetime: 1200000        # 20分钟，小于 MySQL wait_timeout
      connection-timeout: 60000    # 1分钟获取超时
      leak-detection-threshold: 60000  # 启用连接泄漏检测
```

**低负载场景推荐配置：**

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 10        # 减少连接池大小
      minimum-idle: 2              # 保持最少空闲连接
      idle-timeout: 600000         # 10分钟空闲超时
      max-lifetime: 1800000
```

### 4.3 JVM 调优

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `-Xms` | 512m | 初始堆内存 |
| `-Xmx` | 1024m | 最大堆内存 |
| `-XX:+UseG1GC` | - | 使用 G1 垃圾回收器（Java 17 默认） |
| `-XX:MaxGCPauseMillis` | 200 | 最大 GC 停顿时间 |
| `-XX:+HeapDumpOnOutOfMemoryError` | - | OOM 时自动转储堆内存 |
| `-XX:HeapDumpPath` | ./heapdump.hprof | 堆转储文件路径 |

**生产环境 JVM 参数示例：**

```bash
java -Xms512m -Xmx1024m \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=200 \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/opt/email-system/logs/heapdump.hprof \
     -jar email-system-1.0.0.jar
```

### 4.4 MySQL 调优

```sql
-- 查看当前连接数和最大连接数
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';

-- 增加最大连接数
SET GLOBAL max_connections = 200;

-- 查看慢查询阈值
SHOW VARIABLES LIKE 'long_query_time';

-- 启用慢查询日志
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;  -- 超过 1 秒的查询记录

-- 查看 InnoDB 缓冲池大小
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';

-- 推荐设置为物理内存的 60-70%
-- SET GLOBAL innodb_buffer_pool_size = 2147483648;  -- 2GB
```

### 4.5 发送速率优化

| 场景 | 建议间隔 | 说明 |
|------|---------|------|
| QQ 邮箱 SMTP | 5-10 秒 | 有日发送量和频率限制 |
| 163 邮箱 SMTP | 5-10 秒 | 有日发送量限制 |
| Gmail SMTP | 3-5 秒 | 日发送上限约 500 封（免费）/ 2000 封（付费） |
| 企业邮箱/专用 SMTP | 1-3 秒 | 根据服务商限制调整 |
| Amazon SES | 1 秒 | 按发送配额和速率限制调整 |

---

## 5. 监控建议

### 5.1 基础监控指标

| 类别 | 指标 | 告警阈值 | 检查方式 |
|------|------|---------|---------|
| 可用性 | HTTP 健康检查 | 连续 3 次失败 | `curl /api/health` |
| 可用性 | 进程存活 | 进程不存在 | `ps aux \| grep java` |
| 数据库 | 连接池使用率 | > 80% | HikariCP MBean |
| 数据库 | MySQL 连接数 | > max_connections * 0.8 | `SHOW STATUS` |
| 发送 | 发送失败率 | > 20% | 统计 campaign_logs 状态 |
| 发送 | 任务队列深度 | > queue_capacity * 0.8 | 线程池 MBean |
| 系统 | CPU 使用率 | > 80% 持续 5 分钟 | `top` / `htop` |
| 系统 | 内存使用率 | > 85% | `free -m` |
| 系统 | 磁盘使用率 | > 90% | `df -h` |

### 5.2 集成 Spring Boot Actuator（推荐）

如需更完善的监控能力，建议后续集成 Spring Boot Actuator：

```xml
<!-- pom.xml 中添加依赖 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

```yaml
# application.yml 中添加配置
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,hikaricp,threaddump
  endpoint:
    health:
      show-details: when-authorized
  metrics:
    tags:
      application: email-system
```

集成后可获得的监控端点：

| 端点 | 说明 |
|------|------|
| `/actuator/health` | 增强版健康检查（含数据库、磁盘状态） |
| `/actuator/metrics` | 所有 Spring Boot 指标（JVM、HTTP、数据库等） |
| `/actuator/metrics/hikaricp.connections` | HikariCP 连接池详细指标 |
| `/actuator/threaddump` | 当前线程快照 |
| `/actuator/info` | 应用信息 |

### 5.3 Prometheus + Grafana 监控（进阶）

如果已集成 Actuator，可以接入 Prometheus 进行指标采集：

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'email-system'
    metrics_path: '/actuator/prometheus'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:8000']
```

**推荐 Grafana 面板：**
- JVM 内存和 GC 监控
- HikariCP 连接池监控
- HTTP 请求延迟和吞吐量
- 邮件发送成功率/失败率

### 5.4 数据库监控

```sql
-- 查看当前运行的查询
SHOW PROCESSLIST;

-- 查看锁等待
SELECT * FROM information_schema.innodb_lock_waits;

-- 查看表大小
SELECT
  table_name,
  ROUND(data_length / 1024 / 1024, 2) AS data_mb,
  ROUND(index_length / 1024 / 1024, 2) AS index_mb,
  table_rows
FROM information_schema.tables
WHERE table_schema = 'email_system'
ORDER BY data_length DESC;

-- 查看索引使用情况
SELECT * FROM sys.schema_unused_indexes WHERE object_schema = 'email_system';
```

---

## 6. 安全加固

### 6.1 当前安全风险

| 风险 | 严重程度 | 当前状态 | 建议措施 |
|------|---------|---------|---------|
| 无身份认证 | 高 | 未修复 | 集成 Spring Security + JWT |
| SMTP 密码明文存储 | 高 | 未修复 | 使用 Jasypt 加密 |
| HTTP 明文传输 | 高 | 部分修复 | 生产环境必须启用 HTTPS |
| 无请求频率限制 | 中 | 未修复 | 添加 Rate Limiter |
| CORS 全开放 | 中 | 未修复 | 限制允许的来源域名 |

### 6.2 生产环境安全 Checklist

- [ ] 启用 HTTPS（Nginx 配置 SSL）
- [ ] 修改数据库默认密码
- [ ] 通过环境变量传递敏感配置，不写入配置文件
- [ ] 限制 MySQL 仅允许本地连接
- [ ] 配置防火墙规则，仅开放 80/443 端口
- [ ] 关闭应用服务器的不必要端口
- [ ] 定期更新 JDK 和依赖版本

---

## 7. 运维 Checklist

### 7.1 日常检查（每日）

- [ ] 执行健康检查：`curl http://localhost:8000/api/health`
- [ ] 检查磁盘空间：`df -h`
- [ ] 查看错误日志：`grep -i error logs/email-system.log | tail -20`
- [ ] 检查失败发送任务数量

### 7.2 每周维护

- [ ] 查看数据库备份是否成功
- [ ] 检查日志文件大小，必要时轮转
- [ ] 查看发送统计表，关注失败率异常的任务
- [ ] 检查系统资源使用趋势

### 7.3 每月维护

- [ ] 清理已完成/已取消的历史发送任务（减少数据库占用）
- [ ] 更新 JDK 安全补丁（如有）
- [ ] 检查 Maven 依赖是否有已知漏洞
- [ ] 清理过期的日志文件

```sql
-- 清理 30 天前已完成的发送任务及日志（CASCADE 会自动删除 campaign_logs）
DELETE FROM campaigns
WHERE status = 'completed'
  AND finished_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
```

### 7.4 应急响应流程

```
发现问题
    │
    ├── 健康检查失败
    │   ├── 检查进程是否存活：ps aux | grep email-system
    │   ├── 检查端口监听：ss -tlnp | grep 8000
    │   ├── 检查最近日志：tail -50 logs/email-system.log
    │   └── 尝试重启：systemctl restart email-system
    │
    ├── 邮件发送大量失败
    │   ├── 检查 SMTP 连接：telnet smtp.xxx.com 465
    │   ├── 查看 SMTP 错误日志
    │   ├── 确认 SMTP 账号未被封禁
    │   └── 联系 SMTP 服务商
    │
    ├── 数据库连接失败
    │   ├── 检查 MySQL 服务：systemctl status mysql
    │   ├── 检查连接数：SHOW STATUS LIKE 'Threads_connected'
    │   └── 检查磁盘空间：df -h
    │
    └── 性能下降
        ├── 检查 CPU/内存使用：top
        ├── 检查慢查询：SHOW PROCESSLIST
        ├── 检查连接池状态
        └── 检查发送任务数量
```

---

*文档结束*
