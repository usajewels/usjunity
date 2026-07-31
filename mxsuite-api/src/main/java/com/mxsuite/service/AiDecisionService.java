package com.mxsuite.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mxsuite.model.FieldMappingEntry;
import com.mxsuite.model.SemanticDecision;
import com.mxsuite.model.ValidationRun;
import com.mxsuite.model.enums.DecisionSource;
import com.mxsuite.model.enums.DecisionStatus;
import com.mxsuite.model.enums.MappingStatus;
import com.mxsuite.repository.FieldMappingEntryRepository;
import com.mxsuite.repository.SemanticDecisionRepository;
import com.mxsuite.repository.ValidationIssueRepository;
import com.mxsuite.service.ai.AiProviderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * Uses an AI provider to auto-generate SemanticDecision records from validation results.
 * Triggered after each validation run completes. Non-fatal — failures are logged and skipped.
 */
@Service
public class AiDecisionService {

    private static final Logger log = LoggerFactory.getLogger(AiDecisionService.class);
    private static final String TASK = "decisions";
    private static final int MAX_TOKENS = 8192;
    private static final int MAX_DECISIONS = 8;

    private final AiProviderService aiProviderService;
    private final ObjectMapper objectMapper;
    private final SemanticDecisionRepository decisionRepository;
    private final ValidationIssueRepository issueRepository;
    private final FieldMappingEntryRepository mappingRepository;

    public AiDecisionService(AiProviderService aiProviderService,
                              ObjectMapper objectMapper,
                              SemanticDecisionRepository decisionRepository,
                              ValidationIssueRepository issueRepository,
                              FieldMappingEntryRepository mappingRepository) {
        this.aiProviderService = aiProviderService;
        this.objectMapper = objectMapper;
        this.decisionRepository = decisionRepository;
        this.issueRepository = issueRepository;
        this.mappingRepository = mappingRepository;
    }

    public boolean isAvailable() {
        return aiProviderService.isAvailable(TASK);
    }

    /**
     * Generate decisions from a completed validation run.
     * Idempotent: deletes existing OPEN AI decisions before regenerating.
     */
    @Transactional
    public List<SemanticDecision> generateDecisions(ValidationRun run) {
        UUID projectId = run.getProject().getId();

        if (!isAvailable()) {
            log.info("AI decisions task not available, skipping for project={}", projectId);
            return List.of();
        }

        // Idempotency: delete existing OPEN AI decisions for re-generation
        int deleted = decisionRepository.deleteByProjectIdAndSourceAndDecisionStatus(
                projectId, DecisionSource.AI, DecisionStatus.OPEN);
        if (deleted > 0) {
            log.info("Deleted {} stale OPEN AI decisions for project={}", deleted, projectId);
        }

        // Gather context
        ValidationContext ctx = buildValidationContext(run);

        if (ctx.isEmpty()) {
            log.info("No validation issues or unmapped fields — skipping decision generation for project={}", projectId);
            return List.of();
        }

        String systemPrompt = buildSystemPrompt();
        String userPrompt = buildUserPrompt(ctx);

        try {
            String response = aiProviderService.chat(TASK, systemPrompt, userPrompt, MAX_TOKENS);
            List<SemanticDecision> decisions = parseResponse(response, run);

            if (!decisions.isEmpty()) {
                decisions = decisionRepository.saveAll(decisions);
                log.info("Generated {} AI decisions for project={}", decisions.size(), projectId);
            }

            return decisions;
        } catch (Exception e) {
            log.warn("AI decision generation failed for project={}: {}", projectId, e.getMessage());
            return List.of();
        }
    }

    // ---- Context gathering ----

    record IssueSummary(String ruleCode, String targetEntity, String targetField,
                        String sourceColumn, long count, String sampleMessage) {}

    record UnmappedField(String sourceField, String sampleValue) {}

    record MappingInfo(String sourceField, String targetEntity, String targetField) {}

    record ValidationContext(
            int totalRows, int errorRows, int warningRows,
            List<IssueSummary> issueSummaries,
            List<UnmappedField> unmappedSourceFields,
            List<MappingInfo> mappings
    ) {
        boolean isEmpty() {
            return issueSummaries.isEmpty() && unmappedSourceFields.isEmpty();
        }
    }

    private ValidationContext buildValidationContext(ValidationRun run) {
        UUID projectId = run.getProject().getId();

        // Aggregated issue summaries
        List<Object[]> rawIssues = issueRepository.summarizeByRuleEntityField(run.getId());
        List<IssueSummary> issueSummaries = new ArrayList<>();
        for (Object[] row : rawIssues) {
            issueSummaries.add(new IssueSummary(
                    row[0] != null ? row[0].toString() : "UNKNOWN",
                    row[1] != null ? row[1].toString() : null,
                    row[2] != null ? row[2].toString() : null,
                    row[3] != null ? row[3].toString() : null,
                    row[4] != null ? ((Number) row[4]).longValue() : 0,
                    row[5] != null ? row[5].toString() : null
            ));
        }

        // Field mappings — separate into mapped and unmapped
        List<FieldMappingEntry> allMappings = mappingRepository.findAllByProjectId(projectId);
        List<MappingInfo> mappedFields = new ArrayList<>();
        List<UnmappedField> unmappedFields = new ArrayList<>();

        for (FieldMappingEntry m : allMappings) {
            if (m.getMappingStatus() == MappingStatus.MAPPED && m.getTargetEntity() != null) {
                mappedFields.add(new MappingInfo(m.getSourceField(), m.getTargetEntity(), m.getTargetField()));
            } else if (m.getMappingStatus() == MappingStatus.UNMAPPED
                    || (m.getMappingStatus() == MappingStatus.NEEDS_REVIEW && m.getTargetEntity() == null)) {
                unmappedFields.add(new UnmappedField(m.getSourceField(),
                        truncate(m.getSampleValue(), 80)));
            }
        }

        return new ValidationContext(
                run.getTotalRows(), run.getErrorRows(), run.getWarningRows(),
                issueSummaries, unmappedFields, mappedFields);
    }

    // ---- Prompt building ----

    private String buildSystemPrompt() {
        return """
                You are a data migration expert analyzing validation results for a membership management \
                system migration. Your job is to generate actionable decision items that require human judgment.

                For each issue pattern you identify, create a decision with:
                - A clear, concise title (max 100 chars)
                - A summary explaining the issue and its impact on the migration
                - 2-4 options for resolving it, with one marked as recommended
                - The fieldContext linking it to the relevant source/target field

                OUTPUT FORMAT: Respond ONLY with a JSON array. No markdown, no explanation.
                Each element:
                {
                  "title": "...",
                  "summary": "...",
                  "fieldContext": "targetEntity.targetField or sourceField name",
                  "options": [
                    {"label": "Option A", "description": "...", "isRecommended": true},
                    {"label": "Option B", "description": "...", "isRecommended": false}
                  ],
                  "requirements": [
                    {"description": "What must be true for this decision to be valid"}
                  ]
                }

                RULES:
                - Generate 1-8 decisions total, focused on the most impactful issues
                - Do NOT create a decision for every single issue — group related issues
                - Prioritize: duplicates > unmapped required fields > type mismatches > format issues
                - Each option should be a genuinely viable path, not just "fix it" vs "ignore it"
                - The recommended option should be the safest/most common approach
                - For duplicate issues: options like merge records, keep first occurrence, keep latest, flag for manual review
                - For unmapped required fields: provide a default value, map to an existing source field, mark as optional override
                - For type mismatches: coerce with best-guess parsing, strip invalid characters, set to null
                - For format issues (email/phone): auto-correct common patterns, keep as-is with warning, set to null
                - Keep summaries practical and jargon-free — the reader is a non-technical association staff member
                """;
    }

    private String buildUserPrompt(ValidationContext ctx) {
        StringBuilder sb = new StringBuilder();

        sb.append("PROJECT VALIDATION RESULTS:\n");
        sb.append("- Total rows: ").append(ctx.totalRows).append("\n");
        sb.append("- Rows with errors: ").append(ctx.errorRows).append("\n");
        sb.append("- Rows with warnings: ").append(ctx.warningRows).append("\n\n");

        if (!ctx.issueSummaries.isEmpty()) {
            sb.append("VALIDATION ISSUES (grouped by rule and field):\n");
            for (IssueSummary issue : ctx.issueSummaries) {
                sb.append("  - ").append(issue.ruleCode);
                if (issue.targetEntity != null) {
                    sb.append(" on ").append(issue.targetEntity);
                    if (issue.targetField != null) sb.append(".").append(issue.targetField);
                }
                if (issue.sourceColumn != null) {
                    sb.append(" (source column: \"").append(issue.sourceColumn).append("\")");
                }
                sb.append(": ").append(issue.count).append(" occurrence(s)");
                if (issue.sampleMessage != null) {
                    sb.append("\n    Sample: \"").append(truncate(issue.sampleMessage, 150)).append("\"");
                }
                sb.append("\n");
            }
            sb.append("\n");
        }

        if (!ctx.unmappedSourceFields.isEmpty()) {
            sb.append("UNMAPPED SOURCE FIELDS (no target mapping assigned):\n");
            for (UnmappedField f : ctx.unmappedSourceFields) {
                sb.append("  - \"").append(f.sourceField).append("\"");
                if (f.sampleValue != null && !f.sampleValue.isBlank()) {
                    sb.append("  (sample: \"").append(f.sampleValue).append("\")");
                }
                sb.append("\n");
            }
            sb.append("\n");
        }

        if (!ctx.mappings.isEmpty()) {
            sb.append("CURRENT APPROVED FIELD MAPPINGS:\n");
            for (MappingInfo m : ctx.mappings) {
                sb.append("  - \"").append(m.sourceField)
                        .append("\" → ").append(m.targetEntity).append(".").append(m.targetField).append("\n");
            }
        }

        return sb.toString();
    }

    // ---- Response parsing ----

    @SuppressWarnings("unchecked")
    private List<SemanticDecision> parseResponse(String responseText, ValidationRun run) throws Exception {
        String json = responseText.trim();
        if (json.startsWith("```")) {
            json = json.replaceAll("^```[a-z]*\\s*", "").replaceAll("\\s*```$", "");
        }

        List<Map<String, Object>> raw = objectMapper.readValue(json, new TypeReference<>() {});
        List<SemanticDecision> decisions = new ArrayList<>();

        for (Map<String, Object> entry : raw) {
            if (decisions.size() >= MAX_DECISIONS) break;

            SemanticDecision d = new SemanticDecision();
            d.setTitle(truncate((String) entry.getOrDefault("title", "Untitled Decision"), 500));
            d.setSummary((String) entry.get("summary"));
            d.setFieldContext(truncate((String) entry.getOrDefault("fieldContext", ""), 500));
            d.setDecisionStatus(DecisionStatus.OPEN);
            d.setSource(DecisionSource.AI);
            d.setProject(run.getProject());
            d.setTenant(run.getTenant());

            if (entry.get("options") instanceof List<?> opts) {
                d.setOptions((List<Map<String, Object>>) opts);
            }
            if (entry.get("requirements") instanceof List<?> reqs) {
                d.setRequirements((List<Map<String, Object>>) reqs);
            }

            decisions.add(d);
        }

        log.info("Parsed {} decisions from AI response", decisions.size());
        return decisions;
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }
}
