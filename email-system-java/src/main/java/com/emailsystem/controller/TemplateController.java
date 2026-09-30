package com.emailsystem.controller;

import com.emailsystem.common.Result;
import com.emailsystem.dto.request.TemplateCreateDTO;
import com.emailsystem.dto.request.TemplateUpdateDTO;
import com.emailsystem.dto.response.PreviewResultVO;
import com.emailsystem.entity.Customer;
import com.emailsystem.entity.Template;
import com.emailsystem.service.CustomerService;
import com.emailsystem.service.TemplateCrudService;
import com.emailsystem.service.TemplateService;
import com.emailsystem.service.VariableService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/templates")
@RequiredArgsConstructor
public class TemplateController {

    private final TemplateCrudService templateCrudService;
    private final TemplateService templateService;
    private final VariableService variableService;
    private final CustomerService customerService;

    @GetMapping("")
    public Result<List<Template>> list() {
        return Result.successWithData(templateCrudService.listAll());
    }

    @PostMapping("")
    public Result<Void> create(@Valid @RequestBody TemplateCreateDTO dto) {
        templateCrudService.create(dto);
        return Result.success("模板创建成功");
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody TemplateUpdateDTO dto) {
        templateCrudService.update(id, dto);
        return Result.success("模板更新成功");
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        templateCrudService.delete(id);
        return Result.success("模板删除成功");
    }

    @PostMapping("/{id}/duplicate")
    public Result<Void> duplicate(@PathVariable Long id) {
        templateCrudService.duplicate(id);
        return Result.success("模板复制成功");
    }

    @PostMapping("/preview")
    public Result<PreviewResultVO> preview(@RequestBody Map<String, Object> body) {
        String subject = (String) body.getOrDefault("subject", "");
        String templateBody = (String) body.getOrDefault("body", "");

        @SuppressWarnings("unchecked")
        Map<String, String> customVars = (Map<String, String>) body.getOrDefault("custom_vars", Map.of());

        Map<String, String> globalVars = variableService.getGlobalVarsMap();
        Map<String, String> mergedVars = new java.util.LinkedHashMap<>(globalVars);

        // 传了 customer_id 就按那位客户的真实信息渲染（与发送任务的变量口径同源），供"模板测试发送"使用；
        // 不传时行为与以往完全一致，仍用示例数据渲染。
        Object rawCustomerId = body.get("customer_id");
        if (rawCustomerId != null) {
            long customerId;
            try {
                customerId = Long.parseLong(String.valueOf(rawCustomerId).trim());
            } catch (NumberFormatException e) {
                return Result.error("customer_id 必须是数字");
            }
            Customer customer = customerService.getById(customerId);
            if (customer == null) {
                return Result.error("客户不存在，无法按该客户渲染模板");
            }
            mergedVars.putAll(CustomerService.toTemplateVars(customer));
        }

        mergedVars.putAll(customVars);

        Map<String, String> preview = templateService.previewTemplate(subject, templateBody, mergedVars);

        PreviewResultVO vo = new PreviewResultVO();
        vo.setSubject(preview.get("subject"));
        vo.setBody(preview.get("body"));
        return Result.successWithData(vo);
    }

    @PostMapping("/extract-variables")
    public Result<List<String>> extractVariables(@RequestBody Map<String, String> body) {
        String text = body.getOrDefault("text", "");
        List<String> vars = templateService.extractVariables(text);
        return Result.successWithData(vars);
    }
}
