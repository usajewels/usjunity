package com.mxsuite.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.logging.LogLevel;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api/admin/logs")
@PreAuthorize("hasRole('PLATFORM_ADMIN')")
public class LogViewerController {

    private final LoggingSystem loggingSystem;

    @Value("${logging.file.name:logs/mxsuite-api.log}")
    private String logFilePath;

    // Matches: 2026-07-21 13:34:30.123 [thread] [traceId=xxx spanId=yyy] LEVEL logger - message
    private static final Pattern LOG_LINE_PATTERN = Pattern.compile(
            "^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3})\\s+" +
            "\\[([^]]+)]\\s+" +
            "\\[traceId=([^\\s]+)\\s+spanId=([^]]+)]\\s+" +
            "(\\S+)\\s+" +
            "(\\S+)\\s+-\\s+" +
            "(.*)$"
    );

    public LogViewerController(LoggingSystem loggingSystem) {
        this.loggingSystem = loggingSystem;
    }

    // --- DTOs ---

    public record LogEntryDto(
            String timestamp,
            String thread,
            String traceId,
            String spanId,
            String level,
            String logger,
            String message) {}

    public record LogPageDto(
            List<LogEntryDto> entries,
            long fileSize,
            String fileName) {}

    public record LoggerDto(
            String name,
            String configuredLevel,
            String effectiveLevel) {}

    public record SetLoggerLevelRequest(String level) {}

    // --- Log file reading ---

    @GetMapping
    public ResponseEntity<LogPageDto> getLogs(
            @RequestParam(defaultValue = "500") int lines,
            @RequestParam(required = false) String level,
            @RequestParam(required = false) String search) throws IOException {

        Path path = Paths.get(logFilePath).toAbsolutePath();
        if (!Files.exists(path)) {
            return ResponseEntity.ok(new LogPageDto(List.of(), 0, logFilePath));
        }

        long fileSize = Files.size(path);

        // Read the tail of the file (last N KB to get enough lines)
        List<String> rawLines = tailFile(path, lines, level, search);

        // Parse lines into structured entries
        List<LogEntryDto> entries = parseLogLines(rawLines);

        // Apply filters
        if (level != null && !level.isEmpty()) {
            Set<String> levels = Set.of(level.toUpperCase().split(","));
            entries = entries.stream()
                    .filter(e -> levels.contains(e.level()))
                    .collect(Collectors.toList());
        }

        if (search != null && !search.isEmpty()) {
            String lowerSearch = search.toLowerCase();
            entries = entries.stream()
                    .filter(e -> e.message().toLowerCase().contains(lowerSearch)
                            || e.logger().toLowerCase().contains(lowerSearch)
                            || e.thread().toLowerCase().contains(lowerSearch)
                            || (e.traceId() != null && e.traceId().toLowerCase().contains(lowerSearch)))
                    .collect(Collectors.toList());
        }

        // Limit to requested number of lines
        if (entries.size() > lines) {
            entries = entries.subList(entries.size() - lines, entries.size());
        }

        return ResponseEntity.ok(new LogPageDto(entries, fileSize, path.getFileName().toString()));
    }

    // --- Logger management ---

    @GetMapping("/loggers")
    public ResponseEntity<List<LoggerDto>> getLoggers() {
        var configurations = loggingSystem.getLoggerConfigurations();
        List<LoggerDto> loggers = configurations.stream()
                .filter(c -> c.getConfiguredLevel() != null
                        || "ROOT".equalsIgnoreCase(c.getName())
                        || c.getName().startsWith("com.mxsuite")
                        || c.getName().startsWith("org.springframework")
                        || c.getName().startsWith("org.hibernate")
                        || c.getName().startsWith("org.flywaydb"))
                .map(c -> new LoggerDto(
                        c.getName(),
                        c.getConfiguredLevel() != null ? c.getConfiguredLevel().name() : null,
                        c.getEffectiveLevel() != null ? c.getEffectiveLevel().name() : null))
                .sorted(Comparator.comparing(LoggerDto::name))
                .collect(Collectors.toList());
        return ResponseEntity.ok(loggers);
    }

    @PutMapping("/loggers/{name}")
    public ResponseEntity<Void> setLoggerLevel(
            @PathVariable String name,
            @RequestBody SetLoggerLevelRequest request) {
        LogLevel logLevel = request.level() == null || request.level().isEmpty()
                ? null
                : LogLevel.valueOf(request.level().toUpperCase());
        loggingSystem.setLogLevel(name, logLevel);
        return ResponseEntity.ok().build();
    }

    // --- File reading helpers ---

    private List<String> tailFile(Path path, int maxEntries, String level, String search) throws IOException {
        // Read from the end of the file — we want enough raw lines to produce maxEntries parsed entries
        // Overshoot to account for multi-line log entries and filtering
        int readLines = maxEntries * 4;
        if (level != null || search != null) {
            readLines = maxEntries * 10; // need more raw lines when filtering
        }

        List<String> result = new ArrayList<>();
        try (RandomAccessFile raf = new RandomAccessFile(path.toFile(), "r")) {
            long fileLength = raf.length();
            if (fileLength == 0) return result;

            // Start reading from the end — estimate ~200 bytes per line
            long startPos = Math.max(0, fileLength - (long) readLines * 200);
            raf.seek(startPos);

            // Skip partial first line if we're not at the beginning
            if (startPos > 0) {
                raf.readLine();
            }

            // Read all remaining lines
            String line;
            while ((line = raf.readLine()) != null) {
                // RandomAccessFile.readLine() uses ISO-8859-1, re-encode to UTF-8
                result.add(new String(line.getBytes(StandardCharsets.ISO_8859_1), StandardCharsets.UTF_8));
            }
        }

        return result;
    }

    private List<LogEntryDto> parseLogLines(List<String> rawLines) {
        List<LogEntryDto> entries = new ArrayList<>();
        LogEntryDto current = null;
        StringBuilder messageBuilder = null;

        for (String line : rawLines) {
            Matcher matcher = LOG_LINE_PATTERN.matcher(line);
            if (matcher.matches()) {
                // Flush previous entry
                if (current != null) {
                    entries.add(finishEntry(current, messageBuilder));
                }
                String traceId = "none".equals(matcher.group(3)) ? null : matcher.group(3);
                String spanId = "none".equals(matcher.group(4)) ? null : matcher.group(4);
                current = new LogEntryDto(
                        matcher.group(1),
                        matcher.group(2),
                        traceId,
                        spanId,
                        matcher.group(5).trim(),
                        matcher.group(6),
                        matcher.group(7));
                messageBuilder = new StringBuilder(matcher.group(7));
            } else if (current != null) {
                // Continuation line (stack trace, multi-line message)
                messageBuilder.append("\n").append(line);
            }
            // Skip orphan lines before the first matched entry
        }

        // Flush last entry
        if (current != null) {
            entries.add(finishEntry(current, messageBuilder));
        }

        return entries;
    }

    private LogEntryDto finishEntry(LogEntryDto entry, StringBuilder fullMessage) {
        String msg = fullMessage.toString();
        if (msg.equals(entry.message())) return entry;
        return new LogEntryDto(
                entry.timestamp(), entry.thread(), entry.traceId(), entry.spanId(),
                entry.level(), entry.logger(), msg);
    }
}
