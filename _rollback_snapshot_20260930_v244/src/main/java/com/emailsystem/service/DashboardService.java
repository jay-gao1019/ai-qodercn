package com.emailsystem.service;

import com.emailsystem.entity.Customer;
import com.emailsystem.mapper.CustomerMapper;
import com.emailsystem.mapper.DashboardMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 仪表盘明细统计：客户维度邮件数、模板维度发送数、发送记录/趋势（当日/本周/本月/本年）。
 */
@Service
@RequiredArgsConstructor
public class DashboardService {

    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    private final DashboardMapper dashboardMapper;
    private final CustomerMapper customerMapper;

    /**
     * 客户维度邮件统计（v2.32 需求3）：关键字与三个次数条件都可留空，留空即不参与筛选。
     * v2.33 需求4：去掉"比较方式"，三个次数条件固定按"大于等于"匹配。
     * v2.44 需求 2：batch=current|history 只统计各任务当前批次 / 历史批次的记录。
     */
    public Map<String, Object> customerEmailStats(String search, String sent, String failed, String total,
                                                  String batch, int page, int pageSize) {
        String keyword = blankToNull(search);
        Integer sentCount = parseCount(sent);
        Integer failedCount = parseCount(failed);
        Integer totalCount = parseCount(total);
        String batchFilter = normalizeBatch(batch);
        int offset = (page - 1) * pageSize;

        List<Map<String, Object>> rows = dashboardMapper.selectCustomerEmailStats(
                keyword, sentCount, failedCount, totalCount, batchFilter, pageSize, offset);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("customers", rows);
        data.put("total", dashboardMapper.countCustomers(keyword, sentCount, failedCount, totalCount, batchFilter));
        return data;
    }

    /** v2.44 需求 2：批次筛选只认 current / history 两类，其余（含留空）一律不限批次 */
    private String normalizeBatch(String batch) {
        if ("current".equals(batch) || "history".equals(batch)) return batch;
        return null;
    }

    /** 次数条件：非数字或负数视为"未填写" */
    private Integer parseCount(String value) {
        String s = blankToNull(value);
        if (s == null || !s.matches("\\d{1,9}")) return null;
        return Integer.valueOf(s);
    }

    private String blankToNull(String value) {
        if (value == null) return null;
        String s = value.trim();
        return s.isEmpty() ? null : s;
    }

    public List<Map<String, Object>> templateStats() {
        return dashboardMapper.selectTemplateStats();
    }

    /** 某客户的邮件发送明细：任务、模板、结果、发送时间 */
    public Map<String, Object> customerSendDetail(Long customerId, int page, int pageSize) {
        Customer customer = customerMapper.selectById(customerId);
        int offset = (page - 1) * pageSize;
        Map<String, Object> data = new LinkedHashMap<>();
        if (customer != null) {
            Map<String, Object> brief = new LinkedHashMap<>();
            brief.put("id", customer.getId());
            brief.put("name", customer.getName());
            brief.put("email", customer.getEmail());
            brief.put("company", customer.getCompany());
            data.put("customer", brief);
        }
        data.put("records", dashboardMapper.selectCustomerSendDetail(customerId, pageSize, offset));
        data.put("total", dashboardMapper.countCustomerSendDetail(customerId));
        return data;
    }

    /**
     * 按周期查询发送记录明细/汇总。
     *
     * @param period  day / week / month / year，配合 date 计算时间窗；为空表示不限时间
     * @param date    周期锚点日期 yyyy-MM-dd，默认今天
     * @param start   可选，精确窗口起点（点击折线图某点后由前端传入，覆盖 period 窗口）
     * @param end     可选，精确窗口终点
     * @param mode    detail（默认，逐封明细）/ summary（按任务+模板聚合，按周/按年使用）
     * @param batch   v2.44 需求 2：current=只看各任务当前批次 / history=只看历史批次 / 留空不限
     */
    public Map<String, Object> sendRecords(String period, String date, String start, String end,
                                           String mode, String batch, int page, int pageSize) {
        String exactStart = normalizeDateTime(start, false);
        String exactEnd = normalizeDateTime(end, true);
        String windowStart;
        String windowEnd;
        if (exactStart != null && exactEnd != null) {
            windowStart = exactStart;
            windowEnd = exactEnd;
        } else {
            String[] window = resolveWindow(period, date);
            windowStart = window != null ? window[0] + " 00:00:00" : null;
            windowEnd = window != null ? window[1] + " 23:59:59" : null;
        }
        int offset = (page - 1) * pageSize;
        String batchFilter = normalizeBatch(batch);

        Map<String, Object> summary = dashboardMapper.countSendRecords(windowStart, windowEnd, batchFilter);
        Map<String, Object> data = new LinkedHashMap<>();
        boolean summaryMode = "summary".equals(mode);
        data.put("records", summaryMode
                ? dashboardMapper.selectSendSummary(windowStart, windowEnd, batchFilter, pageSize, offset)
                : dashboardMapper.selectSendRecords(windowStart, windowEnd, batchFilter, pageSize, offset));
        data.put("mode", summaryMode ? "summary" : "detail");
        data.put("batch", batchFilter);
        data.put("total", summaryMode
                ? dashboardMapper.countSendSummary(windowStart, windowEnd, batchFilter)
                : (summary != null ? summary.get("total") : 0));
        data.put("sent_count", countOf(summary, "sent_count"));
        data.put("failed_count", countOf(summary, "failed_count"));
        data.put("start", windowStart);
        data.put("end", windowEnd);
        return data;
    }

    /**
     * 发送记录统计四个按钮的数值（v2.37 需求4）：以日期框选中的日期为锚点，
     * 分别统计当日 / 所在自然周（周一~周日）/ 所在月 / 所在年的发送记录数。
     * 口径与仪表盘"发送统计"卡片一致：只累计 sent + failed，一条条件聚合查询算完四个数。
     */
    public Map<String, Object> sendPeriodCounts(String date) {
        LocalDate anchor = parseDate(date);
        LocalDate monday = weekMonday(anchor);
        Map<String, Object> row = dashboardMapper.selectSendPeriodCounts(
                anchor.atStartOfDay(), endOfDay(anchor),
                monday.atStartOfDay(), endOfDay(monday.plusDays(6)),
                anchor.withDayOfMonth(1).atStartOfDay(), endOfDay(anchor.withDayOfMonth(anchor.lengthOfMonth())),
                anchor.withDayOfYear(1).atStartOfDay(), endOfDay(anchor.withDayOfYear(anchor.lengthOfYear())));
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("date", anchor.format(DATE_FMT));
        data.put("day", countOf(row, "day_count"));
        data.put("week", countOf(row, "week_count"));
        data.put("month", countOf(row, "month_count"));
        data.put("year", countOf(row, "year_count"));
        return data;
    }

    private LocalDateTime endOfDay(LocalDate day) {
        return day.atTime(23, 59, 59);
    }

    private long countOf(Map<String, Object> row, String key) {
        return row == null ? 0L : toLong(row.get(key));
    }

    /**
     * 发送趋势（v2.37 需求4：与"当日/本周/本月/本年"四个统计按钮一一对应）：
     * day   按日 = 锚点当天 24 个小时桶（标签 01-24 时）；
     * week  按周 = 锚点所在自然周（周一至周日）逐日统计（标签 MM-dd）；
     * month 按月 = 锚点所在月份逐日统计（标签 1-31）；
     * year  按年 = 锚点所在年份 1-12 月逐月统计（标签 N月）。
     * bucket_ranges 返回每个数据点对应的时间窗，供前端点击折线点钻取该段记录。
     */
    public Map<String, Object> sendTrend(String period, String date) {
        String p = normalizePeriod(period);
        LocalDate anchor = parseDate(date);
        List<String> labels = new ArrayList<>();
        List<Map<String, Object>> bucketRanges = new ArrayList<>();
        // key = 分桶标识；LinkedHashMap 插入顺序即时间顺序
        Map<String, long[]> buckets = new LinkedHashMap<>();
        LocalDate rangeStart = anchor;
        LocalDate rangeEnd = anchor;

        if ("day".equals(p)) {
            String day = anchor.format(DATE_FMT);
            for (int h = 0; h < 24; h++) {
                String key = String.format("%02d", h);
                buckets.put(key, new long[]{0, 0});
                labels.add(String.format("%02d", h + 1)); // 01-24 时
                bucketRanges.add(bucketRange(
                        day + " " + key + ":00:00", day + " " + key + ":59:59"));
            }
            accumulate(dashboardMapper.selectTrendByHour(day), buckets);
        } else {
            boolean byMonth = "year".equals(p);
            if (byMonth) {
                rangeStart = anchor.withDayOfYear(1);
                rangeEnd = anchor.withDayOfYear(anchor.lengthOfYear());
                DateTimeFormatter monthFmt = DateTimeFormatter.ofPattern("yyyy-MM");
                for (int m = 1; m <= 12; m++) {
                    LocalDate first = rangeStart.plusMonths(m - 1L);
                    LocalDate last = first.withDayOfMonth(first.lengthOfMonth());
                    buckets.put(first.format(monthFmt), new long[]{0, 0});
                    labels.add(m + "月");
                    bucketRanges.add(bucketRange(
                            first.format(DATE_FMT) + " 00:00:00", last.format(DATE_FMT) + " 23:59:59"));
                }
            } else {
                if ("week".equals(p)) {
                    rangeStart = weekMonday(anchor);
                    rangeEnd = rangeStart.plusDays(6);
                } else {
                    rangeStart = anchor.withDayOfMonth(1);
                    rangeEnd = anchor.withDayOfMonth(anchor.lengthOfMonth());
                }
                DateTimeFormatter dayFmt = DateTimeFormatter.ofPattern("MM-dd");
                for (LocalDate d = rangeStart; !d.isAfter(rangeEnd); d = d.plusDays(1)) {
                    String day = d.format(DATE_FMT);
                    buckets.put(day, new long[]{0, 0});
                    // 自然周显示"月-日"（7 个点），整月显示"几号"（最多 31 个点）
                    labels.add("week".equals(p) ? d.format(dayFmt) : String.valueOf(d.getDayOfMonth()));
                    bucketRanges.add(bucketRange(day + " 00:00:00", day + " 23:59:59"));
                }
            }
            accumulate(byMonth
                    ? dashboardMapper.selectTrendByMonth(rangeStart.format(DATE_FMT), rangeEnd.format(DATE_FMT))
                    : dashboardMapper.selectTrendByDay(rangeStart.format(DATE_FMT), rangeEnd.format(DATE_FMT)),
                    buckets);
        }

        List<Long> sent = new ArrayList<>();
        List<Long> failed = new ArrayList<>();
        long totalSent = 0;
        long totalFailed = 0;
        for (long[] v : buckets.values()) {
            sent.add(v[0]);
            failed.add(v[1]);
            totalSent += v[0];
            totalFailed += v[1];
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("period", p);
        data.put("start", rangeStart.format(DATE_FMT));
        data.put("end", rangeEnd.format(DATE_FMT));
        data.put("labels", labels);
        data.put("sent", sent);
        data.put("failed", failed);
        data.put("bucket_ranges", bucketRanges);
        data.put("total_sent", totalSent);
        data.put("total_failed", totalFailed);
        return data;
    }

    private Map<String, Object> bucketRange(String start, String end) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("start", start);
        r.put("end", end);
        return r;
    }

    /** 趋势行累加：SQL 返回的 bucket 就是分桶 key（小时 / yyyy-MM-dd / yyyy-MM） */
    private void accumulate(List<Map<String, Object>> rows, Map<String, long[]> buckets) {
        for (Map<String, Object> row : rows) {
            long[] v = buckets.get(String.valueOf(row.get("bucket")));
            if (v != null) {
                v[0] += toLong(row.get("sent_count"));
                v[1] += toLong(row.get("failed_count"));
            }
        }
    }

    /** v2.37 需求4 口径：day=锚点当天；week=锚点所在自然周；month=锚点所在月份；year=锚点所在年份 */
    private String[] resolveWindow(String period, String date) {
        if (period == null || period.isEmpty()) return null;
        LocalDate anchor = parseDate(date);
        return switch (normalizePeriod(period)) {
            case "week" -> new String[]{
                    weekMonday(anchor).format(DATE_FMT),
                    weekMonday(anchor).plusDays(6).format(DATE_FMT)};
            case "month" -> new String[]{
                    anchor.withDayOfMonth(1).format(DATE_FMT),
                    anchor.withDayOfMonth(anchor.lengthOfMonth()).format(DATE_FMT)};
            case "year" -> new String[]{
                    anchor.withDayOfYear(1).format(DATE_FMT),
                    anchor.withDayOfYear(anchor.lengthOfYear()).format(DATE_FMT)};
            default -> new String[]{anchor.format(DATE_FMT), anchor.format(DATE_FMT)};
        };
    }

    private String normalizePeriod(String period) {
        if ("week".equals(period) || "month".equals(period) || "year".equals(period)) return period;
        return "day";
    }

    /** 锚点所在自然周的周一（ISO 周，周一为一周首日） */
    private LocalDate weekMonday(LocalDate anchor) {
        return anchor.minusDays(anchor.getDayOfWeek().getValue() - 1L);
    }

    /** 校验前端传入的精确窗口端点：yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss，非法返回 null */
    private String normalizeDateTime(String value, boolean endOfDay) {
        if (value == null) return null;
        String s = value.trim().replace('T', ' ');
        if (s.matches("\\d{4}-\\d{2}-\\d{2}")) {
            return s + (endOfDay ? " 23:59:59" : " 00:00:00");
        }
        if (s.matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}")) return s;
        return null;
    }

    private LocalDate parseDate(String date) {
        if (date != null && date.matches("\\d{4}-\\d{2}-\\d{2}")) {
            try {
                return LocalDate.parse(date, DATE_FMT);
            } catch (Exception ignored) {
                // fall through
            }
        }
        return LocalDate.now();
    }

    private long toLong(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }
}
