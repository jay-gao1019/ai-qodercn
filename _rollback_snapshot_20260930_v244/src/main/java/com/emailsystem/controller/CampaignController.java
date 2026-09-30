package com.emailsystem.controller;

import com.emailsystem.common.Result;
import com.emailsystem.dto.request.CampaignCreateDTO;
import com.emailsystem.dto.response.StatsVO;
import com.emailsystem.service.CampaignService;
import com.emailsystem.task.CampaignTaskManager;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/campaigns")
@RequiredArgsConstructor
public class CampaignController {

    private final CampaignService campaignService;
    private final CampaignTaskManager taskManager;

    @GetMapping("/stats")
    public Result<StatsVO> stats() {
        return Result.successWithData(campaignService.getStats());
    }

    @GetMapping("")
    public Result<?> list(@RequestParam(defaultValue = "0") int page,
                          @RequestParam(defaultValue = "0") int page_size) {
        if (page > 0 && page_size > 0) {
            return Result.successWithData(campaignService.listPaged(page, page_size));
        }
        return Result.successWithData(campaignService.listAll());
    }

    /**
     * 单个任务的详情（v2.32 需求1/6）：详情页只需要当前任务，
     * 由后端按 ID 查询并附带待发送数，取代前端"拉全量任务列表再自行查找"。
     */
    @GetMapping("/{id}")
    public Result<Map<String, Object>> detail(@PathVariable("id") Long campaignId) {
        return Result.successWithData(campaignService.getDetail(campaignId));
    }

    @PostMapping("")
    public Result<Map<String, Object>> create(@Valid @RequestBody CampaignCreateDTO dto) {
        Map<String, Object> data = campaignService.create(dto);
        return Result.success("发送任务创建成功", data);
    }

    /**
     * v2.42 需求6：编辑任务。只要任务不在发送中即可编辑名称、模板、SMTP、发送间隔、发送方式与收件人列表；
     * 已发出（sent/failed）的收件人会强制保留，以保证仪表盘与客户/模板统计口径不被抹掉。
     */
    @PutMapping("/{id}/edit")
    public Result<Map<String, Object>> edit(@PathVariable("id") Long campaignId,
                                            @Valid @RequestBody CampaignCreateDTO dto) {
        Map<String, Object> data = campaignService.edit(campaignId, dto);
        return Result.success("任务已更新", data);
    }

    @PostMapping("/{id}/start")
    public Result<Void> start(@PathVariable("id") Long campaignId) {
        campaignService.startCampaign(campaignId);
        return Result.success("发送任务已启动");
    }

    @PostMapping("/{id}/cancel")
    public Result<Void> cancel(@PathVariable("id") Long campaignId) {
        if (taskManager.isRunning(campaignId)) {
            campaignService.cancelCampaign(campaignId);
            return Result.success("任务已取消");
        }
        return Result.error("任务未运行或不存在");
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable("id") Long campaignId) {
        campaignService.delete(campaignId);
        return Result.success("任务删除成功");
    }

    /**
     * 继续发送：网络/系统故障或停止后，重新发送本任务中所有未成功的邮件；已发送成功的不再重发。
     */
    @PostMapping("/{id}/resume")
    public Result<Void> resume(@PathVariable("id") Long campaignId) {
        int count = campaignService.resume(campaignId);
        if (count == 0) {
            return Result.error("没有待发送或失败的记录，无需继续发送");
        }
        return Result.success("正在继续发送 " + count + " 封未成功的邮件");
    }

    @PostMapping("/{id}/resend-all")
    public Result<Void> resendAll(@PathVariable("id") Long campaignId) {
        int totalCount = campaignService.resendAll(campaignId);
        if (totalCount == 0) {
            return Result.error("该任务没有发送记录");
        }
        return Result.success("正在重新发送给全部 " + totalCount + " 个客户");
    }

    /** 任务每次发送的尝试明细（可按运行 run_id、发送状态 status、客户 customer_id、批次 batch_no 过滤） */
    @GetMapping("/{id}/attempts")
    public Result<Map<String, Object>> attempts(
            @PathVariable("id") Long campaignId,
            @RequestParam(name = "run_id", required = false) Long runId,
            @RequestParam(required = false) String status,
            @RequestParam(name = "customer_id", required = false) Long customerId,
            @RequestParam(name = "batch_no", required = false) Integer batchNo,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(name = "page_size", defaultValue = "15") int pageSize) {
        return Result.successWithData(
                campaignService.getSendAttempts(campaignId, runId, status, customerId, batchNo, page, pageSize));
    }

    /** 任务发送记录（可按状态 status=sent|failed|pending、批次 batch_no 过滤，缺省均为全部；v2.32 需求1 增加 pending） */
    @GetMapping("/{id}/logs")
    public Result<Map<String, Object>> logs(
            @PathVariable("id") Long campaignId,
            @RequestParam(required = false) String status,
            @RequestParam(name = "batch_no", required = false) Integer batchNo,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(name = "page_size", defaultValue = "50") int pageSize) {
        return Result.successWithData(campaignService.getLogs(campaignId, status, batchNo, page, pageSize));
    }

    /**
     * v2.44 需求 2：任务发送批次概览，"发送记录"弹窗的"批次概览"页签与编辑任务的批次说明都读这里。
     * <p>一行一个批次，给出该批收件人数与成功/失败/待发送、开批与首末发送时间、本次新增/移出人数。
     */
    @GetMapping("/{id}/batches")
    public Result<Map<String, Object>> batches(@PathVariable("id") Long campaignId) {
        return Result.successWithData(campaignService.getBatches(campaignId));
    }
}
