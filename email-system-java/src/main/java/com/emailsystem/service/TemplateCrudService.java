package com.emailsystem.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.emailsystem.dto.request.TemplateCreateDTO;
import com.emailsystem.dto.request.TemplateUpdateDTO;
import com.emailsystem.entity.Template;
import com.emailsystem.mapper.TemplateMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class TemplateCrudService {

    private final TemplateMapper templateMapper;
    private final ObjectMapper objectMapper;

    public List<Template> listAll() {
        List<Template> templates = templateMapper.selectList(
                new LambdaQueryWrapper<Template>().orderByDesc(Template::getId)
        );
        for (Template t : templates) {
            t.setVariables(normalizeVariablesJson(t.getVariables()));
        }
        return templates;
    }

    public void create(TemplateCreateDTO dto) {
        Template template = new Template();
        template.setName(dto.getName());
        template.setSubject(dto.getSubject());
        template.setBody(dto.getBody());
        template.setVariables(serializeVariables(dto.getVariables()));
        templateMapper.insert(template);
    }

    public void update(Long id, TemplateUpdateDTO dto) {
        Template template = templateMapper.selectById(id);
        if (template == null) return;

        if (dto.getName() != null) template.setName(dto.getName());
        if (dto.getSubject() != null) template.setSubject(dto.getSubject());
        if (dto.getBody() != null) template.setBody(dto.getBody());
        if (dto.getVariables() != null) template.setVariables(serializeVariables(dto.getVariables()));
        templateMapper.updateById(template);
    }

    public void delete(Long id) {
        templateMapper.deleteById(id);
    }

    public Template getById(Long id) {
        Template t = templateMapper.selectById(id);
        if (t != null) {
            t.setVariables(normalizeVariablesJson(t.getVariables()));
        }
        return t;
    }

    public void duplicate(Long id) {
        Template original = templateMapper.selectById(id);
        if (original == null) return;

        Template copy = new Template();
        copy.setName(original.getName() + " (副本)");
        copy.setSubject(original.getSubject());
        copy.setBody(original.getBody());
        copy.setVariables(original.getVariables());
        templateMapper.insert(copy);
    }

    public long count() {
        return templateMapper.selectCount(null);
    }

    private String serializeVariables(List<String> variables) {
        if (variables == null) return "[]";
        try {
            return objectMapper.writeValueAsString(variables);
        } catch (JsonProcessingException e) {
            return "[]";
        }
    }

    private String normalizeVariablesJson(String json) {
        if (json == null || json.isEmpty()) return "[]";
        try {
            List<String> list = objectMapper.readValue(json, new TypeReference<List<String>>() {});
            return objectMapper.writeValueAsString(list);
        } catch (Exception e) {
            return json;
        }
    }
}
