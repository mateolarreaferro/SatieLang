using System;

namespace Satie
{
    /// <summary>
    /// Exception thrown when there's a syntax error in a Satie script
    /// </summary>
    public class SatieSyntaxException : Exception
    {
        public string ScriptLine { get; private set; }
        public string PropertyName { get; private set; }
        public string InvalidValue { get; private set; }
        public int LineNumber { get; private set; }

        public SatieSyntaxException(string message, string propertyName = null, string invalidValue = null, string scriptLine = null, int lineNumber = -1)
            : base(FormatMessage(message, propertyName, invalidValue, scriptLine, lineNumber))
        {
            PropertyName = propertyName;
            InvalidValue = invalidValue;
            ScriptLine = scriptLine;
            LineNumber = lineNumber;
        }

        private static string FormatMessage(string message, string propertyName, string invalidValue, string scriptLine, int lineNumber)
        {
            var formatted = $"[Satie Syntax Error] {message}";

            if (lineNumber > 0)
                formatted += $"\n  Line {lineNumber}";

            if (!string.IsNullOrEmpty(scriptLine))
                formatted += $"\n  → {scriptLine.Trim()}";

            if (!string.IsNullOrEmpty(propertyName))
                formatted += $"\n  Property: '{propertyName}'";

            if (!string.IsNullOrEmpty(invalidValue))
                formatted += $"\n  Invalid value: '{invalidValue}'";

            formatted += "\n\nCheck your Satie script syntax and try again.";

            return formatted;
        }
    }
}
