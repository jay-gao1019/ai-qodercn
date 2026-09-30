package com.emailsystem.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emailsystem.entity.CampaignSendAttempt;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

@Mapper
public interface CampaignSendAttemptMapper extends BaseMapper<CampaignSendAttempt> {

    /**
     * 逐次发送明细。第 N 次（attempt_no）= 该邮箱在本任务下的第几次实际发送动作。
     * <p>v2.26：客户姓名/邮箱/公司与模板、SMTP 一律取发送当时写入的快照列，
     * 后续客户资料或模板调整都不会改变这里展示的历史事实；
     * 快照功能上线前写入的留痕（快照列为空）回退到 customers 实时值。
     * <p>v2.33 需求3：状态为 sent 且不是该邮箱的第一次发送，说明是"重试多次后才成功"，
     * 发送情况列直接给出这个结论（此前失败原因若已留痕则一并带出）。
     * <p>v2.43 需求 1.2：经由 campaign_log_id 带出该次发送所属的批次号，
     * 编辑任务后重发/续发的留痕才能与历史批次区分开。
     */
    @Select("""
        <script>
        SELECT a.id, a.campaign_id, a.run_id, a.campaign_log_id, a.customer_id,
               a.status,
               CASE WHEN a.status = 'sent'
                         AND (SELECT COUNT(*) FROM campaign_send_attempts b
                               WHERE b.campaign_id = a.campaign_id AND b.customer_id = a.customer_id AND b.id &lt;= a.id) &gt; 1
                    THEN CONCAT('重试多次后发送成功',
                                IF(COALESCE(a.error_message, '') = '', '', CONCAT('（此前失败原因：', a.error_message, '）')))
                    ELSE a.error_message END AS error_message,
               a.sent_at, r.run_type,
               COALESCE(l.batch_no, 1) AS batch_no,
               (SELECT COUNT(*) FROM campaign_send_attempts b
                 WHERE b.campaign_id = a.campaign_id AND b.customer_id = a.customer_id AND b.id &lt;= a.id) AS attempt_no,
               COALESCE(NULLIF(a.customer_name, ''), c.name) AS customer_name,
               COALESCE(NULLIF(a.customer_email, ''), c.email) AS customer_email,
               COALESCE(NULLIF(a.customer_company, ''), c.company) AS customer_company,
               c.customer_no AS customer_no,
               a.template_name, a.template_subject, a.smtp_name
        FROM campaign_send_attempts a
        JOIN campaign_runs r ON a.run_id = r.id
        LEFT JOIN campaign_logs l ON a.campaign_log_id = l.id
        LEFT JOIN customers c ON a.customer_id = c.id
        WHERE a.campaign_id = #{campaignId}
        <if test="runId != null">AND a.run_id = #{runId}</if>
        <if test="status != null and status != ''">AND a.status = #{status}</if>
        <if test="customerId != null">AND a.customer_id = #{customerId}</if>
        <if test="batchNo != null">AND COALESCE(l.batch_no, 1) = #{batchNo}</if>
        ORDER BY a.id DESC
        LIMIT #{pageSize} OFFSET #{offset}
        </script>
    """)
    List<Map<String, Object>> selectAttemptsPaged(@Param("campaignId") Long campaignId,
                                                  @Param("runId") Long runId,
                                                  @Param("status") String status,
                                                  @Param("customerId") Long customerId,
                                                  @Param("batchNo") Integer batchNo,
                                                  @Param("pageSize") int pageSize,
                                                  @Param("offset") int offset);

    /** 与 selectAttemptsPaged 同一套过滤条件，故批次条件同样经由 campaign_logs 关联取得 */
    @Select("""
        <script>
        SELECT COUNT(*) FROM campaign_send_attempts a
        LEFT JOIN campaign_logs l ON a.campaign_log_id = l.id
        WHERE a.campaign_id = #{campaignId}
        <if test="runId != null">AND a.run_id = #{runId}</if>
        <if test="status != null and status != ''">AND a.status = #{status}</if>
        <if test="customerId != null">AND a.customer_id = #{customerId}</if>
        <if test="batchNo != null">AND COALESCE(l.batch_no, 1) = #{batchNo}</if>
        </script>
    """)
    long countAttempts(@Param("campaignId") Long campaignId, @Param("runId") Long runId,
                       @Param("status") String status, @Param("customerId") Long customerId,
                       @Param("batchNo") Integer batchNo);
}
