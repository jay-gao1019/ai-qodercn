package com.emailsystem.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("smtp_configs")
public class SmtpConfig {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;
    private String host;
    private Integer port;
    private String username;
    private String password;
    private Boolean useSsl;
    private Boolean useTls;
    private Boolean isDefault;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
