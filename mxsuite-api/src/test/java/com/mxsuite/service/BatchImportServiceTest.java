package com.mxsuite.service;

import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.ProjectDataUploadRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link BatchImportService} — pure Mockito, no SQL Server, no Spring context.
 *
 * Tests focus on the transformation logic that was previously a TODO:
 * - {@code buildTransformPlan} — mapping resolution
 * - {@code applyCoercion} — type normalization
 * - {@code transformRow} — end-to-end row transformation
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("BatchImportService")
class BatchImportServiceTest {

    @Mock ProjectDataUploadRepository  uploadRepository;
    @Mock FieldMappingEntryRepository  mappingRepository;
    @Mock TargetSchemaService          targetSchemaService;
    @Mock SimpMessagingTemplate        messagingTemplate;

    @InjectMocks BatchImportService service;

    // =========================================================================
    // buildTransformPlan
    // =========================================================================

    @Nested
    @DisplayName("buildTransformPlan")
    class BuildTransformPlan {

        @BeforeEach
        void stubSchema() {
            when(targetSchemaService.getFlatFields()).thenReturn(List.of(
                    Map.of("entity", "Contact", "name", "email",       "type", "string"),
                    Map.of("entity", "Contact", "name", "firstName",   "type", "string"),
                    Map.of("entity", "Contact", "name", "joinDate",    "type", "date"),
                    Map.of("entity", "Contact", "name", "memberCount", "type", "number"),
                    Map.of("entity", "Contact", "name", "active",      "type", "boolean")
            ));
        }

        @Test
        @DisplayName("excludes NEEDS_REVIEW and UNMAPPED entries")
        void ignoresNonMappedEntries() {
            FieldMappingEntry mapped      = mapping("Email", "Contact", "email",     MappingStatus.MAPPED);
            FieldMappingEntry needsReview = mapping("Phone", "Contact", "phone",     MappingStatus.NEEDS_REVIEW);
            FieldMappingEntry unmapped    = mapping("Notes", "Contact", "notes",     MappingStatus.UNMAPPED);

            List<BatchImportService.TransformRule> plan = service.buildTransformPlan(
                    List.of("Email", "Phone", "Notes"),
                    List.of(mapped, needsReview, unmapped)
            );

            assertThat(plan).hasSize(1);
            assertThat(plan.get(0).targetField()).isEqualTo("email");
        }

        @Test
        @DisplayName("resolves targetType from schema service")
        void resolvesTargetType() {
            FieldMappingEntry m = mapping("JoinDate", "Contact", "joinDate", MappingStatus.MAPPED);

            List<BatchImportService.TransformRule> plan = service.buildTransformPlan(
                    List.of("JoinDate"), List.of(m));

            assertThat(plan).hasSize(1);
            assertThat(plan.get(0).targetType()).isEqualTo("date");
        }

        @Test
        @DisplayName("skips source fields not present in CSV headers")
        void skipsUnknownSourceFields() {
            FieldMappingEntry m = mapping("NonExistentColumn", "Contact", "email", MappingStatus.MAPPED);

            List<BatchImportService.TransformRule> plan = service.buildTransformPlan(
                    List.of("Email", "Name"), List.of(m));

            assertThat(plan).isEmpty();
        }

        @Test
        @DisplayName("header matching is case-insensitive")
        void headerMatchIsCaseInsensitive() {
            FieldMappingEntry m = mapping("email address", "Contact", "email", MappingStatus.MAPPED);

            List<BatchImportService.TransformRule> plan = service.buildTransformPlan(
                    List.of("Email Address"), List.of(m));

            assertThat(plan).hasSize(1);
            assertThat(plan.get(0).sourceColIdx()).isEqualTo(0);
        }
    }

    // =========================================================================
    // applyCoercion
    // =========================================================================

    @Nested
    @DisplayName("applyCoercion")
    class ApplyCoercion {

        @Test
        @DisplayName("returns null for blank input")
        void returnsNullForBlank() {
            assertThat(service.applyCoercion("",  "string", null)).isNull();
            assertThat(service.applyCoercion("  ", "string", null)).isNull();
        }

        @Test
        @DisplayName("normalizes date 7/4/2025 to ISO 2025-07-04")
        void normalizesDateToIso() {
            assertThat(service.applyCoercion("7/4/2025", "date", null)).isEqualTo("2025-07-04");
        }

        @Test
        @DisplayName("normalizes date MM/dd/yyyy format")
        void normalizesDateMmDdYyyy() {
            assertThat(service.applyCoercion("12/31/2024", "date", null)).isEqualTo("2024-12-31");
        }

        @Test
        @DisplayName("strips currency symbols and commas from numbers")
        void stripsNumberSymbols() {
            assertThat(service.applyCoercion("$1,234.56", "number", null)).isEqualTo("1234.56");
        }

        @Test
        @DisplayName("passes through plain numeric strings unchanged")
        void passesPlainNumbers() {
            assertThat(service.applyCoercion("42", "number", null)).isEqualTo("42");
        }

        @Test
        @DisplayName("normalizes boolean yes/true/1 to '1'")
        void normalizesBoolean_trueValues() {
            assertThat(service.applyCoercion("Yes",   "boolean", null)).isEqualTo("1");
            assertThat(service.applyCoercion("true",  "boolean", null)).isEqualTo("1");
            assertThat(service.applyCoercion("1",     "boolean", null)).isEqualTo("1");
            assertThat(service.applyCoercion("Y",     "boolean", null)).isEqualTo("1");
        }

        @Test
        @DisplayName("normalizes boolean no/false/0 to '0'")
        void normalizesBoolean_falseValues() {
            assertThat(service.applyCoercion("No",    "boolean", null)).isEqualTo("0");
            assertThat(service.applyCoercion("false", "boolean", null)).isEqualTo("0");
            assertThat(service.applyCoercion("0",     "boolean", null)).isEqualTo("0");
        }

        @Test
        @DisplayName("named coercion 'uppercase' overrides type-based logic")
        void namedCoercion_uppercase() {
            assertThat(service.applyCoercion("hello", "string", "uppercase")).isEqualTo("HELLO");
        }

        @Test
        @DisplayName("named coercion 'phone_digits_only' strips non-digits")
        void namedCoercion_phoneDigitsOnly() {
            assertThat(service.applyCoercion("(303) 555-1234", "string", "phone_digits_only"))
                    .isEqualTo("3035551234");
        }

        @Test
        @DisplayName("trims whitespace from string values")
        void trimsStringValues() {
            assertThat(service.applyCoercion("  Alice  ", "string", null)).isEqualTo("Alice");
        }
    }

    // =========================================================================
    // transformRow
    // =========================================================================

    @Nested
    @DisplayName("transformRow")
    class TransformRowTests {

        @Test
        @DisplayName("maps source columns to target entities and fields")
        void mapsColumnsToTargetEntities() {
            List<BatchImportService.TransformRule> plan = List.of(
                    new BatchImportService.TransformRule(0, "Email",     "Contact", "email",       "string", null),
                    new BatchImportService.TransformRule(1, "JoinDate",  "Contact", "joinDate",    "date",   null),
                    new BatchImportService.TransformRule(2, "MemberCnt", "Contact", "memberCount", "number", null)
            );
            String[] values = { "alice@example.com", "7/4/2025", "$5" };

            Map<String, Map<String, Object>> result = service.transformRow(values, plan, 1);

            assertThat(result).containsKey("Contact");
            Map<String, Object> contact = result.get("Contact");
            assertThat(contact.get("email")).isEqualTo("alice@example.com");
            assertThat(contact.get("joinDate")).isEqualTo("2025-07-04");
            assertThat(contact.get("memberCount")).isEqualTo("5");
        }

        @Test
        @DisplayName("skips blank values — they are not included in the output")
        void skipsBlankValues() {
            List<BatchImportService.TransformRule> plan = List.of(
                    new BatchImportService.TransformRule(0, "Email", "Contact", "email", "string", null),
                    new BatchImportService.TransformRule(1, "Phone", "Contact", "phone", "string", null)
            );
            String[] values = { "alice@example.com", "" }; // phone blank

            Map<String, Map<String, Object>> result = service.transformRow(values, plan, 1);

            assertThat(result.get("Contact")).doesNotContainKey("phone");
            assertThat(result.get("Contact")).containsKey("email");
        }

        @Test
        @DisplayName("adds _mx_source_row to each entity row for traceability")
        void tagsWithSourceRow() {
            List<BatchImportService.TransformRule> plan = List.of(
                    new BatchImportService.TransformRule(0, "Email", "Contact", "email", "string", null)
            );
            String[] values = { "bob@example.com" };

            Map<String, Map<String, Object>> result = service.transformRow(values, plan, 42);

            assertThat(result.get("Contact").get("_mx_source_row")).isEqualTo(42);
        }

        @Test
        @DisplayName("groups rules across multiple target entities")
        void groupsMultipleEntities() {
            List<BatchImportService.TransformRule> plan = List.of(
                    new BatchImportService.TransformRule(0, "Email",   "Contact",      "email",   "string", null),
                    new BatchImportService.TransformRule(1, "OrgName", "Organization", "orgName", "string", null)
            );
            String[] values = { "alice@example.com", "Denver Chamber" };

            Map<String, Map<String, Object>> result = service.transformRow(values, plan, 1);

            assertThat(result).containsKeys("Contact", "Organization");
            assertThat(result.get("Organization").get("orgName")).isEqualTo("Denver Chamber");
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private FieldMappingEntry mapping(String sourceField, String targetEntity,
                                       String targetField, MappingStatus status) {
        FieldMappingEntry m = new FieldMappingEntry();
        m.setSourceField(sourceField);
        m.setTargetEntity(targetEntity);
        m.setTargetField(targetField);
        m.setMappingStatus(status);
        return m;
    }
}
