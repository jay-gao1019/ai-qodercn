package com.emailsystem.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Mapper
public interface DashboardMapper {

    /** 客户维度关键字检索条件（客户号/姓名/邮箱/公司/标签） */
    String CUSTOMER_STATS_WHERE = """
            <if test="search != null and search != ''">
                WHERE CONCAT_WS(' ', c.customer_no, c.name, c.email, c.company, c.tags) LIKE CONCAT('%', #{search}, '%')
            </if>
            """;

    /**
     * 客户维度统计的筛选条件片段（v2.32 需求3 / v2.33 需求4）：列表与计数共用，避免两处口径漂移。
     * sent/failed/total 任一非空即追加 HAVING，比较方向固定为"大于等于该次数"。
     */
    String CUSTOMER_STATS_HAVING = """

            <if test="sent != null or failed != null or total != null">
                HAVING 1 = 1
                <if test="sent != null">AND sent_count &gt;= #{sent}</if>
                <if test="failed != null">AND failed_count &gt;= #{failed}</if>
                <if test="total != null">AND total_count &gt;= #{total}</if>
            </if>

            """;

    /**
     * 三个统计列的聚合表达式。列表与计数都必须 SELECT 出来，因为上面的 HAVING
     * 片段按 MySQL 规则引用的是这些列别名，缺一侧就会报 Unknown column in 'having clause'。
     */
    String CUSTOMER_STATS_AGGREGATES = """
               SUM(CASE WHEN cl.status IN ('sent', 'failed') THEN 1 ELSE 0 END) AS total_count,
               SUM(CASE WHEN cl.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
               SUM(CASE WHEN cl.status = 'failed' THEN 1 ELSE 0 END) AS failed_count

            """;

    /**
     * v2.30 需求5：客户邮件发送统计不再显示/统计"待发送"，总计只累加 sent+failed。
     * v2.32 需求3：可按已发送/失败/总计三列的次数做区间筛选（三个片段常量与计数查询共用）。
     */
    @Select("""
        <script>
        SELECT c.id, c.customer_no, c.name, c.email, c.company,
        """ + CUSTOMER_STATS_AGGREGATES + """
        FROM customers c
        LEFT JOIN campaign_logs cl ON cl.customer_id = c.id
        """ + CUSTOMER_STATS_WHERE + """
        GROUP BY c.id, c.customer_no, c.name, c.email, c.company
        """ + CUSTOMER_STATS_HAVING + """
        ORDER BY sent_count DESC, c.id DESC
        LIMIT #{pageSize} OFFSET #{offset}
        </script>
    """)
    List<Map<String, Object>> selectCustomerEmailStats(@Param("search") String search,
                                                       @Param("sent") Integer sent,
                                                       @Param("failed") Integer failed,
                                                       @Param("total") Integer total,
                                                       @Param("pageSize") int pageSize,
                                                       @Param("offset") int offset);

    /** 与列表完全同口径的客户计数（含次数筛选，故必须同样按客户分组后再计数） */
    @Select("""
        <script>
        SELECT COUNT(*) FROM (
            SELECT c.id,
            """ + CUSTOMER_STATS_AGGREGATES + """
            FROM customers c
            LEFT JOIN campaign_logs cl ON cl.customer_id = c.id
            """ + CUSTOMER_STATS_WHERE + """
            GROUP BY c.id
            """ + CUSTOMER_STATS_HAVING + """
        ) matched
        </script>
    """)
    long countCustomers(@Param("search") String search,
                        @Param("sent") Integer sent,
                        @Param("failed") Integer failed,
                        @Param("total") Integer total);

    /** v2.30 需求5：客户发送明细同样剔除待发送记录，与列表"总计"口径一致 */
    @Select("""
        SELECT cl.id, c.id AS campaign_id, c.name AS campaign_name,
               t.name AS template_name, cl.status, cl.error_message, cl.sent_at
        FROM campaign_logs cl
        JOIN campaigns c ON cl.campaign_id = c.id
        LEFT JOIN templates t ON c.template_id = t.id
        WHERE cl.customer_id = #{customerId} AND cl.status IN ('sent', 'failed')
        ORDER BY cl.sent_at DESC, cl.id DESC
        LIMIT #{pageSize} OFFSET #{offset}
    """)
    List<Map<String, Object>> selectCustomerSendDetail(@Param("customerId") Long customerId,
                                                       @Param("pageSize") int pageSize,
                                                       @Param("offset") int offset);

    @Select("SELECT COUNT(*) FROM campaign_logs WHERE customer_id = #{customerId} AND status IN ('sent', 'failed')")
    long countCustomerSendDetail(@Param("customerId") Long customerId);

    /**
     * 模板发送统计按"模板 × 关联任务"逐行返回（v2.31 需求1：每行都带模板名称，不再由前端合并单元格）。
     * 发送成功/失败取 campaign_logs 的最终状态（每个收件人一条），
     * 累计发出次数取 campaign_send_attempts 的逐次动作（含重发、含失败尝试），
     * 留痕上线前只有 campaign_logs 的老任务用 GREATEST 兜底为实际发出的记录数。
     * template_use_no = 该任务在这个模板的全部任务里按发送开始时间的先后序号（1 = 第一次使用该模板）。
     * v2.34 需求2：额外返回模板自身的最后修改时间，供"模板组之间按模板修改时间倒序"排序使用。
     */
    @Select("""
        SELECT t.id AS template_id, t.name AS template_name, t.updated_at AS template_updated_at,
               c.id AS campaign_id, c.name AS campaign_name,
               c.started_at AS campaign_started_at, c.finished_at AS campaign_finished_at,
               use_rank.use_no AS template_use_no,
               COALESCE(SUM(CASE WHEN cl.status = 'sent' THEN 1 ELSE 0 END), 0) AS sent_count,
               COALESCE(SUM(CASE WHEN cl.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count,
               GREATEST(
                 COALESCE((SELECT COUNT(*) FROM campaign_send_attempts a WHERE a.campaign_id = c.id), 0),
                 COALESCE(SUM(CASE WHEN cl.status IN ('sent', 'failed') THEN 1 ELSE 0 END), 0)
               ) AS send_times
        FROM templates t
        LEFT JOIN campaigns c ON c.template_id = t.id
        LEFT JOIN (
            SELECT c2.id, ROW_NUMBER() OVER (
                     PARTITION BY c2.template_id
                     ORDER BY COALESCE(c2.started_at, c2.created_at) ASC, c2.id ASC
                   ) AS use_no
            FROM campaigns c2
        ) use_rank ON use_rank.id = c.id
        LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
        GROUP BY t.id, t.name, t.updated_at, c.id, c.name, c.started_at, c.finished_at, use_rank.use_no
        ORDER BY t.updated_at DESC, t.id DESC, COALESCE(c.started_at, c.created_at) DESC, c.id DESC
    """)
    List<Map<String, Object>> selectTemplateStats();

    /**
     * 仪表盘"发送记录"钻取列表。
     * <p>v2.54 需求1：客户改 LEFT JOIN + 快照回退，收件人已被删除的记录不再从这张表里消失
     * （此前 INNER JOIN 会让"删除失效客户"直接把对应的发送历史一并抹掉）。
     * 实时资料仍优先于快照，客户改名后这里跟着变（v2.17 需求1 口径不变）。
     */
    @Select("""
        <script>
        SELECT cl.id, cl.campaign_id, c.name AS campaign_name, t.name AS template_name,
               COALESCE(NULLIF(cu.customer_no, ''), cl.customer_no) AS customer_no,
               COALESCE(NULLIF(cu.name, ''), cl.customer_name) AS customer_name,
               COALESCE(NULLIF(cu.email, ''), cl.customer_email) AS customer_email,
               cu.company,
               cl.status, cl.error_message, cl.sent_at
        FROM campaign_logs cl
        JOIN campaigns c ON cl.campaign_id = c.id
        LEFT JOIN customers cu ON cl.customer_id = cu.id
        LEFT JOIN templates t ON c.template_id = t.id
        <where>
            cl.status IN ('sent', 'failed') AND cl.sent_at IS NOT NULL
            <if test="start != null">AND cl.sent_at &gt;= #{start}</if>
            <if test="end != null">AND cl.sent_at &lt;= #{end}</if>
        </where>
        ORDER BY cl.sent_at DESC, cl.id DESC
        LIMIT #{pageSize} OFFSET #{offset}
        </script>
    """)
    List<Map<String, Object>> selectSendRecords(@Param("start") String start,
                                                @Param("end") String end,
                                                @Param("pageSize") int pageSize,
                                                @Param("offset") int offset);

    @Select("""
        <script>
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN cl.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
               SUM(CASE WHEN cl.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
        FROM campaign_logs cl
        <where>
            cl.status IN ('sent', 'failed') AND cl.sent_at IS NOT NULL
            <if test="start != null">AND cl.sent_at &gt;= #{start}</if>
            <if test="end != null">AND cl.sent_at &lt;= #{end}</if>
        </where>
        </script>
    """)
    Map<String, Object> countSendRecords(@Param("start") String start, @Param("end") String end);

    /**
     * v2.37 需求4：发送记录统计"当日 / 本周 / 本月 / 本年"四个按钮的数值一次条件聚合算完。
     * 口径与仪表盘"发送统计"卡片一致：只累计 status in (sent, failed) 的记录，按 sent_at 落在窗口内计数。
     */
    @Select("""
        SELECT
          COALESCE(SUM(CASE WHEN sent_at >= #{dayStart} AND sent_at <= #{dayEnd} THEN 1 ELSE 0 END), 0) AS day_count,
          COALESCE(SUM(CASE WHEN sent_at >= #{weekStart} AND sent_at <= #{weekEnd} THEN 1 ELSE 0 END), 0) AS week_count,
          COALESCE(SUM(CASE WHEN sent_at >= #{monthStart} AND sent_at <= #{monthEnd} THEN 1 ELSE 0 END), 0) AS month_count,
          COALESCE(SUM(CASE WHEN sent_at >= #{yearStart} AND sent_at <= #{yearEnd} THEN 1 ELSE 0 END), 0) AS year_count
        FROM campaign_logs
        WHERE status IN ('sent', 'failed') AND sent_at IS NOT NULL
          AND sent_at >= #{yearStart} AND sent_at <= #{yearEnd}
    """)
    Map<String, Object> selectSendPeriodCounts(@Param("dayStart") LocalDateTime dayStart,
                                               @Param("dayEnd") LocalDateTime dayEnd,
                                               @Param("weekStart") LocalDateTime weekStart,
                                               @Param("weekEnd") LocalDateTime weekEnd,
                                               @Param("monthStart") LocalDateTime monthStart,
                                               @Param("monthEnd") LocalDateTime monthEnd,
                                               @Param("yearStart") LocalDateTime yearStart,
                                               @Param("yearEnd") LocalDateTime yearEnd);

    /** 按小时分桶统计（仪表盘"当日"用） */
    @Select("""
        SELECT DATE_FORMAT(cl.sent_at, '%H') AS bucket,
               SUM(CASE WHEN cl.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
               SUM(CASE WHEN cl.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
        FROM campaign_logs cl
        WHERE cl.status IN ('sent', 'failed')
          AND cl.sent_at >= CONCAT(#{date}, ' 00:00:00')
          AND cl.sent_at <= CONCAT(#{date}, ' 23:59:59')
        GROUP BY bucket
        ORDER BY bucket
    """)
    List<Map<String, Object>> selectTrendByHour(@Param("date") String date);

    /** 按天分桶统计（仪表盘"本周""本月"两个按钮的逐日趋势） */
    @Select("""
        SELECT DATE_FORMAT(cl.sent_at, '%Y-%m-%d') AS bucket,
               SUM(CASE WHEN cl.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
               SUM(CASE WHEN cl.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
        FROM campaign_logs cl
        WHERE cl.status IN ('sent', 'failed')
          AND cl.sent_at >= CONCAT(#{start}, ' 00:00:00')
          AND cl.sent_at <= CONCAT(#{end}, ' 23:59:59')
        GROUP BY bucket
        ORDER BY bucket
    """)
    List<Map<String, Object>> selectTrendByDay(@Param("start") String start, @Param("end") String end);

    /** 按月分桶统计（仪表盘"本年"按钮的逐月趋势） */
    @Select("""
        SELECT DATE_FORMAT(cl.sent_at, '%Y-%m') AS bucket,
               SUM(CASE WHEN cl.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
               SUM(CASE WHEN cl.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
        FROM campaign_logs cl
        WHERE cl.status IN ('sent', 'failed')
          AND cl.sent_at >= CONCAT(#{start}, ' 00:00:00')
          AND cl.sent_at <= CONCAT(#{end}, ' 23:59:59')
        GROUP BY bucket
        ORDER BY bucket
    """)
    List<Map<String, Object>> selectTrendByMonth(@Param("start") String start, @Param("end") String end);

    /** 聚合口径（本周/本月/本年）的发送记录汇总：任务 + 模板 维度聚合（v2.20） */
    @Select("""
        <script>
        SELECT c.id AS campaign_id, c.name AS campaign_name, t.name AS template_name,
               COUNT(*) AS total,
               SUM(CASE WHEN cl.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
               SUM(CASE WHEN cl.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
               MAX(cl.sent_at) AS last_sent_at
        FROM campaign_logs cl
        JOIN campaigns c ON cl.campaign_id = c.id
        LEFT JOIN templates t ON c.template_id = t.id
        <where>
            cl.status IN ('sent', 'failed') AND cl.sent_at IS NOT NULL
            <if test="start != null">AND cl.sent_at &gt;= #{start}</if>
            <if test="end != null">AND cl.sent_at &lt;= #{end}</if>
        </where>
        GROUP BY c.id, c.name, t.name
        ORDER BY MAX(cl.sent_at) DESC
        LIMIT #{pageSize} OFFSET #{offset}
        </script>
    """)
    List<Map<String, Object>> selectSendSummary(@Param("start") String start,
                                                @Param("end") String end,
                                                @Param("pageSize") int pageSize,
                                                @Param("offset") int offset);

    /** 汇总模式的分组总数（用于分页） */
    @Select("""
        <script>
        SELECT COUNT(*) FROM (
            SELECT 1
            FROM campaign_logs cl
            JOIN campaigns c ON cl.campaign_id = c.id
            <where>
                cl.status IN ('sent', 'failed') AND cl.sent_at IS NOT NULL
                <if test="start != null">AND cl.sent_at &gt;= #{start}</if>
                <if test="end != null">AND cl.sent_at &lt;= #{end}</if>
            </where>
            GROUP BY c.id, c.template_id
        ) g
        </script>
    """)
    long countSendSummary(@Param("start") String start, @Param("end") String end);
}
