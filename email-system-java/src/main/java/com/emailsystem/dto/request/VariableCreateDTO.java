package com.emailsystem.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class VariableCreateDTO {

    @NotBlank(message = "变量名不能为空")
    private String name;

    private String description = "";
    private String exampleValue = "";
}
