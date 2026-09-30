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

    /** 任务列表与单任务详情共用的字段集合（关联名称由 JOIN 提供，避免两处字段漂移） */
    String CAMPAIGN_WITH_DETAILS = """
        SELECT c.*, t.name AS template_name, s.name AS smtp_name
        FROM campaigns c
        LEFT JOIN templates t ON c.template_id = t.id
        LEFT JOIN smtp_configs s ON c.smtp_config_id = s.id
        """;

    /**
     * v2.35 需求3.1：任务列表按"最近状态更新时间"排序。该时间取以下三者之最：
     * 任务创建/开始/结束时间、以及任务内任意一封邮件的最后发送时间（campaign_logs.sent_at 最大值）。
     * 单独成段是因为它只服务于列表排序，详情按 ID 查询无需再聚合全表日志。
     */
    String CAMPAIGN_ACTIVITY_JOIN = """
        LEFT JOIN (SELECT campaign_id, MAX(sent_at) AS last_sent_at FROM campaign_logs GROUP BY campaign_id) la
               ON la.campaign_id = c.id
        """;

    String CAMPAIGN_ORDER_BY_ACTIVITY = """
        ORDER BY GREATEST(COALESCE(c.created_at, '1970-01-01'), COALESCE(c.started_at, '1970-01-01'),
                         COALESCE(c.finished_at, '1970-01-01'), COALESCE(la.last_sent_at, '1970-01-01')) DESC, c.id DESC
        """;

    @Select(CAMPAIGN_WITH_DETAILS + CAMPAIGN_ACTIVITY_JOIN + CAMPAIGN_ORDER_BY_ACTIVITY)
    List<Map<String, Object>> selectAllWithDetails();

    @Select(CAMPAIGN_WITH_DETAILS + CAMPAIGN_ACTIVITY_JOIN + CAMPAIGN_ORDER_BY_ACTIVITY + "LIMIT #{pageSize} OFFSET #{offset}")
    List<Map<String, Object>> selectWithDetailsPaged(@Param("pageSize") int pageSize, @Param("offset") int offset);

    /** v2.32 需求1：详情页只取当前任务，不再让前端拉全量列表自行查找 */
    @Select(CAMPAIGN_WITH_DETAILS + "WHERE c.id = #{campaignId}")
    Map<String, Object> selectByIdWithDetails(@Param("campaignId") Long campaignId);

    @Select("SELECT COUNT(*) FROM campaigns")
    int countAll();
}
