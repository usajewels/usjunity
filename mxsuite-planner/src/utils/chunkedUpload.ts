import { tenantOnboardingApi } from '../services/tenantOnboardingApi';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per chunk
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export interface ChunkProgress {
  phase: 'uploading' | 'assembled';
  chunkIndex: number;
  totalChunks: number;
  pct: number;
}

/**
 * Upload a large file in chunks (10 MB each) with retry logic.
 * Calls the backend chunk endpoint sequentially.
 */
export async function chunkedUpload(
  file: File,
  onProgress: (progress: ChunkProgress) => void,
): Promise<void> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await tenantOnboardingApi.uploadChunk(i, totalChunks, chunk, file.name);
        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
        }
      }
    }

    if (lastError) {
      throw new Error(`Failed to upload chunk ${i + 1}/${totalChunks} after ${MAX_RETRIES} attempts: ${lastError.message}`);
    }

    const pct = Math.round(((i + 1) / totalChunks) * 100);
    onProgress({
      phase: i + 1 >= totalChunks ? 'assembled' : 'uploading',
      chunkIndex: i,
      totalChunks,
      pct,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
