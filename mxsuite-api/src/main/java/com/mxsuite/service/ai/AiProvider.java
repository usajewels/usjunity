package com.mxsuite.service.ai;

/**
 * Common interface for AI providers (Anthropic, Groq, Grok/xAI, etc.).
 */
public interface AiProvider {

    /**
     * Send a chat request and return the model's text response.
     *
     * @param systemPrompt optional system-level instructions (may be null)
     * @param userPrompt   the user message / prompt
     * @param maxTokens    maximum tokens in the response
     * @return the model's text response
     */
    String chat(String systemPrompt, String userPrompt, int maxTokens);

    /** Whether this provider has a valid API key configured. */
    boolean isAvailable();

    /** Display name for logging (e.g. "anthropic", "groq", "grok"). */
    String name();
}
