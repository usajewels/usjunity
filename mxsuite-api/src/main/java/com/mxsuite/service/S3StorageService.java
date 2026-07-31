package com.mxsuite.service;

import com.mxsuite.config.S3Properties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import jakarta.annotation.PostConstruct;
import java.net.URL;
import java.nio.file.Path;
import java.time.Duration;

/**
 * Manages file uploads and downloads from Amazon S3.
 */
@Service
@ConditionalOnExpression("'${mxsuite.s3.bucket:}' != ''")
public class S3StorageService {

    private static final Logger log = LoggerFactory.getLogger(S3StorageService.class);

    private final S3Properties properties;
    private S3Client s3Client;
    private S3Presigner presigner;

    public S3StorageService(S3Properties properties) {
        this.properties = properties;
    }

    @PostConstruct
    public void init() {
        if (properties.bucket() == null || properties.bucket().isBlank()) {
            log.info("S3 bucket not configured — S3 storage disabled");
            return;
        }

        Region region = Region.of(properties.region());

        if (properties.accessKeyId() != null && !properties.accessKeyId().isBlank()) {
            var creds = StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(properties.accessKeyId(), properties.secretAccessKey()));
            s3Client = S3Client.builder().region(region).credentialsProvider(creds).build();
            presigner = S3Presigner.builder().region(region).credentialsProvider(creds).build();
        } else {
            // Use default credential chain (IAM role, env vars, etc.)
            s3Client = S3Client.builder().region(region)
                    .credentialsProvider(DefaultCredentialsProvider.create()).build();
            presigner = S3Presigner.builder().region(region)
                    .credentialsProvider(DefaultCredentialsProvider.create()).build();
        }

        log.info("S3 storage initialized: bucket={}, region={}", properties.bucket(), properties.region());
    }

    /** Check if S3 is configured and ready. */
    public boolean isEnabled() {
        return s3Client != null;
    }

    /** Upload a local file to S3. Returns the full S3 key. */
    public String upload(Path localFile, String s3Key) {
        if (!isEnabled()) throw new IllegalStateException("S3 not configured");

        String fullKey = prefixedKey(s3Key);

        s3Client.putObject(
                PutObjectRequest.builder()
                        .bucket(properties.bucket())
                        .key(fullKey)
                        .build(),
                localFile);

        log.info("Uploaded {} to s3://{}/{}", localFile.getFileName(), properties.bucket(), fullKey);
        return fullKey;
    }

    /** Delete an object from S3. */
    public void delete(String s3Key) {
        if (!isEnabled()) return;

        s3Client.deleteObject(
                DeleteObjectRequest.builder()
                        .bucket(properties.bucket())
                        .key(prefixedKey(s3Key))
                        .build());

        log.info("Deleted s3://{}/{}", properties.bucket(), s3Key);
    }

    /** Get a pre-signed download URL valid for the given duration. */
    public URL getPresignedUrl(String s3Key, Duration expiration) {
        if (!isEnabled()) throw new IllegalStateException("S3 not configured");

        return presigner.presignGetObject(
                GetObjectPresignRequest.builder()
                        .signatureDuration(expiration)
                        .getObjectRequest(b -> b.bucket(properties.bucket()).key(prefixedKey(s3Key)))
                        .build()
        ).url();
    }

    private String prefixedKey(String key) {
        String prefix = properties.pathPrefix();
        if (prefix != null && !prefix.isBlank()) {
            return prefix.endsWith("/") ? prefix + key : prefix + "/" + key;
        }
        return key;
    }
}
