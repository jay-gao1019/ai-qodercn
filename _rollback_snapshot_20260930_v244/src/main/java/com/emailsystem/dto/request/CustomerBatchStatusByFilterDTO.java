package com.emailsystem.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

import java.util.List;

/**
 * 按筛选条件批量设置客户有效性的请求参数。
 * <p>用于“全选当前筛选条件下所有记录”后的跨页批量生效/失效，
 * ids 不再逐条传递，而是由后端按 search/status 过滤，exclude_ids 为反选排除项。
 */
@Data
public class CustomerBatchStatusByFilterDTO {

    /** 关键字过滤，与列表查询一致（姓名/邮箱/公司/标签模糊匹配），空则不过滤 */
    private String search;

    /** 状态过滤: active / inactive，空表示全部状态 */
    private String status;

    /** 全选取中后又取消勾选的客户 ID（排除项） */
    private List<Long> excludeIds;

    /** 目标状态 active=生效 / inactive=失效 */
    @NotBlank(message = "目标状态不能为空")
    @Pattern(regexp = "active|inactive", message = "状态只能是 active 或 inactive")
    private String targetStatus;
}
