package com.emailsystem.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("campaign_runs")
public class CampaignRun {

    /** 第一次批量（非"继续发送/全部重发"的发送都记为此类型） */
    public static final String TYPE_FIRST_BATCH = "first_batch";
    public static final String TYPE_RESUME = "resume";
    public static final String TYPE_RESEND_ALL = "resend_all";

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long campaignId;
    private String runType;
    private String status;
    private Integer total;
    private Integer sent;
    private Integer failed;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
}
