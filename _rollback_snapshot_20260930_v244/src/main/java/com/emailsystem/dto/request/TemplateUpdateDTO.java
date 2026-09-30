package com.emailsystem.dto.request;

import lombok.Data;

import java.util.List;

@Data
public class TemplateUpdateDTO {
    private String name;
    private String subject;
    private String body;
    private List<String> variables;
}
