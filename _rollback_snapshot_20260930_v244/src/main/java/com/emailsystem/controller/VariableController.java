package com.emailsystem.controller;

import com.emailsystem.common.Result;
import com.emailsystem.dto.request.VariableCreateDTO;
import com.emailsystem.dto.request.VariableUpdateDTO;
import com.emailsystem.entity.Variable;
import com.emailsystem.service.VariableService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/variables")
@RequiredArgsConstructor
public class VariableController {

    private final VariableService variableService;

    @GetMapping("")
    public Result<List<Variable>> list() {
        return Result.successWithData(variableService.listAll());
    }

    @PostMapping("")
    public Result<Void> create(@Valid @RequestBody VariableCreateDTO dto) {
        variableService.create(dto);
        return Result.success("变量创建成功");
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody VariableUpdateDTO dto) {
        variableService.update(id, dto);
        return Result.success("变量更新成功");
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        variableService.delete(id);
        return Result.success("变量删除成功");
    }
}
