package com.emailsystem.dto.request;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class CampaignCreateDTO {

    /** 任务名称：必填，且不能全为空格 */
    @NotBlank(message = "任务名称不能为空")
    private String name;

    @NotNull(message = "模板 ID 不能为空")
    private Long templateId;

    @NotNull(message = "SMTP 配置 ID 不能为空")
    private Long smtpConfigId;

    /** 收件客户 ID 列表（由"选择客户"分页列表勾选得到，只保留其中的有效客户） */
    private List<Long> customerIds;
    private Map<String, String> customVars;

    /** 每份邮件的发送间隔，单位：分钟 */
    @Min(value = 1, message = "发送间隔至少 1 分钟")
    private Integer intervalMin = 1;

    /** manual=立即发送 / one-time=定时发送（一次性） */
    private String scheduleType = "manual";
    private Map<String, Object> scheduleConfig;
}
