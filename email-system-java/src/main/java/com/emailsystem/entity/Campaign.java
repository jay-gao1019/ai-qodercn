package com.emailsystem.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("campaigns")
public class Campaign {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;
    private Long templateId;
    private Long smtpConfigId;
    private String status;
    private Integer total;
    private Integer sent;
    private Integer failed;
    private Integer intervalMin;
    private String customVars;
    private String scheduleType;
    private String scheduleConfig;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(exist = false)
    private String templateName;

    @TableField(exist = false)
    private String smtpName;

    @TableField(exist = false)
    private Boolean isRunning;
}
