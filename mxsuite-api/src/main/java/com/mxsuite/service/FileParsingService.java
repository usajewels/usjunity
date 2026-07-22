package com.mxsuite.service;

import org.apache.poi.ss.usermodel.*;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

@Service
public class FileParsingService {

    private static final int SAMPLE_ROWS = 5;
    private static final int PREVIEW_ROWS = 10;

    private static final Set<String> EXCEL_CONTENT_TYPES = Set.of(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel"
    );

    public record ParsedFileResult(
            List<String> headers,
            List<List<String>> sampleRows,
            int totalRows,
            List<Map<String, Object>> sourceColumns
    ) {}

    public record SheetInfo(int index, String name, int rowCount) {}

    public record PreviewResult(
            List<String> headers,
            List<List<String>> rows,
            int totalRows
    ) {}

    public boolean isExcelFile(String contentType, String filename) {
        if (contentType != null && EXCEL_CONTENT_TYPES.contains(contentType)) return true;
        if (filename == null) return false;
        String lower = filename.toLowerCase();
        return lower.endsWith(".xlsx") || lower.endsWith(".xls");
    }

    public ParsedFileResult parseCsvFile(Path filePath) throws IOException {
        List<String> headers;
        List<List<String>> sampleRows = new ArrayList<>();
        int totalRows = 0;

        try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {
            String headerLine = reader.readLine();
            if (headerLine == null || headerLine.isBlank()) {
                throw new IOException("CSV file is empty or has no headers");
            }
            headers = parseCsvLine(headerLine);

            String line;
            while ((line = reader.readLine()) != null) {
                totalRows++;
                if (sampleRows.size() < SAMPLE_ROWS) {
                    sampleRows.add(parseCsvLine(line));
                }
            }
        }

        return new ParsedFileResult(headers, sampleRows, totalRows, buildSourceColumns(headers, sampleRows));
    }

    public ParsedFileResult parseExcelSheet(Path filePath, int sheetIndex) throws IOException {
        try (InputStream is = Files.newInputStream(filePath);
             Workbook workbook = WorkbookFactory.create(is)) {
            Sheet sheet = workbook.getSheetAt(sheetIndex);
            return parseSheet(sheet);
        }
    }

    public ParsedFileResult parseExcelSheetByName(Path filePath, String sheetName) throws IOException {
        try (InputStream is = Files.newInputStream(filePath);
             Workbook workbook = WorkbookFactory.create(is)) {
            Sheet sheet = sheetName != null ? workbook.getSheet(sheetName) : workbook.getSheetAt(0);
            if (sheet == null) sheet = workbook.getSheetAt(0);
            return parseSheet(sheet);
        }
    }

    public List<SheetInfo> listExcelSheets(Path filePath) throws IOException {
        try (InputStream is = Files.newInputStream(filePath);
             Workbook workbook = WorkbookFactory.create(is)) {
            List<SheetInfo> sheets = new ArrayList<>();
            for (int i = 0; i < workbook.getNumberOfSheets(); i++) {
                Sheet sheet = workbook.getSheetAt(i);
                sheets.add(new SheetInfo(i, sheet.getSheetName(),
                        Math.max(0, sheet.getPhysicalNumberOfRows() - 1)));
            }
            return sheets;
        }
    }

    public PreviewResult getPreview(Path filePath, String sheetName, int totalRows) throws IOException {
        String filename = filePath.getFileName().toString().toLowerCase();
        boolean isExcel = filename.endsWith(".xlsx") || filename.endsWith(".xls");

        List<List<String>> rows = new ArrayList<>();

        if (isExcel) {
            try (InputStream is = Files.newInputStream(filePath);
                 Workbook workbook = WorkbookFactory.create(is)) {
                Sheet sheet = sheetName != null ? workbook.getSheet(sheetName) : workbook.getSheetAt(0);
                if (sheet == null) sheet = workbook.getSheetAt(0);

                DataFormatter formatter = new DataFormatter();
                for (int r = 0; r <= Math.min(sheet.getLastRowNum(), PREVIEW_ROWS); r++) {
                    Row row = sheet.getRow(r);
                    if (row == null) continue;
                    List<String> values = new ArrayList<>();
                    for (int c = 0; c < row.getLastCellNum(); c++) {
                        Cell cell = row.getCell(c);
                        values.add(cell != null ? formatter.formatCellValue(cell).trim() : "");
                    }
                    rows.add(values);
                }
            }
        } else {
            try (BufferedReader reader = Files.newBufferedReader(filePath, StandardCharsets.UTF_8)) {
                String line;
                int count = 0;
                while ((line = reader.readLine()) != null && count <= PREVIEW_ROWS) {
                    rows.add(parseCsvLine(line));
                    count++;
                }
            }
        }

        List<String> headers = rows.isEmpty() ? List.of() : rows.get(0);
        List<List<String>> dataRows = rows.size() > 1 ? rows.subList(1, rows.size()) : List.of();
        return new PreviewResult(headers, dataRows, totalRows);
    }

    // ---- internal helpers ----

    private ParsedFileResult parseSheet(Sheet sheet) {
        DataFormatter formatter = new DataFormatter();
        Row headerRow = sheet.getRow(0);
        if (headerRow == null) {
            return new ParsedFileResult(List.of(), List.of(), 0, List.of());
        }

        List<String> headers = new ArrayList<>();
        for (int i = 0; i < headerRow.getLastCellNum(); i++) {
            Cell cell = headerRow.getCell(i);
            headers.add(cell != null ? formatter.formatCellValue(cell).trim() : "Column" + (i + 1));
        }

        List<List<String>> sampleRows = new ArrayList<>();
        int totalRows = 0;
        for (int r = 1; r <= sheet.getLastRowNum(); r++) {
            Row row = sheet.getRow(r);
            if (row == null) continue;
            totalRows++;
            if (sampleRows.size() < SAMPLE_ROWS) {
                List<String> values = new ArrayList<>();
                for (int c = 0; c < headers.size(); c++) {
                    Cell cell = row.getCell(c);
                    values.add(cell != null ? formatter.formatCellValue(cell).trim() : "");
                }
                sampleRows.add(values);
            }
        }

        return new ParsedFileResult(headers, sampleRows, totalRows, buildSourceColumns(headers, sampleRows));
    }

    private List<Map<String, Object>> buildSourceColumns(List<String> headers, List<List<String>> sampleRows) {
        List<Map<String, Object>> sourceColumns = new ArrayList<>();
        for (int i = 0; i < headers.size(); i++) {
            Map<String, Object> col = new LinkedHashMap<>();
            col.put("name", headers.get(i));
            List<String> samples = new ArrayList<>();
            for (List<String> row : sampleRows) {
                if (i < row.size()) {
                    samples.add(row.get(i));
                }
            }
            col.put("sampleValues", samples);
            sourceColumns.add(col);
        }
        return sourceColumns;
    }

    private List<String> parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        boolean inQuotes = false;
        StringBuilder current = new StringBuilder();

        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                if (inQuotes && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    current.append('"');
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c == ',' && !inQuotes) {
                fields.add(current.toString());
                current = new StringBuilder();
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString());
        return fields;
    }
}
