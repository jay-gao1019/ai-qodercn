package com.emailsystem.dto.request;

import lombok.Data;

import java.util.List;

/**
 * 按筛选条件批量删除客户的请求参数（v2.53 需求1）。
 * <p>用于“全选当前筛选条件下所有记录”后的跨页批量删除：ids 不再逐条传递，
 * 由后端按 search/status 过滤，exclude_ids 为全选取中后又取消勾选的排除项，
 * 与 {@link CustomerBatchStatusByFilterDTO} 同一套筛选口径。
 */
@Data
public class CustomerBatchDeleteByFilterDTO {

    /** 关键字过滤，与列表查询一致（客户号/姓名/邮箱/公司/标签模糊匹配），空则不过滤 */
    private String search;

    /** 状态过滤: active / inactive，空表示全部状态 */
    private String status;

    /** 全选取中后又取消勾选的客户 ID（排除项） */
    private List<Long> excludeIds;
}
