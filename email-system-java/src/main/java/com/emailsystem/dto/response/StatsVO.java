package com.emailsystem.dto.response;

import lombok.Data;

@Data
public class StatsVO {
    private long customerCount;
    private long templateCount;
    private long totalCampaigns;
    /** 全部发送记录数（status 为 sent/failed 的日志总数，v2.19 供"发送统计"卡片展示） */
    private long sendRecordCount;
    /** v2.22：发送记录按时间窗口分段计数（当天/本周一至今/本月 1 日至今/本年 1 月 1 日至今） */
    private long sendRecordToday;
    private long sendRecordWeek;
    private long sendRecordMonth;
    private long sendRecordYear;
}
