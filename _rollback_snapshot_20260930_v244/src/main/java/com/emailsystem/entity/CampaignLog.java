package com.emailsystem.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("campaign_logs")
public class CampaignLog {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long campaignId;
    private Long customerId;
    private String status;
    private String errorMessage;
    private LocalDateTime sentAt;

    /** v2.43 需求 1.2：发送批次号，建任务为 1；编辑任务变动收件人名单后新/保留的待发送记录进入下一批 */
    private Integer batchNo;

    @TableField(exist = false)
    private String customerName;

    @TableField(exist = false)
    private String customerEmail;

    @TableField(exist = false)
    private String customerCompany;
}
