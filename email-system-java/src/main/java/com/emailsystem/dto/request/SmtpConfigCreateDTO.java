package com.emailsystem.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class SmtpConfigCreateDTO {

    @NotBlank(message = "配置名称不能为空")
    private String name;

    @NotBlank(message = "SMTP 服务器地址不能为空")
    private String host;

    @NotNull(message = "端口号不能为空")
    private Integer port;

    @NotBlank(message = "用户名不能为空")
    private String username;

    @NotBlank(message = "密码不能为空")
    private String password;

    private Boolean useSsl = true;
    private Boolean useTls = false;
    private Boolean isDefault = false;
}
