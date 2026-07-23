package com.mxsuite.model;

import com.mxsuite.model.enums.UploadStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.List;
import java.util.Map;

@Entity
@Table(name = "project_data_uploads")
@Getter
@Setter
@NoArgsConstructor
public class ProjectDataUpload extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    private Project project;

    @Column(name = "original_filename", length = 500)
    private String originalFilename;

    @Column(name = "sheet_name", length = 200)
    private String sheetName;

    @Column(name = "row_count")
    private Integer rowCount;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "source_columns", columnDefinition = "jsonb")
    private List<Map<String, Object>> sourceColumns;

    @Column(name = "storage_path", length = 1000)
    private String storagePath;

    @Enumerated(EnumType.STRING)
    @Column(name = "upload_status", nullable = false)
    private UploadStatus uploadStatus = UploadStatus.PENDING;

    @Column(name = "total_file_size")
    private Long totalFileSize;

    @Column(name = "import_status", length = 30)
    private String importStatus = "NONE";

    @Column(name = "import_progress_pct")
    private Integer importProgressPct = 0;

    @Column(name = "imported_row_count")
    private Integer importedRowCount = 0;

    @Column(name = "import_error", columnDefinition = "TEXT")
    private String importError;

    @Column(name = "chunks_received")
    private Integer chunksReceived = 0;

    @Column(name = "chunks_total")
    private Integer chunksTotal = 0;
}
