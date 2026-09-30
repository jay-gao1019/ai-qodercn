package com.emailsystem.dto.request;

import lombok.Data;

@Data
public class SmtpConfigUpdateDTO {
    private String name;
    private String host;
    private Integer port;
    private String username;
    private String password;
    private Boolean useSsl;
    private Boolean useTls;
    private Boolean isDefault;
}
