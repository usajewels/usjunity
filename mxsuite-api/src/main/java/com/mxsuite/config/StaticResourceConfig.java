package com.mxsuite.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Paths;

/**
 * Serves user-uploaded files (avatars, etc.) stored on disk at
 * {@code mxsuite.storage.local.base-path} under the {@code /uploads/**} URL path.
 * <p>
 * The path is public (permitted in SecurityConfig) so browsers can load avatars
 * without a Bearer token. Uploaded files are random UUIDs so enumeration is impractical.
 */
@Configuration
public class StaticResourceConfig implements WebMvcConfigurer {

    @Value("${mxsuite.storage.local.base-path:./data/files}")
    private String basePath;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String location = "file:" + Paths.get(basePath).toAbsolutePath() + "/";
        registry.addResourceHandler("/uploads/**")
                .addResourceLocations(location)
                .setCachePeriod(3600);
    }
}
