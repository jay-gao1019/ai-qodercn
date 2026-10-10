package com.emailsystem.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.emailsystem.dto.request.CustomerCreateDTO;
import com.emailsystem.dto.request.CustomerUpdateDTO;
import com.emailsystem.entity.Customer;
import com.emailsystem.mapper.CustomerMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class CustomerService {

    /** 有效客户 */
    public static final String STATUS_ACTIVE = "active";
    /** 失效客户 */
    public static final String STATUS_INACTIVE = "inactive";

    private final CustomerMapper customerMapper;

    /**
     * 分页查询客户。
     *
     * @param status 可选，按有效性过滤：active / inactive，为空则不过滤
     */
    public Map<String, Object> list(String search, int page, int pageSize, String status) {
        LambdaQueryWrapper<Customer> wrapper = new LambdaQueryWrapper<>();
        if (search != null && !search.isEmpty()) {
            String s = "%" + search + "%";
            // v2.40 需求2：客户号同样是可搜索的关键字
            wrapper.and(w -> w.like(Customer::getCustomerNo, s)
                    .or().like(Customer::getName, s)
                    .or().like(Customer::getEmail, s)
                    .or().like(Customer::getCompany, s)
                    .or().like(Customer::getTags, s));
        }
        if (status != null && !status.isEmpty()) {
            wrapper.eq(Customer::getStatus, status);
        }
        wrapper.orderByDesc(Customer::getId);

        Page<Customer> pageObj = new Page<>(page, pageSize);
        Page<Customer> result = customerMapper.selectPage(pageObj, wrapper);

        Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("customers", result.getRecords());
        data.put("total", result.getTotal());
        data.put("page", page);
        data.put("page_size", pageSize);
        return data;
    }

    /**
     * 分页查询有效客户，供发送任务"选择客户"列表使用。
     * <p>search 是对姓名/邮箱/国家/标签四个值的"或"模糊匹配（合并搜索框，v2.43 需求5.3.1）；
     * name 是只按姓名的模糊筛选（供"测试模板"的客户搜索使用），留空的条件不参与筛选。
     */
    public Map<String, Object> listActivePaged(String name, String search, int page, int pageSize) {
        Page<Customer> pageObj = new Page<>(page, pageSize);
        Page<Customer> result = customerMapper.selectPage(pageObj,
                activeFilter(name, search).orderByDesc(Customer::getId));

        Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("customers", result.getRecords());
        data.put("total", result.getTotal());
        data.put("page", page);
        data.put("page_size", pageSize);
        return data;
    }

    /** 同一筛选条件下命中的全部有效客户 ID（"全部选中筛选结果"使用，不受分页限制） */
    public List<Long> listActiveIds(String name, String search) {
        return customerMapper.selectList(activeFilter(name, search).select(Customer::getId))
                .stream().map(Customer::getId).toList();
    }

    /**
     * 构造"仅有效客户 + 可选模糊筛选"的查询条件。
     * <p>采用"非失效即有效"的判定，避免历史数据 status 为 NULL 时被漏掉。
     */
    private LambdaQueryWrapper<Customer> activeFilter(String name, String search) {
        LambdaQueryWrapper<Customer> wrapper = new LambdaQueryWrapper<Customer>()
                .and(w -> w.ne(Customer::getStatus, STATUS_INACTIVE)
                        .or().isNull(Customer::getStatus));
        if (name != null && !name.isBlank()) wrapper.like(Customer::getName, name.trim());
        if (search != null && !search.isBlank()) {
            String kw = search.trim();
            wrapper.and(w -> w.like(Customer::getName, kw)
                    .or().like(Customer::getEmail, kw)
                    .or().like(Customer::getCountry, kw)
                    .or().like(Customer::getTags, kw));
        }
        return wrapper;
    }

    /**
     * 把客户记录展开成模板变量表，键名与发送任务执行时的口径完全一致。
     * 供 {@code CampaignExecutor} 与"模板预览/测试模板"共用，避免两处各写一份字段映射。
     */
    public static Map<String, String> toTemplateVars(Customer customer) {
        Map<String, String> map = new java.util.LinkedHashMap<>();
        map.put("cust_name", nullToEmpty(customer.getName()));
        map.put("cust_email", nullToEmpty(customer.getEmail()));
        map.put("cust_company", nullToEmpty(customer.getCompany()));
        map.put("cust_phone", nullToEmpty(customer.getPhone()));
        map.put("cust_country", nullToEmpty(customer.getCountry()));
        map.put("cust_tags", nullToEmpty(customer.getTags()));
        map.put("cust_notes", nullToEmpty(customer.getNotes()));
        return map;
    }

    private static String nullToEmpty(String s) {
        return s != null ? s : "";
    }

    public Customer getById(Long id) {
        return customerMapper.selectById(id);
    }

    public void batchUpdateStatus(List<Long> ids, String status) {
        if (ids == null || ids.isEmpty()) return;
        com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<Customer> wrapper =
                new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<Customer>()
                        .in(Customer::getId, ids)
                        .set(Customer::getStatus, status);
        customerMapper.update(null, wrapper);
    }

    /**
     * 按筛选条件批量设置客户有效性（跨页“全选”场景）。
     * <p>过滤逻辑与列表查询保持一致：search 对姓名/邮箱/公司/标签做模糊匹配，
     * status 为空表示全部状态，excludeIds 为全选取中后又被手动取消勾选的排除项。
     *
     * @return 实际被更新的记录数
     */
    public int batchUpdateStatusByFilter(String search, String status, List<Long> excludeIds, String targetStatus) {
        LambdaQueryWrapper<Customer> wrapper = byFilterWrapper(search, status, excludeIds);

        // 先统计命中的记录，用于返回真实变更数量（并排除已是目标状态的记录）
        wrapper.select(Customer::getId, Customer::getStatus);
        List<Customer> matched = customerMapper.selectList(wrapper);
        List<Long> toUpdate = matched.stream()
                .filter(c -> !targetStatus.equals(c.getStatus()))
                .map(Customer::getId)
                .collect(Collectors.toList());
        if (toUpdate.isEmpty()) return 0;

        customerMapper.update(null,
                new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<Customer>()
                        .in(Customer::getId, toUpdate)
                        .set(Customer::getStatus, targetStatus));
        return toUpdate.size();
    }

    /**
     * 构造跨页“全选当前筛选结果”的查询条件，口径与 {@link #list} 完全一致。
     * <p>批量生效/失效与批量删除（v2.53 需求1）共用这一份，避免两种批量操作的“选中范围”分叉。
     */
    private LambdaQueryWrapper<Customer> byFilterWrapper(String search, String status, List<Long> excludeIds) {
        LambdaQueryWrapper<Customer> wrapper = new LambdaQueryWrapper<>();
        if (search != null && !search.isEmpty()) {
            String s = "%" + search + "%";
            // 与 list() 同口径，跨页全选时按客户号搜索也能命中
            wrapper.and(w -> w.like(Customer::getCustomerNo, s)
                    .or().like(Customer::getName, s)
                    .or().like(Customer::getEmail, s)
                    .or().like(Customer::getCompany, s)
                    .or().like(Customer::getTags, s));
        }
        if (status != null && !status.isEmpty()) {
            wrapper.eq(Customer::getStatus, status);
        }
        if (excludeIds != null && !excludeIds.isEmpty()) {
            wrapper.notIn(Customer::getId, excludeIds);
        }
        return wrapper;
    }

    /** 批量删除的结果计数：真正删除的、因“生效状态”被保护的 */
    public record BatchDeleteResult(int deleted, int skippedActive) {

        public Map<String, Object> toData() {
            Map<String, Object> data = new java.util.LinkedHashMap<>();
            data.put("deleted", deleted);
            data.put("skipped_active", skippedActive);
            return data;
        }
    }

    /**
     * 按筛选条件批量删除客户（v2.53 需求1：跨页“全选当前筛选结果”后也能删除）。
     * <p>删除范围与 {@link #batchUpdateStatusByFilter} 命中的记录一致。
     */
    public BatchDeleteResult batchDeleteByFilter(String search, String status, List<Long> excludeIds) {
        List<Customer> matched = customerMapper.selectList(
                byFilterWrapper(search, status, excludeIds).select(Customer::getId));
        return deleteGuarded(matched.stream().map(Customer::getId).collect(Collectors.toList()));
    }

    /**
     * 带保护的批量删除：只删除“失效”的客户，生效客户按原因计数返回。
     * <p>“生效客户不许删除”是界面既有口径，改由后端兜底，避免旧页面或并发状态绕过。
     * <p>v2.54 需求1：不再跳过“有发送记录”的客户。这条保护原本来自 campaign_logs 上
     * 无 ON DELETE 的外键（RESTRICT），现在外键已撤，发送记录靠自身的收件人快照继续展示
     * （{@code selectLogsWithCustomer} / {@code selectSendRecords} 客户表查不到就用快照），
     * 所以删掉客户不会连带丢历史，跨页全选能真正删完选中的记录。
     */
    public BatchDeleteResult deleteGuarded(List<Long> ids) {
        List<Long> requested = ids == null ? List.of()
                : ids.stream().filter(Objects::nonNull).distinct().collect(Collectors.toList());
        if (requested.isEmpty()) return new BatchDeleteResult(0, 0);

        List<Customer> rows = customerMapper.selectList(
                new LambdaQueryWrapper<Customer>().select(Customer::getId, Customer::getStatus)
                        .in(Customer::getId, requested));
        List<Long> inactiveIds = rows.stream()
                .filter(c -> STATUS_INACTIVE.equals(c.getStatus()))
                .map(Customer::getId)
                .collect(Collectors.toList());
        int skippedActive = rows.size() - inactiveIds.size();

        if (!inactiveIds.isEmpty()) customerMapper.deleteBatchIds(inactiveIds);
        return new BatchDeleteResult(inactiveIds.size(), skippedActive);
    }

    public void create(CustomerCreateDTO dto) {
        Customer customer = new Customer();
        customer.setName(dto.getName() != null ? dto.getName() : "");
        customer.setEmail(dto.getEmail());
        customer.setCompany(dto.getCompany() != null ? dto.getCompany() : "");
        customer.setPhone(dto.getPhone() != null ? dto.getPhone() : "");
        customer.setCountry(dto.getCountry() != null ? dto.getCountry() : "");
        customer.setTags(dto.getTags() != null ? dto.getTags() : "");
        customer.setNotes(dto.getNotes() != null ? dto.getNotes() : "");
        // 新建客户默认为有效
        customer.setStatus(dto.getStatus() != null ? dto.getStatus() : STATUS_ACTIVE);
        customerMapper.insert(customer);
        // v2.40 需求2：客户号由系统在落库后按主键生成，接口不接受外部传入
        assignCustomerNo(customer.getId());
    }

    public void update(Long id, CustomerUpdateDTO dto) {
        Customer customer = customerMapper.selectById(id);
        if (customer == null) return;

        if (dto.getName() != null) customer.setName(dto.getName());
        if (dto.getEmail() != null) customer.setEmail(dto.getEmail());
        if (dto.getCompany() != null) customer.setCompany(dto.getCompany());
        if (dto.getPhone() != null) customer.setPhone(dto.getPhone());
        if (dto.getCountry() != null) customer.setCountry(dto.getCountry());
        if (dto.getTags() != null) customer.setTags(dto.getTags());
        if (dto.getNotes() != null) customer.setNotes(dto.getNotes());
        if (dto.getStatus() != null) customer.setStatus(dto.getStatus());
        // v2.40 需求1：整行实体回写时 MyBatis-Plus 的 strictUpdateFill 只补空值，
        // 会把查出来的旧 updatedAt 一起 SET 回去并盖掉列上的 ON UPDATE CURRENT_TIMESTAMP，
        // 因此这里显式刷新最后修改时间。客户号不在 DTO 中，任何情况下都不会被改写。
        customer.setUpdatedAt(LocalDateTime.now());
        customerMapper.updateById(customer);
    }

    public void delete(Long id) {
        customerMapper.deleteById(id);
    }

    public BatchDeleteResult batchDelete(List<Long> ids) {
        return deleteGuarded(ids);
    }

    public void importCustomers(List<Map<String, String>> customerDataList) {
        for (Map<String, String> data : customerDataList) {
            Customer customer = new Customer();
            customer.setName(data.getOrDefault("name", "Unknown"));
            customer.setEmail(data.get("email"));
            customer.setCompany(data.getOrDefault("company", ""));
            customer.setPhone(data.getOrDefault("phone", ""));
            customer.setCountry(data.getOrDefault("country", ""));
            customer.setTags(data.getOrDefault("tags", ""));
            customer.setNotes(data.getOrDefault("notes", ""));
            // 导入的客户默认为有效
            customer.setStatus(STATUS_ACTIVE);
            customerMapper.insert(customer);
            // v2.40 需求2：导入文件即使带"客户号"列也一律忽略，编号只由系统生成
            assignCustomerNo(customer.getId());
        }
    }

    /**
     * v2.40 需求2 / v2.41 需求1：按主键生成唯一客户号（C + 5 位数字，共 6 位）。
     * <p>编号完全由自增主键推导，因此天然唯一、永不冲突；历史数据由
     * {@link com.emailsystem.config.SchemaMigrationRunner} 用同一规则（CONCAT('C', LPAD(id, 5, '0'))）回填并纠偏。
     * 只 SET customer_no，不参与业务字段更新，也不接受外部传入，故客户号生成后不可修改。
     */
    private void assignCustomerNo(Long id) {
        if (id == null) return;
        customerMapper.update(null,
                new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<Customer>()
                        .eq(Customer::getId, id)
                        .set(Customer::getCustomerNo, formatCustomerNo(id)));
    }

    /**
     * v2.41 需求1：客户号为 {@code C + 主键左补零到 5 位}（共 6 位，如 id=1591 → C01591）。
     * <p>主键超过 99999 时位数自然延长（字段为 VARCHAR(12)，可容纳到 11 位数字），规则本身不变。
     */
    public static String formatCustomerNo(Long id) {
        return "C" + String.format("%05d", id);
    }

    public List<Map<String, String>> exportAll() {
        List<Customer> customers = customerMapper.selectList(
                new LambdaQueryWrapper<Customer>().orderByAsc(Customer::getId)
        );
        return customers.stream().map(c -> {
            Map<String, String> map = new java.util.LinkedHashMap<>();
            map.put("customer_no", c.getCustomerNo() != null ? c.getCustomerNo() : "");
            map.put("name", c.getName() != null ? c.getName() : "");
            map.put("email", c.getEmail() != null ? c.getEmail() : "");
            map.put("company", c.getCompany() != null ? c.getCompany() : "");
            map.put("phone", c.getPhone() != null ? c.getPhone() : "");
            map.put("country", c.getCountry() != null ? c.getCountry() : "");
            map.put("tags", c.getTags() != null ? c.getTags() : "");
            map.put("notes", c.getNotes() != null ? c.getNotes() : "");
            map.put("status", STATUS_INACTIVE.equals(c.getStatus()) ? "失效" : "有效");
            return map;
        }).collect(Collectors.toList());
    }

    public List<Customer> selectAll() {
        return customerMapper.selectList(null);
    }

    public long count() {
        return customerMapper.selectCount(null);
    }
}
