package com.emailsystem.dto.request;

import lombok.Data;

@Data
public class VariableUpdateDTO {
    private String name;
    private String description;
    private String exampleValue;
}
