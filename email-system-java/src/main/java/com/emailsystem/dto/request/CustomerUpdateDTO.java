package com.emailsystem.dto.request;

import lombok.Data;

@Data
public class CustomerUpdateDTO {
    private String name;
    private String email;
    private String company;
    private String phone;
    private String country;
    private String tags;
    private String notes;
    private String status;
}
