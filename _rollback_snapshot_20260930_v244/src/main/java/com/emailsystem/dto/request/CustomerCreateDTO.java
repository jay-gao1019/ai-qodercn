package com.emailsystem.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class CustomerCreateDTO {

    @NotBlank(message = "邮箱不能为空")
    private String email;

    private String name = "";
    private String company = "";
    private String phone = "";
    private String country = "";
    private String tags = "";
    private String notes = "";
    private String status;
}
