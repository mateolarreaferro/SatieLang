using System;
using System.Reflection;
using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Centralized API key management system for all Satie services.
    /// Reads keys from environment variables or from the user-provided APIKeys class
    /// (which lives outside the package assembly, so we access it via reflection).
    /// </summary>
    public static class SatieAPIKeyManager
    {
        public enum Provider
        {
            OpenAI,
            ElevenLabs,
            Anthropic,
            Google,
            Azure,
            Custom
        }

        private const string ENV_PREFIX = "SATIE_API_KEY_";

        private static Type _apiKeysType;
        private static bool _apiKeysTypeResolved;

        #region Public API

        /// <summary>
        /// Get API key for a specific provider.
        /// Priority: 1) Environment variable, 2) APIKeys.cs file
        /// </summary>
        public static string GetKey(Provider provider)
        {
            // 1. Check environment variable first (highest priority)
            string envKey = GetEnvironmentKey(provider);
            if (!string.IsNullOrEmpty(envKey))
            {
                return envKey.Trim();
            }

            // 2. Check APIKeys class via reflection (lives in user assembly)
            string fieldName = provider switch
            {
                Provider.Anthropic => "ANTHROPIC",
                Provider.OpenAI => "OPENAI",
                Provider.ElevenLabs => "ELEVENLABS",
                Provider.Google => "GOOGLE",
                _ => null
            };

            if (fieldName != null)
            {
                string key = GetApiKeyField(fieldName);
                if (!string.IsNullOrEmpty(key) && !key.StartsWith("YOUR_"))
                {
                    return key.Trim();
                }
            }

            Debug.LogWarning($"[APIKeys] No valid API key found for {provider}. Please add your key to Assets/APIKeys.cs");
            return null;
        }

        /// <summary>
        /// Check if a provider has a valid key.
        /// </summary>
        public static bool HasKey(Provider provider)
        {
            return !string.IsNullOrEmpty(GetKey(provider));
        }

        #endregion

        #region Helper Methods

        private static string GetEnvironmentKey(Provider provider)
        {
            string envVar = $"{ENV_PREFIX}{provider.ToString().ToUpper()}";
            return Environment.GetEnvironmentVariable(envVar);
        }

        private static string GetApiKeyField(string fieldName)
        {
            try
            {
                if (!_apiKeysTypeResolved)
                {
                    _apiKeysTypeResolved = true;
                    // Search all loaded assemblies for the APIKeys class
                    foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                    {
                        _apiKeysType = asm.GetType("Satie.APIKeys") ?? asm.GetType("APIKeys");
                        if (_apiKeysType != null) break;
                    }
                }

                if (_apiKeysType == null) return null;

                var field = _apiKeysType.GetField(fieldName,
                    BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy);
                return field?.GetValue(null) as string;
            }
            catch (Exception)
            {
                return null;
            }
        }

        #endregion
    }
}