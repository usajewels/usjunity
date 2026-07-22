package com.mxsuite.security;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

@Component
public class JwtTokenProvider {

    private static final Logger log = LoggerFactory.getLogger(JwtTokenProvider.class);

    private final SecretKey key;
    private final long expirationMs;

    public JwtTokenProvider(
            @Value("${mxsuite.security.jwt.secret:#{null}}") String secret,
            @Value("${mxsuite.security.jwt.expiration-ms}") long expirationMs) {
        if (secret == null || secret.isBlank()) {
            log.warn("JWT secret is not set — JWT operations will fail until configured");
            // Use a throwaway key so the bean can be constructed; SecurityConfigValidator
            // will block startup in non-dev profiles before any request is served.
            this.key = Keys.hmacShaKeyFor(
                    "temporary-startup-key-will-be-rejected-by-validator-00".getBytes(StandardCharsets.UTF_8));
        } else {
            this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        }
        this.expirationMs = expirationMs;
    }

    public String generateToken(UserPrincipal principal) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + expirationMs);

        return Jwts.builder()
                .subject(principal.id().toString())
                .claim("email", principal.email())
                .claim("role", principal.role().name())
                .claim("tenantId", principal.tenantId().toString())
                .claim("name", principal.getFullName())
                .issuedAt(now)
                .expiration(expiry)
                .signWith(key)
                .compact();
    }

    public UUID getUserIdFromToken(String token) {
        Claims claims = parseToken(token);
        return UUID.fromString(claims.getSubject());
    }

    public UUID getTenantIdFromToken(String token) {
        Claims claims = parseToken(token);
        return UUID.fromString(claims.get("tenantId", String.class));
    }

    public String getRoleFromToken(String token) {
        Claims claims = parseToken(token);
        return claims.get("role", String.class);
    }

    public boolean validateToken(String token) {
        try {
            parseToken(token);
            return true;
        } catch (ExpiredJwtException e) {
            log.debug("JWT token expired");
        } catch (MalformedJwtException e) {
            log.warn("Malformed JWT token");
        } catch (UnsupportedJwtException e) {
            log.warn("Unsupported JWT token");
        } catch (IllegalArgumentException e) {
            log.warn("Empty or null JWT token");
        } catch (JwtException e) {
            log.warn("Invalid JWT token: {}", e.getMessage());
        }
        return false;
    }

    private Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }
}
