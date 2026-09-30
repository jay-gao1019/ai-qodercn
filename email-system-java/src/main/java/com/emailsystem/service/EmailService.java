package com.emailsystem.service;

import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);
    private static final Pattern VAR_PATTERN = Pattern.compile("\\$\\{(\\w+)}");

    public SendResult sendSingleEmail(String host, int port, String username, String password,
                                       boolean useSsl, boolean useTls,
                                       String toEmail, String subject, String body) {
        try {
            JavaMailSenderImpl sender = new JavaMailSenderImpl();
            sender.setHost(host);
            sender.setPort(port);
            sender.setUsername(username);
            sender.setPassword(password);
            sender.setDefaultEncoding("UTF-8");

            Properties props = sender.getJavaMailProperties();
            if (useSsl) {
                props.put("mail.transport.protocol", "smtps");
                props.put("mail.smtp.ssl.enable", "true");
                props.put("mail.smtps.ssl.checkserveridentity", "false");
                props.put("mail.smtps.ssl.trust", "*");
            } else {
                props.put("mail.transport.protocol", "smtp");
                if (useTls) {
                    props.put("mail.smtp.starttls.enable", "true");
                }
            }
            props.put("mail.smtp.auth", "true");
            props.put("mail.smtp.connectiontimeout", "30000");
            props.put("mail.smtp.timeout", "30000");

            log.debug("[SMTP Debug] Connecting to {}:{} (SSL={}, TLS={})", host, port, useSsl, useTls);

            MimeMessage message = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(username);
            helper.setTo(toEmail);
            helper.setSubject(subject);
            helper.setText(body, true);

            log.debug("[SMTP Debug] Logging in as {}", username);
            log.debug("[SMTP Debug] Sending email to {}", toEmail);

            sender.send(message);

            log.debug("[SMTP Debug] Email sent successfully");
            return new SendResult(true, "");

        } catch (MailAuthenticationException e) {
            // Spring 的 JavaMailSenderImpl 会把 jakarta.mail.AuthenticationFailedException
            // 包装为 MailAuthenticationException 抛出，因此必须在此捕获
            String detail = rootCauseMessage(e);
            String error = "SMTP 认证失败：用户名或密码不正确"
                    + (detail.isEmpty() ? "" : "（服务器响应：" + detail + "）")
                    + "。提示：QQ/163 等邮箱需填写「授权码」，企业邮箱可能需「客户端专用密码」，而非邮箱登录密码。";
            log.error("[SMTP Error] {} | host={} port={} user={}", error, host, port, username);
            return new SendResult(false, error);
        } catch (jakarta.mail.AuthenticationFailedException e) {
            String error = "SMTP 认证失败：" + e.getMessage()
                    + "。提示：请确认使用的是授权码/客户端专用密码，而非邮箱登录密码。";
            log.error("[SMTP Error] {} | user={}", error, username);
            return new SendResult(false, error);
        } catch (MailSendException e) {
            String detail = rootCauseMessage(e);
            String error = "SMTP 发送失败：" + (detail.isEmpty() ? e.getMessage() : detail);
            log.error("[SMTP Error] {} | host={} port={} ssl={} tls={}", error, host, port, useSsl, useTls);
            return new SendResult(false, error);
        } catch (jakarta.mail.SendFailedException e) {
            String error = "收件人被拒绝：" + e.getMessage();
            log.error("[SMTP Error] {}", error);
            return new SendResult(false, error);
        } catch (jakarta.mail.MessagingException e) {
            String error = "SMTP 连接失败：" + e.getMessage();
            log.error("[SMTP Error] {} | host={} port={}", error, host, port);
            return new SendResult(false, error);
        } catch (Exception e) {
            String error = "发送失败：" + e.getClass().getSimpleName() + ": " + e.getMessage();
            log.error("[SMTP Error] {}", error);
            return new SendResult(false, error);
        }
    }

    /**
     * 提取异常链最底层的消息。
     * Spring 的邮件异常通常只保留一句概括性描述（如 "Authentication failed"），
     * 真正来自 SMTP 服务器的应答（如 "526 Authentication failure[0]"）在其 cause 中。
     */
    private String rootCauseMessage(Throwable e) {
        Throwable cur = e;
        String last = "";
        int guard = 0;
        while (cur != null && guard++ < 10) {
            if (cur.getMessage() != null && !cur.getMessage().isBlank()) {
                last = cur.getMessage().trim();
            }
            if (cur.getCause() == null || cur.getCause() == cur) break;
            cur = cur.getCause();
        }
        return last;
    }

    public String replaceTemplateVars(String text, java.util.Map<String, String> vars) {
        if (text == null) return "";
        Matcher matcher = VAR_PATTERN.matcher(text);
        StringBuilder sb = new StringBuilder();
        while (matcher.find()) {
            String varName = matcher.group(1);
            String replacement = vars.getOrDefault(varName, "");
            matcher.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    public record SendResult(boolean success, String error) {}
}
