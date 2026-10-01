package com.emailsystem.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emailsystem.entity.Campaign;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

@Mapper
public interface CampaignMapper extends BaseMapper<Campaign> {

    /**
     * 任务列表与单任务详情共用的字段集合（关联名称由 JOIN 提供，避免两处字段漂移）。
     * <p>v2.46 需求1：附带 {@code first_sent_at} —— 该任务第一封实际发出的邮件时间。
     * {@code campaigns.started_at} 每次运行都会被覆盖成"本轮开始时刻"，跨运行看的是最后一次发送的起点，
     * 所以"开始时间"不能用它；campaign_logs.sent_at 每封邮件发出即写入，且失效客户/未发送记录都为 NULL，
     * MIN 即该任务真实的第一封发出时间（未发出过任何邮件的任务为 NULL）。
     * <p>同一段聚合顺带提供 {@code last_sent_at}，v2.35 需求3.1 的"最近状态更新时间"排序复用它。
     */
    String CAMPAIGN_WITH_DETAILS = """
        SELECT c.*, t.name AS template_name, s.name AS smtp_name, la.first_sent_at
        FROM campaigns c
        LEFT JOIN templates t ON c.template_id = t.id
        LEFT JOIN smtp_configs s ON c.smtp_config_id = s.id
        LEFT JOIN (SELECT campaign_id, MIN(sent_at) AS first_sent_at, MAX(sent_at) AS last_sent_at
                   FROM campaign_logs GROUP BY campaign_id) la ON la.campaign_id = c.id
        """;

    /**
     * v2.35 需求3.1：任务列表按"最近状态更新时间"排序。该时间取以下三者之最：
     * 任务创建/开始/结束时间、以及任务内任意一封邮件的最后发送时间（campaign_logs.sent_at 最大值）。
     * 单独成段是因为它只服务于列表排序，详情按 ID 查询无需再按此排序。
     */
    String CAMPAIGN_ORDER_BY_ACTIVITY = """
        ORDER BY GREATEST(COALESCE(c.created_at, '1970-01-01'), COALESCE(c.started_at, '1970-01-01'),
                         COALESCE(c.finished_at, '1970-01-01'), COALESCE(la.last_sent_at, '1970-01-01')) DESC, c.id DESC
        """;

    @Select(CAMPAIGN_WITH_DETAILS + CAMPAIGN_ORDER_BY_ACTIVITY)
    List<Map<String, Object>> selectAllWithDetails();

    @Select(CAMPAIGN_WITH_DETAILS + CAMPAIGN_ORDER_BY_ACTIVITY + "LIMIT #{pageSize} OFFSET #{offset}")
    List<Map<String, Object>> selectWithDetailsPaged(@Param("pageSize") int pageSize, @Param("offset") int offset);

    /** v2.32 需求1：详情页只取当前任务，不再让前端拉全量列表自行查找 */
    @Select(CAMPAIGN_WITH_DETAILS + "WHERE c.id = #{campaignId}")
    Map<String, Object> selectByIdWithDetails(@Param("campaignId") Long campaignId);

    @Select("SELECT COUNT(*) FROM campaigns")
    int countAll();
}
