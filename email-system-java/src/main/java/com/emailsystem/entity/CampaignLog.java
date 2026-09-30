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

    @TableField(exist = false)
    private String customerName;

    @TableField(exist = false)
    private String customerEmail;

    @TableField(exist = false)
    private String customerCompany;
}
