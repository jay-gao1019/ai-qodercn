package com.emailsystem.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

import java.util.List;

/**
 * 批量设置客户有效性的请求参数。
 */
@Data
public class CustomerBatchStatusDTO {

    @NotEmpty(message = "请选择要操作的客户")
    private List<Long> ids;

    /** active=有效 / inactive=失效 */
    @NotBlank(message = "状态不能为空")
    @Pattern(regexp = "active|inactive", message = "状态只能是 active 或 inactive")
    private String status;
}
