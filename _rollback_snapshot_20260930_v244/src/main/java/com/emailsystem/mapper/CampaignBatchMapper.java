package com.emailsystem.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emailsystem.entity.CampaignBatch;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

/**
 * v2.44 需求 2：任务发送批次的读写。
 * <p>批次表是 campaign_logs 的<strong>派生汇总</strong>，不是第二份事实：所有计数都由日志按
 * (campaign_id, batch_no) 聚合算出，因此任何一次写入都写成"先确保有行、再按日志刷新"两步，
 * 重复执行结果一致（幂等），进程崩溃后重启也能自愈。
 */
@Mapper
public interface CampaignBatchMapper extends BaseMapper<CampaignBatch> {

    /**
     * 开批：写入批次说明与新增/移出数。unique key (campaign_id, batch_no) 冲突即视为该批已开过，
     * 直接跳过——只有真正的首次开批才允许记这三个字段。
     */
    @Insert("""
        INSERT IGNORE INTO campaign_batches
            (campaign_id, batch_no, note, added_count, removed_count, opened_at)
        VALUES (#{campaignId}, #{batchNo}, #{note}, #{addedCount,jdbcType=INTEGER}, #{removedCount,jdbcType=INTEGER}, CURRENT_TIMESTAMP)
    """)
    int insertBatchRow(@Param("campaignId") Long campaignId,
                       @Param("batchNo") int batchNo,
                       @Param("note") String note,
                       @Param("addedCount") Integer addedCount,
                       @Param("removedCount") Integer removedCount);

    /**
     * 按该批日志的真实状态刷新六个派生列。子句不带 GROUP BY，故即使该批已一行不剩也会返回全零行，
     * 计数随之归零而不是留下幽灵数字。
     */
    @Update("""
        UPDATE campaign_batches b
        JOIN (
          SELECT COUNT(*) AS recipient_count,
                 COALESCE(SUM(status = 'sent'), 0) AS sent_count,
                 COALESCE(SUM(status = 'failed'), 0) AS failed_count,
                 COALESCE(SUM(status = 'pending'), 0) AS pending_count,
                 MIN(sent_at) AS started_at,
                 MAX(sent_at) AS finished_at
          FROM campaign_logs
          WHERE campaign_id = #{campaignId} AND batch_no = #{batchNo}
        ) x
        SET b.recipient_count = x.recipient_count,
            b.sent_count = x.sent_count,
            b.failed_count = x.failed_count,
            b.pending_count = x.pending_count,
            b.started_at = x.started_at,
            b.finished_at = x.finished_at
        WHERE b.campaign_id = #{campaignId} AND b.batch_no = #{batchNo}
    """)
    int refreshBatchStats(@Param("campaignId") Long campaignId, @Param("batchNo") int batchNo);

    /**
     * 刷新该任务<strong>全部</strong>批次的派生列，供建任务、编辑开批、继续发送、全部重发这些
     * 会同时动到多个批次的写动作收尾调用。
     * <p>用相关子查询而不是"按日志分组再 JOIN 回来"：日志被全部移出名单的批次分组结果里根本没有它，
     * JOIN 形式会让它停在旧数字上，相关子查询则如实归零。批次行本身保留（它确实被开过），
     * 界面按 recipient_count=0 显示"空批次"。
     */
    @Update("""
        UPDATE campaign_batches b
        SET b.recipient_count = (SELECT COUNT(*) FROM campaign_logs cl
                                  WHERE cl.campaign_id = b.campaign_id AND cl.batch_no = b.batch_no),
            b.sent_count = (SELECT COUNT(*) FROM campaign_logs cl
                             WHERE cl.campaign_id = b.campaign_id AND cl.batch_no = b.batch_no
                               AND cl.status = 'sent'),
            b.failed_count = (SELECT COUNT(*) FROM campaign_logs cl
                               WHERE cl.campaign_id = b.campaign_id AND cl.batch_no = b.batch_no
                                 AND cl.status = 'failed'),
            b.pending_count = (SELECT COUNT(*) FROM campaign_logs cl
                                WHERE cl.campaign_id = b.campaign_id AND cl.batch_no = b.batch_no
                                  AND cl.status = 'pending'),
            b.started_at = (SELECT MIN(cl.sent_at) FROM campaign_logs cl
                             WHERE cl.campaign_id = b.campaign_id AND cl.batch_no = b.batch_no),
            b.finished_at = (SELECT MAX(cl.sent_at) FROM campaign_logs cl
                              WHERE cl.campaign_id = b.campaign_id AND cl.batch_no = b.batch_no)
        WHERE b.campaign_id = #{campaignId}
    """)
    int refreshCampaignBatches(@Param("campaignId") Long campaignId);

    /** 批次列表（含派生批状态），批次号大的在前，与任务详情其余列表"最近在前"的口径一致 */
    @Select("""
        SELECT b.batch_no, b.recipient_count, b.sent_count, b.failed_count, b.pending_count,
               b.added_count, b.removed_count, b.note, b.opened_at, b.started_at, b.finished_at,
               CASE
                 WHEN b.recipient_count = 0 THEN 'empty'
                 WHEN b.pending_count > 0 AND b.sent_count + b.failed_count = 0 THEN 'pending'
                 WHEN b.pending_count > 0 THEN 'partial'
                 WHEN b.failed_count > 0 THEN 'uncompleted'
                 ELSE 'completed'
               END AS batch_status
        FROM campaign_batches b
        WHERE b.campaign_id = #{campaignId}
        ORDER BY b.batch_no DESC
    """)
    List<Map<String, Object>> selectBatches(@Param("campaignId") Long campaignId);

    /**
     * 该任务当前的批次号 = 已开启的最大批次号（一行批次都没开过时按第 1 批）。
     * v2.44 需求 2 起这里取代"日志里最大的 batch_no"成为唯一口径：批次表为每个开过的批次都留了行，
     * 即便该批收件人后来被全部移出名单，"任务已经发到第几批"仍然连续，界面不会出现批次回退。
     */
    @Select("SELECT COALESCE(MAX(batch_no), 1) FROM campaign_batches WHERE campaign_id = #{campaignId}")
    int selectCurrentBatch(@Param("campaignId") Long campaignId);

    /**
     * 跨任务批次汇总（仪表盘"任务发送统计"用）：任务 ID → 批次数、当前批次号。
     * <p>一次分组查出全部任务，避免"每个任务行各发一条 COUNT"的 N+1。
     */
    @Select("""
        SELECT campaign_id, COUNT(*) AS batch_count, MAX(batch_no) AS current_batch
        FROM campaign_batches
        GROUP BY campaign_id
    """)
    List<Map<String, Object>> selectBatchCountByCampaign();
}
