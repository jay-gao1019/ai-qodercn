package com.emailsystem.controller;

import com.emailsystem.common.Result;
import com.emailsystem.dto.request.SmtpConfigCreateDTO;
import com.emailsystem.dto.request.SmtpConfigUpdateDTO;
import com.emailsystem.dto.request.TestEmailDTO;
import com.emailsystem.entity.SmtpConfig;
import com.emailsystem.service.EmailService;
import com.emailsystem.service.SmtpConfigService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/smtp")
@RequiredArgsConstructor
public class SmtpConfigController {

    private final SmtpConfigService smtpConfigService;
    private final EmailService emailService;

    @GetMapping("/configs")
    public Result<List<SmtpConfig>> listConfigs() {
        return Result.successWithData(smtpConfigService.listAll());
    }

    @PostMapping("/configs")
    public Result<Void> createConfig(@Valid @RequestBody SmtpConfigCreateDTO dto) {
        smtpConfigService.create(dto);
        return Result.success("SMTP 配置创建成功");
    }

    @PutMapping("/configs/{id}")
    public Result<Void> updateConfig(@PathVariable Long id, @RequestBody SmtpConfigUpdateDTO dto) {
        SmtpConfig config = smtpConfigService.getById(id);
        if (config == null) {
            return Result.error("配置不存在");
        }
        smtpConfigService.update(id, dto);
        return Result.success("SMTP 配置更新成功");
    }

    @DeleteMapping("/configs/{id}")
    public Result<Void> deleteConfig(@PathVariable Long id) {
        smtpConfigService.delete(id);
        return Result.success("SMTP 配置删除成功");
    }

    @PostMapping("/test")
    public Result<Void> testEmail(@Valid @RequestBody TestEmailDTO dto) {
        SmtpConfig smtp = smtpConfigService.getById(dto.getSmtpConfigId());
        if (smtp == null) {
            return Result.error("SMTP 配置不存在");
        }

        EmailService.SendResult result = emailService.sendSingleEmail(
                smtp.getHost(), smtp.getPort(), smtp.getUsername(), smtp.getPassword(),
                Boolean.TRUE.equals(smtp.getUseSsl()), Boolean.TRUE.equals(smtp.getUseTls()),
                dto.getToEmail(), dto.getSubject(), dto.getBody()
        );

        if (result.success()) {
            return Result.success("测试邮件发送成功");
        }
        return Result.error(result.error());
    }
}
