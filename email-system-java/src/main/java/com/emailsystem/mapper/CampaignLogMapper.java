package com.emailsystem.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emailsystem.entity.CampaignLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Mapper
public interface CampaignLogMapper extends BaseMapper<CampaignLog> {

    /**
     * 发送记录附带该客户邮箱在本任务下的发送次数：send_count=总次数、success_count=其中成功的次数，
     * 按总次数降序展示。
     * v2.22：尝试明细功能上线前发出的记录没有 campaign_send_attempts 留痕，
     * 这类记录已有终态（sent/failed）说明至少发送过一次，故按 1 次兜底。
     * v2.33 需求3：本任务下该邮箱发送过多次而终态仍是 sent，说明是重试后才成功，
     * 发送情况给出"重试多次后发送成功"（日志里残留的失败原因作为补充说明）。
     * v2.34 需求1.1：发送记录不再展示"公司"列，故不查询 c.company。
     * v2.35 需求3.3：排序改为按本条记录的最后发送时间倒序（最近发出的排最前），
     * send_count 只作为展示列不再是排序键；待发送记录 sent_at 为 NULL，MySQL 倒序时自然落在最后。
     * <p>v2.54 需求1：客户改为 LEFT JOIN 并补快照回退，客户删除后这条记录仍要显示
     * （姓名/邮箱取不到实时资料时用 cl.customer_name / cl.customer_email）；
     * 实时资料仍然优先，客户改过名就按新名显示（v2.17 需求1 口径不变）。
     * customer_exists = 0 表示该收件人已被删除，前端据此关掉"双击编辑客户"入口。
     * 关联已删除客户时 send_count 子查询依旧按 customer_id 命中（留痕表存的是当时的 ID），
     * 这也是不把这个字段置空的理由。
     */
    @Select("""
        <script>
        SELECT cl.id, cl.campaign_id, cl.customer_id, cl.status, cl.sent_at,
               CASE WHEN c.id IS NULL THEN 0 ELSE 1 END AS customer_exists,
               COALESCE(NULLIF(c.customer_no, ''), cl.customer_no) AS customer_no,
               COALESCE(NULLIF(c.name, ''), cl.customer_name) AS customer_name,
               COALESCE(NULLIF(c.email, ''), cl.customer_email) AS customer_email,
               CASE WHEN cl.status = 'sent' AND COALESCE(s.total_cnt, 0) &gt; 1
                    THEN CONCAT('重试多次后发送成功',
                                IF(COALESCE(cl.error_message, '') = '', '', CONCAT('（此前失败原因：', cl.error_message, '）')))
                    ELSE cl.error_message END AS error_message,
               COALESCE(s.total_cnt, 0)
                 + CASE WHEN s.customer_id IS NULL AND cl.status IN ('sent','failed') THEN 1 ELSE 0 END AS send_count,
               COALESCE(s.sent_cnt, 0)
                 + CASE WHEN s.customer_id IS NULL AND cl.status = 'sent' THEN 1 ELSE 0 END AS success_count
        FROM campaign_logs cl
        LEFT JOIN customers c ON cl.customer_id = c.id
        LEFT JOIN (
          SELECT customer_id, COUNT(*) AS total_cnt, SUM(status = 'sent') AS sent_cnt
          FROM campaign_send_attempts
          WHERE campaign_id = #{campaignId}
          GROUP BY customer_id
        ) s ON s.customer_id = cl.customer_id
        WHERE cl.campaign_id = #{campaignId}
        <if test="status != null and status != ''">AND cl.status = #{status}</if>
        ORDER BY cl.sent_at DESC, cl.id DESC
        LIMIT #{pageSize} OFFSET #{offset}
        </script>
    """)
    List<Map<String, Object>> selectLogsWithCustomer(@Param("campaignId") Long campaignId,
                                                      @Param("status") String status,
                                                      @Param("pageSize") int pageSize,
                                                      @Param("offset") int offset);

    /**
     * 仪表盘"发送统计"卡片的五个同口径计数（全部 / 当天 / 本周 / 本月 / 本年）一次算完。
     * <p>v2.32 需求6：原先每个数字各发一条 COUNT 全表扫描，改为一次条件聚合。
     */
    @Select("""
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('sent','failed') THEN 1 ELSE 0 END), 0) AS total,
          COALESCE(SUM(CASE WHEN status IN ('sent','failed') AND sent_at >= #{today} THEN 1 ELSE 0 END), 0) AS today,
          COALESCE(SUM(CASE WHEN status IN ('sent','failed') AND sent_at >= #{week} THEN 1 ELSE 0 END), 0) AS week,
          COALESCE(SUM(CASE WHEN status IN ('sent','failed') AND sent_at >= #{month} THEN 1 ELSE 0 END), 0) AS month,
          COALESCE(SUM(CASE WHEN status IN ('sent','failed') AND sent_at >= #{year} THEN 1 ELSE 0 END), 0) AS year
        FROM campaign_logs
    """)
    Map<String, Object> selectSendRecordCounts(@Param("today") LocalDateTime today,
                                              @Param("week") LocalDateTime week,
                                              @Param("month") LocalDateTime month,
                                              @Param("year") LocalDateTime year);
}
