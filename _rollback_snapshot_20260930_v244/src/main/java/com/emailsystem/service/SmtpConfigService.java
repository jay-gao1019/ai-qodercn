package com.emailsystem.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.emailsystem.dto.request.SmtpConfigCreateDTO;
import com.emailsystem.dto.request.SmtpConfigUpdateDTO;
import com.emailsystem.entity.SmtpConfig;
import com.emailsystem.mapper.SmtpConfigMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class SmtpConfigService {

    private final SmtpConfigMapper smtpConfigMapper;

    public List<SmtpConfig> listAll() {
        return smtpConfigMapper.selectList(
                new LambdaQueryWrapper<SmtpConfig>()
                        .orderByDesc(SmtpConfig::getIsDefault)
                        .orderByDesc(SmtpConfig::getId)
        );
    }

    public void create(SmtpConfigCreateDTO dto) {
        if (Boolean.TRUE.equals(dto.getIsDefault())) {
            clearAllDefaults();
        }
        SmtpConfig config = new SmtpConfig();
        config.setName(dto.getName());
        config.setHost(dto.getHost());
        config.setPort(dto.getPort());
        config.setUsername(dto.getUsername());
        config.setPassword(dto.getPassword());
        config.setUseSsl(dto.getUseSsl());
        config.setUseTls(dto.getUseTls());
        config.setIsDefault(dto.getIsDefault());
        smtpConfigMapper.insert(config);
    }

    public void update(Long id, SmtpConfigUpdateDTO dto) {
        SmtpConfig config = smtpConfigMapper.selectById(id);
        if (config == null) return;

        if (Boolean.TRUE.equals(dto.getIsDefault())) {
            clearAllDefaultsExcept(id);
        }

        if (dto.getName() != null) config.setName(dto.getName());
        if (dto.getHost() != null) config.setHost(dto.getHost());
        if (dto.getPort() != null) config.setPort(dto.getPort());
        if (dto.getUsername() != null) config.setUsername(dto.getUsername());
        if (dto.getPassword() != null) config.setPassword(dto.getPassword());
        if (dto.getUseSsl() != null) config.setUseSsl(dto.getUseSsl());
        if (dto.getUseTls() != null) config.setUseTls(dto.getUseTls());
        if (dto.getIsDefault() != null) config.setIsDefault(dto.getIsDefault());
        smtpConfigMapper.updateById(config);
    }

    public void delete(Long id) {
        smtpConfigMapper.deleteById(id);
    }

    public SmtpConfig getById(Long id) {
        return smtpConfigMapper.selectById(id);
    }

    private void clearAllDefaults() {
        SmtpConfig update = new SmtpConfig();
        update.setIsDefault(false);
        smtpConfigMapper.update(update, new LambdaQueryWrapper<SmtpConfig>().eq(SmtpConfig::getIsDefault, true));
    }

    private void clearAllDefaultsExcept(Long excludeId) {
        SmtpConfig update = new SmtpConfig();
        update.setIsDefault(false);
        smtpConfigMapper.update(update,
                new LambdaQueryWrapper<SmtpConfig>()
                        .eq(SmtpConfig::getIsDefault, true)
                        .ne(SmtpConfig::getId, excludeId)
        );
    }
}
