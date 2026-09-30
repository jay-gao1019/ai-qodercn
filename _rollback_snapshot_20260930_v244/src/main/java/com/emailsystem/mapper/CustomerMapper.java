package com.emailsystem.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emailsystem.entity.Customer;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface CustomerMapper extends BaseMapper<Customer> {

    /**
     * v2.44 需求 2：该任务历史批次已经发过（有 sent/failed 留痕）、且目前仍是有效客户的数量。
     * <p>正好等于"选择客户"列表因排除而少掉的行数，故界面用它说明排除了多少人；
     * 已失效的历史收件人不计（列表本来就看不到他们）。
     */
    @Select("""
        SELECT COUNT(DISTINCT cl.customer_id)
        FROM campaign_logs cl
        JOIN customers c ON c.id = cl.customer_id
        WHERE cl.campaign_id = #{campaignId}
          AND cl.status IN ('sent', 'failed')
          AND (c.status <> 'inactive' OR c.status IS NULL)
    """)
    long countSentActiveCustomers(@Param("campaignId") Long campaignId);
}
