using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;

namespace Satie.AI
{
    /// <summary>
    /// Anthropic Claude API provider with streaming support
    /// Supports Claude Sonnet 4.5, Haiku 4.5, and future models
    /// </summary>
    public class AnthropicProvider : ILLMProvider
    {
        public string Name => "anthropic";
        public string Model { get; }

        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private const string BASE_URL = "https://api.anthropic.com/v1";
        private const string ANTHROPIC_VERSION = "2023-06-01";

        public AnthropicProvider(string model = "claude-sonnet-4-5-20250929")
        {
            Model = model;
            _apiKey = SatieAPIKeyManager.GetKey(SatieAPIKeyManager.Provider.Anthropic);

            if (string.IsNullOrEmpty(_apiKey))
            {
                UnityEngine.Debug.LogError("[AnthropicProvider] No API key found. Please configure Anthropic API key.");
            }

            _httpClient = new HttpClient();
            _httpClient.DefaultRequestHeaders.Add("x-api-key", _apiKey);
            _httpClient.DefaultRequestHeaders.Add("anthropic-version", ANTHROPIC_VERSION);
        }

        public async Task<GenerateResponse> GenerateAsync(GenerateRequest request)
        {
            var stopwatch = Stopwatch.StartNew();

            try
            {
                var apiRequest = BuildApiRequest(request, stream: false);
                var content = new StringContent(apiRequest, Encoding.UTF8, "application/json");

                var response = await _httpClient.PostAsync($"{BASE_URL}/messages", content);
                stopwatch.Stop();

                if (!response.IsSuccessStatusCode)
                {
                    string error = await response.Content.ReadAsStringAsync();
                    UnityEngine.Debug.LogError($"[AnthropicProvider] API error: {error}");
                    return new GenerateResponse
                    {
                        Success = false,
                        Error = error,
                        LatencyMs = stopwatch.ElapsedMilliseconds
                    };
                }

                string responseJson = await response.Content.ReadAsStringAsync();
                var apiResponse = ParseResponse(responseJson);

                return new GenerateResponse
                {
                    Content = apiResponse.content,
                    TokensUsed = apiResponse.tokensUsed,
                    LatencyMs = stopwatch.ElapsedMilliseconds,
                    Success = true
                };
            }
            catch (Exception e)
            {
                stopwatch.Stop();
                UnityEngine.Debug.LogError($"[AnthropicProvider] Generation failed: {e.Message}");
                return new GenerateResponse
                {
                    Success = false,
                    Error = e.Message,
                    LatencyMs = stopwatch.ElapsedMilliseconds
                };
            }
        }

        public async IAsyncEnumerable<string> StreamAsync(GenerateRequest request)
        {
            string apiRequest = BuildApiRequest(request, stream: true);
            var content = new StringContent(apiRequest, Encoding.UTF8, "application/json");

            HttpResponseMessage response = null;
            Stream stream = null;
            StreamReader reader = null;

            try
            {
                var requestMessage = new HttpRequestMessage(HttpMethod.Post, $"{BASE_URL}/messages")
                {
                    Content = content
                };

                response = await _httpClient.SendAsync(requestMessage, HttpCompletionOption.ResponseHeadersRead);

                if (!response.IsSuccessStatusCode)
                {
                    string error = await response.Content.ReadAsStringAsync();
                    UnityEngine.Debug.LogError($"[AnthropicProvider] Stream error: {error}");
                    yield break;
                }

                stream = await response.Content.ReadAsStreamAsync();
                reader = new StreamReader(stream);

                string line;
                while ((line = await reader.ReadLineAsync()) != null)
                {
                    // SSE format: "data: {...}"
                    if (line.StartsWith("data: "))
                    {
                        string jsonData = line.Substring(6);

                        // Check for stream end
                        if (jsonData == "[DONE]") break;

                        var streamChunk = ParseStreamChunk(jsonData);
                        if (!string.IsNullOrEmpty(streamChunk))
                        {
                            yield return streamChunk;
                        }
                    }
                }
            }
            finally
            {
                reader?.Dispose();
                stream?.Dispose();
                response?.Dispose();
            }
        }

        public async Task<bool> IsHealthyAsync()
        {
            try
            {
                if (string.IsNullOrEmpty(_apiKey))
                {
                    return false;
                }

                // Simple health check - try a minimal request
                var testRequest = new GenerateRequest
                {
                    Prompt = "hi",
                    SystemPrompt = "Respond with 'ok'",
                    MaxTokens = 10,
                    UseCache = false
                };

                var response = await GenerateAsync(testRequest);
                return response.Success;
            }
            catch
            {
                return false;
            }
        }

        #region Helper Methods

        private string BuildApiRequest(GenerateRequest request, bool stream)
        {
            var apiRequest = new ApiRequestBody
            {
                model = Model,
                max_tokens = request.MaxTokens,
                temperature = request.Temperature,
                system = request.SystemPrompt,
                messages = new[] { new Message { role = "user", content = request.Prompt } },
                stream = stream
            };

            return JsonUtility.ToJson(apiRequest);
        }

        [System.Serializable]
        private class ApiRequestBody
        {
            public string model;
            public int max_tokens;
            public float temperature;
            public string system;
            public Message[] messages;
            public bool stream;
        }

        [System.Serializable]
        private class Message
        {
            public string role;
            public string content;
        }

        [System.Serializable]
        private class AnthropicResponse
        {
            public string id;
            public string type;
            public string role;
            public ContentBlock[] content;
            public string model;
            public string stop_reason;
            public Usage usage;
        }

        [System.Serializable]
        private class ContentBlock
        {
            public string type;
            public string text;
        }

        [System.Serializable]
        private class Usage
        {
            public int input_tokens;
            public int output_tokens;
        }

        [System.Serializable]
        private class StreamEvent
        {
            public string type;
            public int index;
            public Delta delta;
            public ContentBlock content_block;
        }

        [System.Serializable]
        private class Delta
        {
            public string type;
            public string text;
        }

        private (string content, int tokensUsed) ParseResponse(string json)
        {
            try
            {
                var response = JsonUtility.FromJson<AnthropicResponse>(json);

                if (response?.content != null && response.content.Length > 0)
                {
                    string text = response.content[0].text;
                    int tokens = response.usage != null
                        ? response.usage.input_tokens + response.usage.output_tokens
                        : 0;

                    return (text, tokens);
                }

                return (null, 0);
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogError($"[AnthropicProvider] Failed to parse response: {e.Message}");
                return (null, 0);
            }
        }

        private string ParseStreamChunk(string json)
        {
            try
            {
                var streamEvent = JsonUtility.FromJson<StreamEvent>(json);

                // Handle content_block_delta events (contain the actual text)
                if (streamEvent.type == "content_block_delta" && streamEvent.delta?.text != null)
                {
                    return streamEvent.delta.text;
                }

                // Handle content_block_start events (first content block)
                if (streamEvent.type == "content_block_start" && streamEvent.content_block?.text != null)
                {
                    return streamEvent.content_block.text;
                }

                return null;
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogWarning($"[AnthropicProvider] Failed to parse stream chunk: {e.Message}");
                return null;
            }
        }

        #endregion
    }
}
