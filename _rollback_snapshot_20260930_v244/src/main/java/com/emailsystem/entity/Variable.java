package com.emailsystem.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("variables")
public class Variable {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;
    private String description;
    private String exampleValue;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
