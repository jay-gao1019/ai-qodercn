package com.emailsystem.controller;

import com.emailsystem.common.Result;
import com.emailsystem.service.DashboardService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 仪表盘明细数据接口，供统计卡片点击钻取使用。
 */
@RestController
@RequestMapping("/api/dashboard")
@RequiredArgsConstructor
public class DashboardController {

    private final DashboardService dashboardService;

    /**
     * 每个客户发送了多少邮件。
     * v2.32 需求3 / v2.33 需求4：sent / failed / total 任一非空即按该列次数"大于等于"筛选，全部留空即不过滤。
     * v2.44 需求 2：batch=current|history 时三个次数只累计该客户在各任务当前批次 / 历史批次里的记录。
     */
    @GetMapping("/customer-stats")
    public Result<Map<String, Object>> customerStats(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String sent,
            @RequestParam(required = false) String failed,
            @RequestParam(required = false) String total,
            @RequestParam(required = false) String batch,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(name = "page_size", defaultValue = "15") int pageSize) {
        return Result.successWithData(
                dashboardService.customerEmailStats(search, sent, failed, total, batch, page, pageSize));
    }

    /** 每个模板发送了几次 */
    @GetMapping("/template-stats")
    public Result<List<Map<String, Object>>> templateStats() {
        return Result.successWithData(dashboardService.templateStats());
    }

    /** 某客户的邮件发送明细（任务、模板、结果、时间） */
    @GetMapping("/customer-send-detail")
    public Result<Map<String, Object>> customerSendDetail(
            @RequestParam(name = "customer_id") Long customerId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(name = "page_size", defaultValue = "15") int pageSize) {
        return Result.successWithData(dashboardService.customerSendDetail(customerId, page, pageSize));
    }

    /**
     * 发送记录明细/汇总（v2.20，v2.37 需求4 起支持四个口径）：
     * period=day|week|month|year 配合 date 锚点（day=当天、week=所选日期所在自然周、month=所在月、year=所在年）；
     * 传 start+end 时按精确窗口（点击折线图数据点钻取该小时/日/月记录）；
     * mode=summary 返回按任务+模板聚合的记录（本周/本月/本年使用），缺省为逐封明细；
     * batch=current|history 只看各任务当前批次 / 历史批次的记录（v2.44 需求 2）。
     */
    @GetMapping("/send-records")
    public Result<Map<String, Object>> sendRecords(
            @RequestParam(required = false) String period,
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String start,
            @RequestParam(required = false) String end,
            @RequestParam(required = false) String mode,
            @RequestParam(required = false) String batch,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(name = "page_size", defaultValue = "15") int pageSize) {
        return Result.successWithData(
                dashboardService.sendRecords(period, date, start, end, mode, batch, page, pageSize));
    }

    /** 发送趋势（v2.37 需求4：period=day 当天逐小时；week 所选日期所在自然周逐日；month 当月逐日；year 当年逐月） */
    @GetMapping("/send-trend")
    public Result<Map<String, Object>> sendTrend(
            @RequestParam(defaultValue = "day") String period,
            @RequestParam(required = false) String date) {
        return Result.successWithData(dashboardService.sendTrend(period, date));
    }

    /**
     * 发送记录统计四个按钮的数值（v2.37 需求4）：
     * 以 date 为锚点，返回当日 / 所在自然周（周一~周日）/ 所在月 / 所在年的发送记录数（sent + failed）。
     */
    @GetMapping("/send-period-counts")
    public Result<Map<String, Object>> sendPeriodCounts(@RequestParam(required = false) String date) {
        return Result.successWithData(dashboardService.sendPeriodCounts(date));
    }
}
