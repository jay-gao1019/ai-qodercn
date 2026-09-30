package com.emailsystem.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("campaign_send_attempts")
public class CampaignSendAttempt {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long campaignId;
    private Long runId;
    private Long campaignLogId;
    private Long customerId;
    private String customerName;
    private String customerEmail;
    private String customerCompany;
    private String templateName;
    private String templateSubject;
    private String smtpName;
    private String status;
    private String errorMessage;
    private LocalDateTime sentAt;
}
