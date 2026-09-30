package com.emailsystem.task;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;

@Component
public class CampaignTaskManager {

    private static final Logger log = LoggerFactory.getLogger(CampaignTaskManager.class);

    private final ConcurrentHashMap<Long, Future<?>> runningTasks = new ConcurrentHashMap<>();

    public void registerTask(Long campaignId, Future<?> future) {
        runningTasks.put(campaignId, future);
        log.info("Campaign {} registered, running tasks: {}", campaignId, runningTasks.size());
    }

    public void removeTask(Long campaignId) {
        runningTasks.remove(campaignId);
        log.info("Campaign {} removed, running tasks: {}", campaignId, runningTasks.size());
    }

    public boolean cancelTask(Long campaignId) {
        Future<?> future = runningTasks.get(campaignId);
        if (future != null) {
            boolean cancelled = future.cancel(true);
            runningTasks.remove(campaignId);
            return cancelled;
        }
        return false;
    }

    public boolean isRunning(Long campaignId) {
        Future<?> future = runningTasks.get(campaignId);
        return future != null && !future.isDone() && !future.isCancelled();
    }

    /** 当前仍在发送中的任务数，供并行上限预检（v2.35 需求3.5） */
    public int runningCount() {
        return (int) runningTasks.values().stream()
                .filter(f -> !f.isDone() && !f.isCancelled())
                .count();
    }
}
