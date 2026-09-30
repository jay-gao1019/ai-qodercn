package com.emailsystem.controller;

import com.emailsystem.common.Result;
import com.emailsystem.dto.request.CustomerBatchStatusByFilterDTO;
import com.emailsystem.dto.request.CustomerBatchStatusDTO;
import com.emailsystem.dto.request.CustomerCreateDTO;
import com.emailsystem.dto.request.CustomerUpdateDTO;
import com.emailsystem.dto.response.ImportResultVO;
import com.emailsystem.entity.Customer;
import com.emailsystem.service.CustomerService;
import com.emailsystem.service.FileService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/customers")
@RequiredArgsConstructor
public class CustomerController {

    private final CustomerService customerService;
    private final FileService fileService;

    @GetMapping("")
    public Result<Map<String, Object>> list(
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(name = "page_size", defaultValue = "20") int pageSize,
            @RequestParam(required = false) String status) {
        return Result.successWithData(customerService.list(search, page, pageSize, status));
    }

    /**
     * v2.42 需求1：按 ID 取单个客户，供"客户管理双击行直接进入编辑"回填表单。
     * <p>字面量路径（/active、/export 等）在 Spring 的匹配优先级高于该模板路径，不受影响。
     */
    @GetMapping("/{id}")
    public Result<Customer> get(@PathVariable Long id) {
        return Result.successWithData(customerService.getById(id));
    }

    /**
     * 有效客户分页列表，供创建发送任务时"选择客户"使用。
     * <p>name/email/country/tags 为独立的模糊筛选条件。
     * <p>v2.44 需求 2：编辑任务时传 exclude_campaign_id，该任务历史批次已发过的客户不再出现在候选里，
     * 响应额外给出 excluded_count（被排除的人数），界面据此说明"为什么少了几个人"。
     */
    @GetMapping("/active")
    public Result<Map<String, Object>> listActive(
            @RequestParam(required = false) String name,
            @RequestParam(required = false) String email,
            @RequestParam(required = false) String country,
            @RequestParam(required = false) String tags,
            @RequestParam(name = "exclude_campaign_id", required = false) Long excludeCampaignId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(name = "page_size", defaultValue = "10") int pageSize) {
        return Result.successWithData(
                customerService.listActivePaged(name, email, country, tags, excludeCampaignId, page, pageSize));
    }

    /** 与 /active 同一筛选条件下命中的全部有效客户 ID（跨页"全部选中"） */
    @GetMapping("/active/ids")
    public Result<List<Long>> listActiveIds(
            @RequestParam(required = false) String name,
            @RequestParam(required = false) String email,
            @RequestParam(required = false) String country,
            @RequestParam(required = false) String tags,
            @RequestParam(name = "exclude_campaign_id", required = false) Long excludeCampaignId) {
        return Result.successWithData(customerService.listActiveIds(name, email, country, tags, excludeCampaignId));
    }

    @PostMapping("")
    public Result<Void> create(@Valid @RequestBody CustomerCreateDTO dto) {
        customerService.create(dto);
        return Result.success("客户创建成功");
    }

    @PutMapping("/{id}")
    public Result<Void> update(@PathVariable Long id, @RequestBody CustomerUpdateDTO dto) {
        customerService.update(id, dto);
        return Result.success("客户更新成功");
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        customerService.delete(id);
        return Result.success("客户删除成功");
    }

    @PostMapping("/batch-delete")
    public Result<Void> batchDelete(@RequestBody Map<String, List<Long>> body) {
        List<Long> ids = body.getOrDefault("ids", List.of());
        if (ids.isEmpty()) {
            return Result.error("请选择要删除的客户");
        }
        customerService.batchDelete(ids);
        return Result.success("批量删除成功");
    }

    /**
     * 批量设置客户有效性（生效 / 失效）。
     */
    @PostMapping("/batch-status")
    public Result<Void> batchStatus(@Valid @RequestBody CustomerBatchStatusDTO dto) {
        customerService.batchUpdateStatus(dto.getIds(), dto.getStatus());
        String label = CustomerService.STATUS_ACTIVE.equals(dto.getStatus()) ? "生效" : "失效";
        return Result.success("已将选中的 " + dto.getIds().size() + " 个客户设置为" + label);
    }

    /**
     * 按筛选条件批量设置客户有效性（跨页“全选当前筛选结果”场景）。
     */
    @PostMapping("/batch-status-by-filter")
    public Result<Map<String, Object>> batchStatusByFilter(@Valid @RequestBody CustomerBatchStatusByFilterDTO dto) {
        int affected = customerService.batchUpdateStatusByFilter(
                dto.getSearch(), dto.getStatus(), dto.getExcludeIds(), dto.getTargetStatus());
        String label = CustomerService.STATUS_ACTIVE.equals(dto.getTargetStatus()) ? "生效" : "失效";
        Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("affected", affected);
        return Result.success("已将 " + affected + " 个客户设置为" + label, data);
    }

    @PostMapping("/import")
    public Result<ImportResultVO> importCustomers(@RequestParam("file") MultipartFile file) throws IOException {
        String filename = file.getOriginalFilename();
        if (filename == null || filename.isEmpty()) {
            return Result.error("文件名不能为空");
        }
        byte[] content = file.getBytes();
        List<Map<String, String>> parsed = fileService.parseFile(filename, content);
        customerService.importCustomers(parsed);
        ImportResultVO vo = new ImportResultVO();
        vo.setImported(parsed.size());
        return Result.success("导入成功", vo);
    }

    @GetMapping("/import-template")
    public void downloadImportTemplate(HttpServletResponse response) throws IOException {
        fileService.exportImportTemplate(response);
    }

    @GetMapping("/export")
    public void export(@RequestParam(defaultValue = "csv") String format,
                       HttpServletResponse response) throws IOException {
        List<Map<String, String>> customers = customerService.exportAll();
        if ("excel".equalsIgnoreCase(format) || "xlsx".equalsIgnoreCase(format)) {
            fileService.exportExcel(customers, response);
        } else {
            fileService.exportCsv(customers, response);
        }
    }
}
