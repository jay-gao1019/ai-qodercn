package com.emailsystem.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class TestEmailDTO {

    @NotNull(message = "SMTP 配置 ID 不能为空")
    private Long smtpConfigId;

    @NotBlank(message = "收件人邮箱不能为空")
    private String toEmail;

    private String subject = "Test Email";
    private String body = "This is a test email from the email system.";
}
