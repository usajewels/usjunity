/**
 * Extract the first N rows from a CSV file without loading the entire file into memory.
 * Uses File.slice() to read incrementally until enough rows are found.
 */

const CHUNK_SIZE = 64 * 1024; // 64 KB per read

/**
 * Check whether a file exceeds the given threshold (in MB).
 */
export function isLargeFile(file: File, thresholdMB: number): boolean {
  return file.size > thresholdMB * 1024 * 1024;
}

/**
 * Check whether a file is a CSV by extension.
 */
export function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.csv');
}

/**
 * Extract the first `maxRows` data rows (plus header) from a CSV file.
 * Reads the file incrementally using File.slice() so even a 30 GB file
 * only loads a few hundred KB into memory.
 *
 * Returns the raw CSV text (header + data rows).
 */
export async function extractCsvPreview(file: File, maxRows = 1000): Promise<string> {
  const decoder = new TextDecoder('utf-8');
  let accumulated = '';
  let offset = 0;
  // +1 for the header row
  const targetNewlines = maxRows + 1;

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const blob = file.slice(offset, end);
    const buffer = await blob.arrayBuffer();
    accumulated += decoder.decode(buffer, { stream: offset + CHUNK_SIZE < file.size });
    offset = end;

    // Count complete lines
    const lines = accumulated.split('\n');
    // -1 because the last element might be an incomplete line
    const completeLines = lines.length - 1;

    if (completeLines >= targetNewlines) {
      // We have enough rows — trim to exactly what we need
      const result = lines.slice(0, targetNewlines);
      return result.join('\n');
    }
  }

  // File has fewer rows than maxRows — return everything
  return accumulated;
}
