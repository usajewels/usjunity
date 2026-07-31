package com.mxsuite.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "mxsuite.s3")
public record S3Properties(
        String bucket,
        String region,
        String accessKeyId,
        String secretAccessKey,
        String pathPrefix
) {
    public S3Properties {
        if (region == null) region = "us-east-1";
        if (pathPrefix == null) pathPrefix = "";
    }
}
