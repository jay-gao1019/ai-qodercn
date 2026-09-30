# 外贸邮件发送系统 -- 部署文档

> 版本：v1.0.0
> 技术栈：Spring Boot 3.2.5 / Java 17 / MySQL 8.0 / Maven 3.9+

---

## 目录

1. [系统要求](#1-系统要求)
2. [构建说明](#2-构建说明)
3. [数据库配置](#3-数据库配置)
4. [应用配置](#4-应用配置)
5. [启动与停止](#5-启动与停止)
6. [日志说明](#6-日志说明)
7. [Docker 部署](#7-docker-部署)
8. [Nginx 反向代理](#8-nginx-反向代理)
9. [备份建议](#9-备份建议)
10. [升级指南](#10-升级指南)

---

## 1. 系统要求

### 1.1 运行时环境

| 组件 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| Java (JDK/JRE) | 17 | 17 LTS | Spring Boot 3.2.5 要求 Java 17+ |
| MySQL | 8.0 | 8.0.33+ | 需要 InnoDB 引擎和 utf8mb4 字符集 |
| Maven | 3.9+ | 3.9.6+ | 仅构建时需要，运行时无需 |

### 1.2 硬件建议

| 场景 | CPU | 内存 | 磁盘 | 说明 |
|------|-----|------|------|------|
| 开发/测试 | 1 核 | 1 GB | 10 GB | 足够运行 MySQL + 应用 |
| 小型生产（< 1000 客户） | 2 核 | 2 GB | 20 GB | 含数据库 |
| 中型生产（1000-10000 客户） | 4 核 | 4 GB | 50 GB | 数据库独立部署 |

### 1.3 网络要求

| 端口 | 方向 | 说明 |
|------|------|------|
| 8000 | 入站 | 应用 HTTP 服务端口 |
| 3306 | 本地 | MySQL 数据库端口（仅本地访问） |
| 465/587 | 出站 | SMTP 邮件发送端口（SSL/TLS） |

---

## 2. 构建说明

### 2.1 获取源码

```bash
# 进入项目目录
cd email-system-java
```

### 2.2 Maven 构建

```bash
# 构建生产 JAR 包（跳过测试）
mvn clean package -DskipTests

# 构建输出位置
# target/email-system-1.0.0.jar
```

### 2.3 构建产物

| 文件 | 大小 | 说明 |
|------|------|------|
| `target/email-system-1.0.0.jar` | 约 50-80 MB | 包含所有依赖的 fat JAR |

### 2.4 开发环境运行

```bash
# 直接运行（使用 Maven 插件）
mvn spring-boot:run

# 指定开发环境配置
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

---

## 3. 数据库配置

### 3.1 创建数据库

在部署应用前，需要先创建 MySQL 数据库：

```sql
CREATE DATABASE IF NOT EXISTS email_system
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
```

### 3.2 初始化表结构

建表脚本位于：`src/main/resources/db/schema.sql`

**方式一：应用自动建表（推荐）**

应用启动时会自动执行 `schema.sql`（通过 `spring.sql.init` 配置），无需手动操作：

```yaml
spring:
  sql:
    init:
      mode: always
      schema-locations: classpath:db/schema.sql
      continue-on-error: false
      encoding: UTF-8
```

**方式二：手动执行**

```bash
mysql -u root -p < src/main/resources/db/schema.sql
```

> 说明：`schema.sql` 使用 `CREATE TABLE IF NOT EXISTS`，已存在的表不会被修改。
> 对于历史库的字段升级（如 `customers.status`），应用启动时会通过
> `SchemaMigrationRunner` 自动完成幂等迁移，无需手动执行 SQL。

### 3.3 数据库连接参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 主机 | localhost | MySQL 服务器地址 |
| 端口 | 3306 | MySQL 默认端口 |
| 数据库名 | email_system | 数据库名称 |
| 用户名 | root | 数据库用户 |
| 密码 | root@123 | 数据库密码（通过环境变量覆盖） |
| 字符集 | utf8mb4 | 完整 Unicode 支持 |

### 3.4 数据库表清单

| 表名 | 说明 | 外键 |
|------|------|------|
| smtp_configs | SMTP 配置表 | 无 |
| customers | 客户表（含 `status` 有效性字段） | 无 |
| templates | 模板表 | 无 |
| variables | 全局变量表 | 无 |
| campaigns | 发送任务表 | FK -> templates, smtp_configs |
| campaign_logs | 发送日志表 | FK -> campaigns (CASCADE), customers |

#### customers.status 字段

| 值 | 含义 | 影响 |
|----|------|------|
| `active` | 有效客户 | 可被发送任务选中并接收邮件 |
| `inactive` | 失效客户 | 不出现在发送任务客户列表；如残留记录则跳过发送 |

> 该字段由应用启动时的 `SchemaMigrationRunner` 自动补充，历史数据默认置为 `active`。

---

## 4. 应用配置

### 4.1 配置文件位置

| 文件 | 说明 |
|------|------|
| `src/main/resources/application.yml` | 主配置文件（所有环境共享） |
| `application-dev.yml` | 开发环境配置（可选） |
| `application-prod.yml` | 生产环境配置（可选） |

### 4.2 核心配置项

```yaml
server:
  port: 8000                           # 服务端口

spring:
  datasource:
    url: jdbc:mysql://localhost:3306/email_system?useUnicode=true&characterEncoding=utf-8&useSSL=false&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&createDatabaseIfNotExist=true
    username: root                      # 数据库用户
    password: ${DB_PASSWORD:root@123}   # 数据库密码（支持环境变量）
    hikari:
      maximum-pool-size: 20             # 最大连接数
      minimum-idle: 5                   # 最小空闲连接
      idle-timeout: 300000              # 空闲超时（ms）
      max-lifetime: 1800000             # 连接最大生命周期（ms）

  servlet:
    multipart:
      max-file-size: 10MB               # 单文件上传大小限制
      max-request-size: 10MB            # 请求体大小限制

email:
  task:
    pool:
      core-size: 5                      # 发送线程池核心线程数
      max-size: 10                      # 发送线程池最大线程数
      queue-capacity: 100               # 任务队列容量
```

### 4.3 环境变量

通过环境变量覆盖配置文件中的值（推荐用于敏感信息）：

| 环境变量 | 对应配置 | 默认值 | 说明 |
|---------|---------|--------|------|
| `DB_PASSWORD` | `spring.datasource.password` | `root@123` | 数据库密码 |
| `DB_HOST` | `spring.datasource.url` 中的主机 | `localhost` | 数据库主机 |
| `DB_PORT` | `spring.datasource.url` 中的端口 | `3306` | 数据库端口 |
| `DB_NAME` | `spring.datasource.url` 中的库名 | `email_system` | 数据库名 |
| `DB_USERNAME` | `spring.datasource.username` | `root` | 数据库用户名 |
| `SERVER_PORT` | `server.port` | `8000` | 服务端口 |
| `JAVA_OPTS` | - | - | JVM 启动参数 |

### 4.4 通过命令行覆盖配置

```bash
# 覆盖数据库密码
java -jar email-system-1.0.0.jar --spring.datasource.password=my_password

# 覆盖端口
java -jar email-system-1.0.0.jar --server.port=9000

# 指定生产环境
java -jar email-system-1.0.0.jar --spring.profiles.active=prod
```

---

## 5. 启动与停止

### 5.1 启动命令

```bash
# 基础启动
java -jar target/email-system-1.0.0.jar

# 带 JVM 参数启动（推荐生产环境）
java -Xms512m -Xmx1024m \
     -jar target/email-system-1.0.0.jar \
     --spring.profiles.active=prod

# 后台运行
nohup java -Xms512m -Xmx1024m \
     -jar target/email-system-1.0.0.jar \
     --spring.profiles.active=prod \
     > /dev/null 2>&1 &

# 指定日志输出文件
nohup java -jar target/email-system-1.0.0.jar \
     > logs/app.log 2>&1 &
```

### 5.2 启动验证

应用启动成功后（默认端口 8000），可通过以下方式验证：

```bash
# 健康检查
curl http://localhost:8000/api/health

# 预期响应
# {"status":"ok"}
```

### 5.3 停止命令

```bash
# 查找进程 ID
ps aux | grep email-system

# 或使用 jps
jps -l | grep email-system

# 优雅停止（发送 SIGTERM）
kill <PID>

# 强制停止（仅在优雅停止无效时使用）
kill -9 <PID>
```

### 5.4 systemd 服务（Linux 生产环境）

创建 `/etc/systemd/system/email-system.service`：

```ini
[Unit]
Description=Email Sending System
After=network.target mysql.service

[Service]
Type=simple
User=appuser
WorkingDirectory=/opt/email-system
ExecStart=/usr/bin/java -Xms512m -Xmx1024m -jar /opt/email-system/email-system-1.0.0.jar --spring.profiles.active=prod
ExecStop=/bin/kill -TERM $MAINPID
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

Environment=DB_PASSWORD=your_secure_password

[Install]
WantedBy=multi-user.target
```

```bash
# 启用服务
sudo systemctl daemon-reload
sudo systemctl enable email-system

# 启动/停止/重启
sudo systemctl start email-system
sudo systemctl stop email-system
sudo systemctl restart email-system

# 查看状态
sudo systemctl status email-system
```

---

## 6. 日志说明

### 6.1 日志位置

| 运行方式 | 日志位置 |
|---------|---------|
| `mvn spring-boot:run` | 控制台标准输出 |
| `java -jar` (前台) | 控制台标准输出 |
| `nohup java -jar` | 启动目录下 `nohup.out` 或重定向到指定文件 |
| systemd | `journalctl -u email-system` |

### 6.2 日志级别配置

在 `application.yml` 中配置：

```yaml
logging:
  level:
    root: INFO
    com.emailsystem: DEBUG           # 应用日志级别
    com.emailsystem.service: INFO    # 服务层日志级别
  file:
    name: logs/email-system.log      # 日志文件路径
  logback:
    rollingpolicy:
      max-file-size: 10MB
      max-history: 30
```

### 6.3 关键日志标识

| 日志前缀 | 说明 |
|---------|------|
| `[SMTP Debug]` | SMTP 连接和发送过程的调试信息 |
| `[SMTP Error]` | SMTP 发送失败的错误信息 |
| `CampaignService` | 发送任务的创建、启动、取消等操作 |

---

## 7. Docker 部署

### 7.1 Dockerfile（多阶段构建）

```dockerfile
# === 构建阶段 ===
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn clean package -DskipTests

# === 运行阶段 ===
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

# 创建日志目录
RUN mkdir -p /app/logs

EXPOSE 8000

ENTRYPOINT ["java", "-Xms512m", "-Xmx1024m", "-jar", "app.jar"]
```

### 7.2 docker-compose.yml

```yaml
version: '3.8'

services:
  mysql:
    image: mysql:8.0
    container_name: email-mysql
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD:-root@123}
      MYSQL_DATABASE: email_system
      MYSQL_CHARACTER_SET_SERVER: utf8mb4
      MYSQL_COLLATION_SERVER: utf8mb4_unicode_ci
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
      - ./src/main/resources/db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    container_name: email-system
    ports:
      - "8000:8000"
    environment:
      DB_PASSWORD: ${DB_PASSWORD:-root@123}
      SPRING_DATASOURCE_URL: jdbc:mysql://mysql:3306/email_system?useUnicode=true&characterEncoding=utf-8&useSSL=false&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&createDatabaseIfNotExist=true
    depends_on:
      mysql:
        condition: service_healthy
    restart: on-failure

volumes:
  mysql_data:
```

### 7.3 Docker 启动

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f app

# 停止
docker-compose down

# 停止并清除数据
docker-compose down -v
```

---

## 8. Nginx 反向代理

### 8.1 基础配置

```nginx
server {
    listen 80;
    server_name mail.yourdomain.com;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 30s;
        proxy_read_timeout 120s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 8.2 HTTPS 配置（推荐）

```nginx
server {
    listen 443 ssl;
    server_name mail.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/mail.yourdomain.com.pem;
    ssl_certificate_key /etc/ssl/private/mail.yourdomain.com.key;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name mail.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

---

## 9. 备份建议

### 9.1 数据库备份

```bash
# 完整备份
mysqldump -u root -p email_system > backup_$(date +%Y%m%d_%H%M%S).sql

# 压缩备份
mysqldump -u root -p email_system | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# 定时备份（crontab）
# 每天凌晨 2 点自动备份
0 2 * * * mysqldump -u root -pYOUR_PASSWORD email_system | gzip > /backup/email_$(date +\%Y\%m\%d).sql.gz

# 保留最近 30 天的备份
0 3 * * * find /backup -name "email_*.sql.gz" -mtime +30 -delete
```

### 9.2 需要备份的数据

| 数据 | 位置 | 说明 |
|------|------|------|
| MySQL 数据库 | email_system 库 | 包含所有业务数据（SMTP 配置、客户、模板、变量、任务、日志） |
| 应用配置 | `application.yml` | 如通过文件方式管理配置 |

### 9.3 恢复

```bash
# 从备份恢复数据库
mysql -u root -p email_system < backup_20260910_020000.sql

# 从压缩文件恢复
gunzip < backup_20260910_020000.sql.gz | mysql -u root -p email_system
```

---

## 10. 升级指南

### 10.1 升级步骤

1. **备份数据库**（必须）
2. **停止应用**
3. **替换 JAR 文件**：将新版本 JAR 复制到部署目录
4. **执行数据库迁移**：如有新表或字段变更，执行增量 SQL 脚本
5. **启动新版本应用**
6. **验证健康检查**：`curl http://localhost:8000/api/health`

### 10.2 回滚

1. 停止新版本应用
2. 恢复旧版本 JAR 文件
3. 从备份恢复数据库（如有数据变更）
4. 启动旧版本应用

---

## 附录：常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 启动报 `Cannot load driver class` | MySQL 驱动未加载 | 检查 `pom.xml` 中是否包含 `mysql-connector-j` 依赖 |
| `Access denied for user 'root'@'localhost'` | 数据库密码错误 | 检查 `DB_PASSWORD` 环境变量或 `application.yml` 中的密码 |
| `Unknown database 'email_system'` | 数据库未创建 | 执行 `CREATE DATABASE email_system ...` |
| 端口 8000 被占用 | 其他进程占用 | 修改 `server.port` 或释放占用端口 |
| SMTP 发送超时 | 网络或防火墙问题 | 检查出站 465/587 端口连通性 |
| 测试 SMTP 报 `SMTP 认证失败` | 邮箱凭据错误，多为误用登录密码代替授权码 | QQ/163 需用「授权码」，阿里企业邮箱需用「客户端专用密码」；详见 OPERATIONS.md 的 2.2.1 节 |
| `Table 'email_system.customers' doesn't exist` | schema.sql 未执行 | 确认 `spring.sql.init` 配置正确，或手动执行 schema.sql |
| 发送任务看不到某些客户 | 客户被设置为失效 | 在客户管理中将该客户“设为有效” |
| 任务编辑按钮不显示 | 任务正在发送中 | 先取消任务，再点击编辑 |
| 富文本格式粘贴后丢失 | 邮件客户端兼容性 | 使用工具栏按钮设置格式，避免从外部粘贴复杂样式 |
| 导入客户后中文乱码 | CSV 编码与解码方式不符（Excel「另存为 CSV」默认 GBK） | v2.14 起已自动兼容 UTF-8 / GBK / GB18030 / UTF-16；导入时建议另存为「CSV UTF-8」 |
| 导入返回 0 条记录 | 文件格式不支持 | 仅支持 `.csv` 与 `.xlsx`；`.xls` 旧格式请先另存为 `.xlsx` |
| 模板弹窗在低分辨率屏超出边界 | 80vw/80vh 计算 | 弹窗内已支持滚动，可滚动查看；或提升屏幕分辨率 |
| 批量「生效」/「失效」按钮置灰 | 所选客户已是目标状态 | 属正常的互斥禁用，改选其它状态的客户即可 |

---

*文档结束*
