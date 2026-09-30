package com.emailsystem.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("customers")
public class Customer {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 客户号：C + 5 位数字（共 6 位），由系统按主键自动生成，不可修改 */
    private String customerNo;

    private String name;
    private String email;
    private String company;
    private String phone;
    private String country;
    private String tags;
    private String notes;

    /** 有效性: active=有效 / inactive=失效 */
    private String status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
