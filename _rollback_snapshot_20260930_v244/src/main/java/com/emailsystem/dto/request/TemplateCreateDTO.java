package com.emailsystem.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;

@Data
public class TemplateCreateDTO {

    @NotBlank(message = "模板名称不能为空")
    private String name;

    @NotBlank(message = "邮件主题不能为空")
    private String subject;

    @NotBlank(message = "邮件正文不能为空")
    private String body;

    private List<String> variables;
}
