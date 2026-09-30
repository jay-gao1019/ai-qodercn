package com.emailsystem.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * v2.44 需求 2：任务发送批次。一行代表该任务的一次收件人名单，
 * 各计数由 campaign_logs 按 (campaign_id, batch_no) 聚合维护，不作为独立事实来源。
 */
@Data
@TableName("campaign_batches")
public class CampaignBatch {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long campaignId;
    private Integer batchNo;
    private Integer recipientCount;
    private Integer sentCount;
    private Integer failedCount;
    private Integer pendingCount;

    /** 开批时新增收件人数：v2.44 之前回填的历史批次没有这个事实，保持 null */
    private Integer addedCount;
    private Integer removedCount;

    private String note;
    private LocalDateTime openedAt;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
}
