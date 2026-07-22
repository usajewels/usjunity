package com.mxsuite;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
import org.springframework.data.web.config.EnableSpringDataWebSupport;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * MXSuite Platform — Data Onboarding &amp; Integration Platform.
 * <p>
 * Multi-tenant data onboarding platform for GrowthZone MemberSuite.
 * Provides file upload, field mapping, ELT plan execution, and full audit trails.
 *
 * @author Joseph M. Vogel
 */
@SpringBootApplication
@EnableJpaAuditing
@EnableAsync
@EnableSpringDataWebSupport(pageSerializationMode = EnableSpringDataWebSupport.PageSerializationMode.VIA_DTO)
public class MxSuiteApplication {

    public static void main(String[] args) {
        SpringApplication.run(MxSuiteApplication.class, args);
    }
}
