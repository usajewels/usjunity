package com.mxsuite.config;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.Gauge;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

@Configuration
public class MetricsConfig {

    private final AtomicInteger activeWebSocketConnections = new AtomicInteger(0);
    private final AtomicInteger activePlanRuns = new AtomicInteger(0);
    private final AtomicLong totalRecordsProcessed = new AtomicLong(0);

    @Bean
    public Counter planRunsStartedCounter(MeterRegistry registry) {
        return Counter.builder("mxsuite.plan.runs.started")
                .description("Total plan runs started")
                .tag("application", "mxsuite-api")
                .register(registry);
    }

    @Bean
    public Counter planRunsCompletedCounter(MeterRegistry registry) {
        return Counter.builder("mxsuite.plan.runs.completed")
                .description("Total plan runs completed successfully")
                .tag("application", "mxsuite-api")
                .register(registry);
    }

    @Bean
    public Counter planRunsFailedCounter(MeterRegistry registry) {
        return Counter.builder("mxsuite.plan.runs.failed")
                .description("Total plan runs failed")
                .tag("application", "mxsuite-api")
                .register(registry);
    }

    @Bean
    public Timer planRunDurationTimer(MeterRegistry registry) {
        return Timer.builder("mxsuite.plan.runs.duration")
                .description("Plan run execution duration")
                .publishPercentiles(0.5, 0.75, 0.95, 0.99)
                .register(registry);
    }

    @Bean
    public Counter recordsProcessedCounter(MeterRegistry registry) {
        return Counter.builder("mxsuite.plan.records.processed")
                .description("Total records processed across all runs")
                .tag("application", "mxsuite-api")
                .register(registry);
    }

    @Bean
    public Counter recordsFailedCounter(MeterRegistry registry) {
        return Counter.builder("mxsuite.plan.records.failed")
                .description("Total records that failed processing")
                .tag("application", "mxsuite-api")
                .register(registry);
    }

    @Bean
    public Counter fileUploadsCounter(MeterRegistry registry) {
        return Counter.builder("mxsuite.files.uploads")
                .description("Total file uploads")
                .tag("application", "mxsuite-api")
                .register(registry);
    }

    @Bean
    public Counter auditEventsCounter(MeterRegistry registry) {
        return Counter.builder("mxsuite.audit.events")
                .description("Total audit events recorded")
                .tag("application", "mxsuite-api")
                .register(registry);
    }

    @Bean
    public AtomicInteger activeWebSocketConnectionsGauge(MeterRegistry registry) {
        Gauge.builder("mxsuite.websocket.connections.active", activeWebSocketConnections, AtomicInteger::get)
                .description("Currently active WebSocket connections")
                .register(registry);
        return activeWebSocketConnections;
    }

    @Bean
    public AtomicInteger activePlanRunsGauge(MeterRegistry registry) {
        Gauge.builder("mxsuite.plan.runs.active", activePlanRuns, AtomicInteger::get)
                .description("Currently active plan runs")
                .register(registry);
        return activePlanRuns;
    }
}
