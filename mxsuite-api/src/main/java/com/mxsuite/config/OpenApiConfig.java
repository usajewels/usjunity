package com.mxsuite.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * OpenAPI / Swagger UI configuration.
 * <p>
 * The Swagger UI is available at /swagger-ui/index.html and is restricted
 * to PLATFORM_ADMIN and PLATFORM_SUPPORT users via SecurityConfig.
 * No customer should ever see this.
 *
 * @author Joseph M. Vogel
 */
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI mxSuiteOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("MXSuite Platform API")
                        .description("Data Onboarding & Integration Platform for GrowthZone MemberSuite. "
                                + "This API documentation is restricted to platform administrators only.")
                        .version("0.3.0")
                        .contact(new Contact()
                                .name("Joseph M. Vogel")
                                .email("jvogel@mxsuite.com")))
                .addSecurityItem(new SecurityRequirement().addList("Bearer JWT"))
                .components(new Components()
                        .addSecuritySchemes("Bearer JWT", new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("JWT token obtained from POST /api/auth/login")));
    }
}
