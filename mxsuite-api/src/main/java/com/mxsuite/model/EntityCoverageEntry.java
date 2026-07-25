package com.mxsuite.model;

import java.math.BigDecimal;

/**
 * Stores per-entity detection result inside the Project's entity_coverage JSONB column.
 * Not a JPA entity — this is serialized/deserialized as part of the JSONB array.
 */
public class EntityCoverageEntry {

    private String entity;
    private boolean detected;
    private BigDecimal confidence;
    private String reasoning;
    private Boolean coachOverride; // null = no override, true = forced on, false = forced off

    public EntityCoverageEntry() {}

    public EntityCoverageEntry(String entity, boolean detected, BigDecimal confidence, String reasoning) {
        this.entity = entity;
        this.detected = detected;
        this.confidence = confidence;
        this.reasoning = reasoning;
    }

    /** Effective active state: coach override wins, otherwise use detection result. */
    public boolean isActive() {
        return coachOverride != null ? coachOverride : detected;
    }

    public String getEntity() { return entity; }
    public void setEntity(String entity) { this.entity = entity; }

    public boolean isDetected() { return detected; }
    public void setDetected(boolean detected) { this.detected = detected; }

    public BigDecimal getConfidence() { return confidence; }
    public void setConfidence(BigDecimal confidence) { this.confidence = confidence; }

    public String getReasoning() { return reasoning; }
    public void setReasoning(String reasoning) { this.reasoning = reasoning; }

    public Boolean getCoachOverride() { return coachOverride; }
    public void setCoachOverride(Boolean coachOverride) { this.coachOverride = coachOverride; }
}
