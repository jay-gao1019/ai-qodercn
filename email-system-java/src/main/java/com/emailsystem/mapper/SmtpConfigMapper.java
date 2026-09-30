package com.emailsystem.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.emailsystem.entity.SmtpConfig;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface SmtpConfigMapper extends BaseMapper<SmtpConfig> {
}
