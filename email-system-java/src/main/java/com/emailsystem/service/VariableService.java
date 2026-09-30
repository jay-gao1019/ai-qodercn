package com.emailsystem.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.emailsystem.dto.request.VariableCreateDTO;
import com.emailsystem.dto.request.VariableUpdateDTO;
import com.emailsystem.entity.Variable;
import com.emailsystem.mapper.VariableMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class VariableService {

    private final VariableMapper variableMapper;

    public List<Variable> listAll() {
        return variableMapper.selectList(
                new LambdaQueryWrapper<Variable>().orderByDesc(Variable::getId)
        );
    }

    public void create(VariableCreateDTO dto) {
        if (TemplateService.getBuiltInVarNames().contains(dto.getName())) {
            throw new com.emailsystem.common.BusinessException("变量名 \"" + dto.getName() + "\" 是系统内置变量，不可使用");
        }
        Variable variable = new Variable();
        variable.setName(dto.getName());
        variable.setDescription(dto.getDescription() != null ? dto.getDescription() : "");
        variable.setExampleValue(dto.getExampleValue() != null ? dto.getExampleValue() : "");
        try {
            variableMapper.insert(variable);
        } catch (DuplicateKeyException e) {
            throw new com.emailsystem.common.BusinessException("变量名 \"" + dto.getName() + "\" 已存在");
        }
    }

    public void update(Long id, VariableUpdateDTO dto) {
        Variable variable = variableMapper.selectById(id);
        if (variable == null) return;

        if (dto.getName() != null) {
            if (TemplateService.getBuiltInVarNames().contains(dto.getName()) && !dto.getName().equals(variable.getName())) {
                throw new com.emailsystem.common.BusinessException("变量名 \"" + dto.getName() + "\" 是系统内置变量，不可使用");
            }
            variable.setName(dto.getName());
        }
        if (dto.getDescription() != null) variable.setDescription(dto.getDescription());
        if (dto.getExampleValue() != null) variable.setExampleValue(dto.getExampleValue());
        try {
            variableMapper.updateById(variable);
        } catch (DuplicateKeyException e) {
            throw new com.emailsystem.common.BusinessException("该变量名已被使用");
        }
    }

    public void delete(Long id) {
        variableMapper.deleteById(id);
    }

    public Map<String, String> getGlobalVarsMap() {
        List<Variable> vars = variableMapper.selectList(null);
        return vars.stream().collect(Collectors.toMap(
                Variable::getName,
                v -> v.getExampleValue() != null ? v.getExampleValue() : "",
                (a, b) -> a
        ));
    }
}
