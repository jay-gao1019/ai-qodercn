package com.emailsystem.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * 发送任务的线程池（v2.35 需求3.5：支持多个任务并行同步发送）。
 * <p>一个任务从点"发送"到发完会独占一个线程（每封之间按 interval 睡眠），
 * 因此并行任务数 = 线程数。{@code queue-capacity=0} 使用 SynchronousQueue，
 * 让 max-size 成为真正的并行上限；一旦有队列，超出的任务会静默排队，界面表现为"点了发送却不动"。
 * <p>拒绝策略必须是 Abort：CallerRuns 会把整个发送循环跑在 HTTP 请求线程上，请求会被挂住几十分钟。
 */
@Configuration
public class AsyncConfig {

    @Value("${email.task.pool.core-size:10}")
    private int coreSize;

    @Value("${email.task.pool.max-size:30}")
    private int maxSize;

    @Value("${email.task.pool.queue-capacity:0}")
    private int queueCapacity;

    @Bean("campaignTaskExecutor")
    public Executor campaignTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(coreSize);
        executor.setMaxPoolSize(maxSize);
        executor.setQueueCapacity(queueCapacity);
        executor.setThreadNamePrefix("campaign-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.AbortPolicy());
        executor.initialize();
        return executor;
    }
}
