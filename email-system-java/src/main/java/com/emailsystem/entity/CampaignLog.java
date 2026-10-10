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

    /**
     * 关联客户 ID。v2.54 需求1 起该客户可以已被删除（这个 ID 只是留痕，
     * 用于把这条记录与其逐次发送历史 campaign_send_attempts 关联起来）。
     */
    private Long customerId;
    private String status;
    private String errorMessage;
    private LocalDateTime sentAt;

    /** v2.54 需求1：收件人快照，客户删除后发送记录仍能原样显示 */
    private String customerNo;
    private String customerName;
    private String customerEmail;

    @TableField(exist = false)
    private String customerCompany;
}
