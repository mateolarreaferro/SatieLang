using System.Collections.Generic;
using System.Threading.Tasks;

namespace Satie.AI
{
    /// <summary>
    /// Abstraction layer for multi-provider LLM support
    /// Enables swapping between Anthropic, OpenAI, Google, etc. without changing orchestrator code
    /// </summary>
    public interface ILLMProvider
    {
        /// <summary>
        /// Provider name (e.g., "anthropic", "openai", "google")
        /// </summary>
        string Name { get; }

        /// <summary>
        /// Model identifier (e.g., "claude-sonnet-4-5-20250929", "gpt-5.1")
        /// </summary>
        string Model { get; }

        /// <summary>
        /// Generate response synchronously
        /// </summary>
        Task<GenerateResponse> GenerateAsync(GenerateRequest request);

        /// <summary>
        /// Generate response with streaming (for real-time UI updates)
        /// </summary>
        IAsyncEnumerable<string> StreamAsync(GenerateRequest request);

        /// <summary>
        /// Check if provider is properly configured and ready
        /// </summary>
        Task<bool> IsHealthyAsync();
    }

    /// <summary>
    /// Request for LLM generation
    /// </summary>
    public class GenerateRequest
    {
        public string Prompt { get; set; }
        public string SystemPrompt { get; set; }
        public float Temperature { get; set; } = 0.7f;
        public int MaxTokens { get; set; } = 4000;
        public bool UseCache { get; set; } = true;
        public Dictionary<string, object> Metadata { get; set; } = new();
    }

    /// <summary>
    /// Response from LLM generation
    /// </summary>
    public class GenerateResponse
    {
        public string Content { get; set; }
        public int TokensUsed { get; set; }
        public long LatencyMs { get; set; }
        public bool Success { get; set; }
        public string Error { get; set; }
        public Dictionary<string, object> Metadata { get; set; } = new();
    }
}
