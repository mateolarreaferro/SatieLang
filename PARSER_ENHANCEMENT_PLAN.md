# Satie Parser Enhancement Plan: Hybrid Approach

## Executive Summary

This document outlines a two-phase plan to enhance the Satie parser from a flat-list structure to a hybrid approach that preserves simplicity while enabling future extensibility.

**Phase 1** adds metadata tracking without structural changes (immediate benefits, low risk).  
**Phase 2** introduces a proper AST for advanced features (deferred until needed).

---

## Current Architecture

### Parser Flow
```
.sat text → Regex matching → Statement objects → List<Statement>
```

### Data Structure
```csharp
List<Statement> {
    Statement { kind="loop", clip="rain", volume=0.8, ... },
    Statement { kind="oneshot", clip="impact", ... }
}
```

### Characteristics
- ✅ Simple, direct, efficient
- ✅ Works well for current feature set
- ❌ Limited error context
- ❌ No source location tracking
- ❌ Difficult to extend with control flow
- ❌ Groups are flattened (no hierarchy preserved)

---

## Phase 1: Enhanced Metadata (Immediate Implementation)

### Objectives
1. Add source location tracking for better error messages
2. Preserve group hierarchy information
3. Enable better debugging and IDE support
4. Maintain backward compatibility

### Timeline
**Estimated effort**: 2-3 days  
**Priority**: High (improves developer experience immediately)

---

### 1.1 Statement Class Enhancements

**File**: `Packages/com.satie.lang/Runtime/Core/SatieParser.cs:9-96`

#### Add New Fields

```csharp
public sealed class Statement
{
    // ===== EXISTING FIELDS =====
    public string kind;
    public string clip;
    public int count = 1;
    // ... (all existing fields remain)
    
    // ===== NEW: SOURCE LOCATION TRACKING =====
    
    /// <summary>
    /// Line number in source file (1-indexed)
    /// </summary>
    public int LineNumber { get; set; } = -1;
    
    /// <summary>
    /// Starting column in source line (0-indexed)
    /// </summary>
    public int ColumnStart { get; set; } = -1;
    
    /// <summary>
    /// Ending column in source line (0-indexed)
    /// </summary>
    public int ColumnEnd { get; set; } = -1;
    
    /// <summary>
    /// Full text of the statement line (for error display)
    /// </summary>
    public string SourceLine { get; set; } = string.Empty;
    
    /// <summary>
    /// Hierarchical path showing group nesting (e.g., "ambient/rain/heavy")
    /// </summary>
    public string GroupPath { get; set; } = "root";
    
    /// <summary>
    /// Direct parent group name (null if at root level)
    /// </summary>
    public string ParentGroup { get; set; } = null;
    
    /// <summary>
    /// Nesting depth (0 = root, 1 = first level group, etc.)
    /// </summary>
    public int NestingDepth { get; set; } = 0;
    
    /// <summary>
    /// Properties inherited from parent groups (for debugging)
    /// </summary>
    public Dictionary<string, string> InheritedProperties { get; set; } = new();
    
    // ===== NEW: HELPER METHODS =====
    
    /// <summary>
    /// Get a human-readable description of this statement's location
    /// </summary>
    public string GetLocationDescription()
    {
        if (LineNumber < 0) return "unknown location";
        
        string location = $"line {LineNumber}";
        if (ParentGroup != null)
            location += $" in group '{ParentGroup}'";
        
        return location;
    }
    
    /// <summary>
    /// Get formatted error context showing source line with pointer
    /// </summary>
    public string GetErrorContext(int highlightColumn = -1)
    {
        if (string.IsNullOrEmpty(SourceLine)) return string.Empty;
        
        var sb = new StringBuilder();
        sb.AppendLine($"  {LineNumber} | {SourceLine}");
        
        if (highlightColumn >= 0)
        {
            int padding = LineNumber.ToString().Length + 3 + highlightColumn;
            sb.AppendLine($"{new string(' ', padding)}^");
        }
        
        return sb.ToString();
    }
}
```

---

### 1.2 Parser Modifications

**File**: `Packages/com.satie.lang/Runtime/Core/SatieParser.cs:155-287`

#### Track Group Context

```csharp
sealed class GroupCtx
{
    public readonly Dictionary<string, string> props = new();
    public readonly List<Statement> children = new();
    public int indent;
    
    // NEW: Track group hierarchy
    public string name;              // Group name (if provided)
    public string fullPath;          // Full hierarchical path
    public int nestingDepth;         // How deep we are
    public GroupCtx parent;          // Parent group (for nesting)
}
```

#### Update Parse Method

```csharp
public static List<Statement> Parse(string script)
{
    var outList = new List<Statement>();
    var lines = script.Replace("\r\n", "\n").Split('\n');
    
    GroupCtx grp = null;
    bool inBlockComment = false;
    
    // NEW: Track current line number and group path
    int currentLineNumber = 0;
    string currentGroupPath = "root";
    
    try
    {
        for (int i = 0; i < lines.Length; ++i)
        {
            currentLineNumber = i + 1;  // 1-indexed for display
            
            try
            {
                string raw = lines[i];
                string trimmed = raw.TrimStart();
                
                // [Block comment handling - unchanged]
                if (trimmed.StartsWith("comment", StringComparison.OrdinalIgnoreCase))
                {
                    inBlockComment = true;
                    continue;
                }
                
                if (trimmed.StartsWith("endcomment", StringComparison.OrdinalIgnoreCase))
                {
                    inBlockComment = false;
                    continue;
                }
                
                if (inBlockComment)
                    continue;
                
                // [Empty line handling - unchanged]
                if (string.IsNullOrWhiteSpace(raw) || trimmed.StartsWith("#"))
                    continue;
                
                int indent = CountIndent(raw);
                string body = trimmed;
                
                // [Group closing logic - unchanged]
                if (grp != null &&
                    indent == grp.indent &&
                    (StmtStartRx.IsMatch(body) ||
                     body.StartsWith("group ", true, null) ||
                     body.StartsWith("endgroup", true, null)))
                {
                    FlushGroup(outList, grp);
                    grp = null;
                    
                    // NEW: Reset group path when exiting group
                    if (grp?.parent != null)
                    {
                        currentGroupPath = grp.parent.fullPath;
                    }
                    else
                    {
                        currentGroupPath = "root";
                    }
                }
                
                if (grp != null && body.StartsWith("endgroup", true, null))
                    continue;
                
                // Open group
                if (body.StartsWith("group ", true, null))
                {
                    // NEW: Extract group name
                    string groupName = body.Substring(6).Trim();
                    if (string.IsNullOrEmpty(groupName))
                        groupName = $"unnamed_{currentLineNumber}";
                    
                    // NEW: Build full path
                    string newPath = currentGroupPath == "root" 
                        ? groupName 
                        : $"{currentGroupPath}/{groupName}";
                    
                    grp = new GroupCtx 
                    { 
                        indent = indent,
                        name = groupName,           // NEW
                        fullPath = newPath,         // NEW
                        nestingDepth = currentGroupPath.Split('/').Length - 1,  // NEW
                        parent = grp                // NEW: Support nesting
                    };
                    
                    currentGroupPath = newPath;
                    continue;
                }
                
                // Statement
                if (StmtStartRx.IsMatch(body))
                {
                    int stmtIndent = indent;
                    int stmtStartLine = i;
                    var sb = new StringBuilder();
                    sb.AppendLine(body);
                    
                    int j = i + 1;
                    while (j < lines.Length && CountIndent(lines[j]) > stmtIndent)
                    {
                        sb.AppendLine(lines[j]);
                        ++j;
                    }
                    i = j - 1;
                    
                    // NEW: Pass location context
                    var st = ParseSingle(
                        sb.ToString(), 
                        stmtStartLine + 1,      // Line number (1-indexed)
                        currentGroupPath,       // Current group path
                        grp?.name,              // Parent group name
                        grp?.nestingDepth ?? 0  // Nesting depth
                    );
                    
                    if (grp != null) grp.children.Add(st); else outList.Add(st);
                    continue;
                }
                
                // [Property parsing - unchanged]
                if (grp != null && PropRx.IsMatch(body))
                {
                    var m = PropRx.Match(body);
                    string k = m.Groups["key"].Value.ToLower();
                    
                    bool isStandaloneFlag = k is "overlap" or "persistent" or "mute" or "solo" or "randomstart" or "random_start";
                    string rawVal = (!isStandaloneFlag && m.Groups["val"].Success) ? m.Groups["val"].Value.Trim() : "";
                    
                    if (k is "move" or "visual")
                        Debug.LogWarning($"[Satie] '{k}' not allowed on a group – ignored.");
                    else
                        grp.props[k] = rawVal;
                    continue;
                }
                
                Debug.LogWarning($"[Satie] Unrecognised line: '{body}'");
            }
            catch (SatieSyntaxException ex)
            {
                // NEW: Enhanced error with location context
                throw new SatieSyntaxException(
                    ex.Message,
                    ex.PropertyName,
                    ex.InvalidValue,
                    lines[i],
                    currentLineNumber,
                    ex.ColumnNumber >= 0 ? ex.ColumnNumber : -1,
                    currentGroupPath
                );
            }
        }
    }
    catch (SatieSyntaxException)
    {
        throw; // Re-throw our custom exceptions with full context
    }
    catch (Exception ex)
    {
        throw new SatieSyntaxException(
            $"Unexpected error while parsing script: {ex.Message}",
            null,
            null,
            null,
            currentLineNumber,
            -1,
            currentGroupPath
        );
    }
    
    if (grp != null) FlushGroup(outList, grp);
    return outList;
}
```

#### Update ParseSingle Method

```csharp
// NEW SIGNATURE: Add location parameters
static Statement ParseSingle(
    string block, 
    int lineNumber, 
    string groupPath, 
    string parentGroup,
    int nestingDepth)
{
    var m = StmtRx.Match(block);
    var s = new Statement
    {
        kind = m.Groups["kind"].Value.ToLower(),
        clip = m.Groups["clip"].Value.Trim(),
        count = m.Groups["count"].Success ? int.Parse(m.Groups["count"].Value) : 1,
        
        // NEW: Set location metadata
        LineNumber = lineNumber,
        SourceLine = block.Split('\n')[0].Trim(),
        ColumnStart = m.Index,
        ColumnEnd = m.Index + m.Length,
        GroupPath = groupPath,
        ParentGroup = parentGroup,
        NestingDepth = nestingDepth
    };
    
    // [Rest of parsing logic unchanged]
    
    if (m.Groups["e1"].Success)
        s.every = new RangeOrValue(
            float.Parse(m.Groups["e1"].Value),
            float.Parse(m.Groups["e2"].Value));
    else if (m.Groups["e"].Success)
        s.every = new RangeOrValue(float.Parse(m.Groups["e"].Value));
    
    // ... property parsing ...
    
    return s;
}
```

#### Update FlushGroup Method

```csharp
static void FlushGroup(List<Statement> dst, GroupCtx g)
{
    // [Existing group property merging logic - unchanged]
    
    foreach (var s in g.children)
    {
        // NEW: Track inherited properties for debugging
        foreach (var kv in g.props)
        {
            if (!s.InheritedProperties.ContainsKey(kv.Key))
            {
                s.InheritedProperties[kv.Key] = $"{kv.Value} (from group '{g.name}')";
            }
        }
        
        // [Existing property application - unchanged]
        
        dst.Add(s);
    }
}
```

---

### 1.3 Enhanced Error Handling

**File**: `Packages/com.satie.lang/Runtime/Core/SatieSyntaxException.cs`

#### Update Exception Class

```csharp
public class SatieSyntaxException : Exception
{
    public string PropertyName { get; }
    public string InvalidValue { get; }
    public string SourceLine { get; }
    public int LineNumber { get; }
    public int ColumnNumber { get; }      // NEW
    public string GroupPath { get; }      // NEW
    
    public SatieSyntaxException(
        string message, 
        string propertyName = null, 
        string invalidValue = null,
        string sourceLine = null,
        int lineNumber = -1,
        int columnNumber = -1,           // NEW
        string groupPath = "root")       // NEW
        : base(FormatMessage(message, propertyName, invalidValue, sourceLine, lineNumber, columnNumber, groupPath))
    {
        PropertyName = propertyName;
        InvalidValue = invalidValue;
        SourceLine = sourceLine;
        LineNumber = lineNumber;
        ColumnNumber = columnNumber;     // NEW
        GroupPath = groupPath;           // NEW
    }
    
    private static string FormatMessage(
        string message, 
        string propertyName, 
        string invalidValue,
        string sourceLine,
        int lineNumber,
        int columnNumber,
        string groupPath)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"[Satie Syntax Error]");
        sb.AppendLine($"  {message}");
        
        // Location information
        if (lineNumber > 0)
        {
            sb.AppendLine();
            sb.Append($"  Location: line {lineNumber}");
            if (groupPath != "root")
                sb.Append($" in group '{groupPath}'");
            sb.AppendLine();
        }
        
        // Source line with pointer
        if (!string.IsNullOrEmpty(sourceLine))
        {
            sb.AppendLine();
            sb.AppendLine($"  {lineNumber,4} | {sourceLine}");
            
            if (columnNumber >= 0)
            {
                int padding = 8 + columnNumber;
                sb.AppendLine($"{new string(' ', padding)}^");
            }
        }
        
        // Property details
        if (!string.IsNullOrEmpty(propertyName))
        {
            sb.AppendLine();
            sb.AppendLine($"  Property: {propertyName}");
            if (!string.IsNullOrEmpty(invalidValue))
                sb.AppendLine($"  Invalid value: '{invalidValue}'");
        }
        
        return sb.ToString();
    }
}
```

#### Example Error Output

Before:
```
Parse error: Invalid volume value
```

After:
```
[Satie Syntax Error]
  Invalid volume value: expected number or range (e.g., 0.5 or 0.5to0.8)

  Location: line 15 in group 'ambient/rain'

    15 | volume abc
               ^

  Property: volume
  Invalid value: 'abc'
```

---

### 1.4 Debugging Utilities

**File**: `Packages/com.satie.lang/Runtime/Core/SatieParser.cs` (add to end)

```csharp
public static class SatieDebugUtils
{
    /// <summary>
    /// Print a visual representation of all statements with hierarchy
    /// </summary>
    public static void PrintStatementTree(List<Statement> statements)
    {
        Debug.Log("=== Satie Statement Tree ===");
        
        foreach (var stmt in statements)
        {
            string indent = new string(' ', stmt.NestingDepth * 2);
            string location = $"[L{stmt.LineNumber}]";
            string path = stmt.GroupPath != "root" ? $"/{stmt.GroupPath}" : "";
            
            Debug.Log($"{location,-6} {indent}{stmt.kind} \"{stmt.clip}\"{path}");
            
            // Show inherited properties
            if (stmt.InheritedProperties.Count > 0)
            {
                foreach (var kv in stmt.InheritedProperties)
                {
                    Debug.Log($"        {indent}  ↳ {kv.Key}: {kv.Value}");
                }
            }
        }
    }
    
    /// <summary>
    /// Generate a detailed report of a statement
    /// </summary>
    public static string GetStatementReport(Statement stmt)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Statement: {stmt.kind} \"{stmt.clip}\"");
        sb.AppendLine($"  Location: {stmt.GetLocationDescription()}");
        sb.AppendLine($"  Source: {stmt.SourceLine}");
        sb.AppendLine($"  Group Path: {stmt.GroupPath}");
        sb.AppendLine($"  Nesting Depth: {stmt.NestingDepth}");
        
        if (stmt.InheritedProperties.Count > 0)
        {
            sb.AppendLine($"  Inherited Properties:");
            foreach (var kv in stmt.InheritedProperties)
            {
                sb.AppendLine($"    - {kv.Key}: {kv.Value}");
            }
        }
        
        return sb.ToString();
    }
    
    /// <summary>
    /// Validate statement locations are set correctly
    /// </summary>
    public static bool ValidateStatementMetadata(List<Statement> statements, out List<string> errors)
    {
        errors = new List<string>();
        
        foreach (var stmt in statements)
        {
            if (stmt.LineNumber < 0)
                errors.Add($"Statement '{stmt.clip}' has invalid line number: {stmt.LineNumber}");
            
            if (string.IsNullOrEmpty(stmt.SourceLine))
                errors.Add($"Statement '{stmt.clip}' at line {stmt.LineNumber} has no source line");
            
            if (stmt.NestingDepth < 0)
                errors.Add($"Statement '{stmt.clip}' has invalid nesting depth: {stmt.NestingDepth}");
        }
        
        return errors.Count == 0;
    }
}
```

---

### 1.5 VS Code Extension Integration

**File**: `Tools~/vscode-satie/src/diagnostics.ts`

#### Use Statement Metadata for Diagnostics

```typescript
// Parse script and get statements with location info
const parseResult = await parseSatieScript(document.getText());

if (parseResult.errors.length > 0) {
    parseResult.errors.forEach(error => {
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(
                error.lineNumber - 1,  // Use from Statement.LineNumber
                error.columnStart,     // Use from Statement.ColumnStart
                error.lineNumber - 1,
                error.columnEnd        // Use from Statement.ColumnEnd
            ),
            error.message,
            vscode.DiagnosticSeverity.Error
        );
        
        // Add related information showing group context
        if (error.groupPath !== 'root') {
            diagnostic.relatedInformation = [
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(document.uri, new vscode.Position(0, 0)),
                    `In group: ${error.groupPath}`
                )
            ];
        }
        
        diagnostics.push(diagnostic);
    });
}
```

---

### 1.6 Testing Plan

#### Unit Tests

**File**: `Packages/com.satie.lang/Tests/Runtime/ParserMetadataTests.cs`

```csharp
using NUnit.Framework;
using Satie;

public class ParserMetadataTests
{
    [Test]
    public void Statement_HasCorrectLineNumber()
    {
        string script = @"
loop ""clip1""
    volume 0.5

oneshot ""clip2""
    volume 0.8
";
        
        var statements = SatieParser.Parse(script);
        
        Assert.AreEqual(2, statements[0].LineNumber, "First statement should be at line 2");
        Assert.AreEqual(5, statements[1].LineNumber, "Second statement should be at line 5");
    }
    
    [Test]
    public void Statement_TracksGroupPath()
    {
        string script = @"
group ambient
    loop ""rain""
        
    group wind
        loop ""wind""
";
        
        var statements = SatieParser.Parse(script);
        
        Assert.AreEqual("ambient", statements[0].GroupPath);
        Assert.AreEqual("ambient/wind", statements[1].GroupPath);
    }
    
    [Test]
    public void Statement_TracksNestingDepth()
    {
        string script = @"
loop ""root""

group level1
    loop ""l1""
    
    group level2
        loop ""l2""
";
        
        var statements = SatieParser.Parse(script);
        
        Assert.AreEqual(0, statements[0].NestingDepth, "Root level should be depth 0");
        Assert.AreEqual(1, statements[1].NestingDepth, "First group level should be depth 1");
        Assert.AreEqual(2, statements[2].NestingDepth, "Nested group should be depth 2");
    }
    
    [Test]
    public void Statement_TracksInheritedProperties()
    {
        string script = @"
group ambient
    volume 0.5
    reverb wet 0.3
    
    loop ""rain""
";
        
        var statements = SatieParser.Parse(script);
        var stmt = statements[0];
        
        Assert.IsTrue(stmt.InheritedProperties.ContainsKey("volume"));
        Assert.IsTrue(stmt.InheritedProperties.ContainsKey("reverb"));
    }
    
    [Test]
    public void Error_IncludesLocationContext()
    {
        string script = @"
loop ""clip""
    volume invalid
";
        
        var ex = Assert.Throws<SatieSyntaxException>(() => SatieParser.Parse(script));
        
        Assert.AreEqual(3, ex.LineNumber);
        Assert.AreEqual("volume", ex.PropertyName);
        StringAssert.Contains("line 3", ex.Message);
    }
}
```

#### Integration Tests

**File**: `Packages/com.satie.lang/Tests/Runtime/ParserIntegrationTests.cs`

```csharp
[Test]
public void ComplexScript_PreservesAllMetadata()
{
    string script = System.IO.File.ReadAllText("Assets/Tests/complex_script.sat");
    
    var statements = SatieParser.Parse(script);
    
    // Validate all statements have metadata
    var errors = new List<string>();
    bool valid = SatieDebugUtils.ValidateStatementMetadata(statements, out errors);
    
    Assert.IsTrue(valid, $"Metadata validation failed:\n{string.Join("\n", errors)}");
}
```

---

### 1.7 Documentation Updates

#### Update README.md

Add section on error messages:

```markdown
## Enhanced Error Messages

Satie provides detailed error context when parsing fails:

```satie
group ambient
    loop "rain"
        volume abc  # Invalid!
```

Error output:
```
[Satie Syntax Error]
  Invalid volume value: expected number or range (e.g., 0.5 or 0.5to0.8)

  Location: line 3 in group 'ambient'

     3 | volume abc
              ^

  Property: volume
  Invalid value: 'abc'
```
```

#### Add Debugging Guide

**File**: `Docs/debugging.md`

```markdown
# Debugging Satie Scripts

## Viewing Statement Tree

In Unity editor, enable debug mode to see statement hierarchy:

```csharp
var statements = SatieParser.Parse(scriptText);
SatieDebugUtils.PrintStatementTree(statements);
```

Output:
```
=== Satie Statement Tree ===
[L2]   loop "background" /root
[L5]   loop "rain" /ambient
         ↳ volume: 0.5 (from group 'ambient')
[L8]     oneshot "thunder" /ambient/weather
           ↳ volume: 0.5 (from group 'ambient')
           ↳ reverb: wet 0.7 (from group 'weather')
```

## Statement Location Info

Every statement tracks its source location:

```csharp
foreach (var stmt in statements)
{
    Debug.Log($"{stmt.kind} at {stmt.GetLocationDescription()}");
    Debug.Log(stmt.GetErrorContext());
}
```
```

---

## Phase 2: Full AST Implementation (Future)

### Objectives
1. Support control flow (if/else, loops, functions)
2. Enable advanced IDE features (refactoring, symbol navigation)
3. Allow multi-pass optimization
4. Support macros and code generation

### Timeline
**Estimated effort**: 2-3 weeks  
**Priority**: Low (defer until needed)  
**Trigger conditions**:
- Adding conditionals to language
- Adding variable support
- Building advanced refactoring tools

---

### 2.1 AST Node Hierarchy

**File**: `Packages/com.satie.lang/Runtime/Core/AST/ASTNode.cs`

```csharp
using System.Collections.Generic;

namespace Satie.AST
{
    /// <summary>
    /// Base class for all AST nodes
    /// </summary>
    public abstract class ASTNode
    {
        public int LineNumber { get; set; }
        public int ColumnStart { get; set; }
        public int ColumnEnd { get; set; }
        public string SourceLine { get; set; }
        
        /// <summary>
        /// Accept a visitor (Visitor pattern for tree traversal)
        /// </summary>
        public abstract T Accept<T>(IASTVisitor<T> visitor);
        
        /// <summary>
        /// Get source location description
        /// </summary>
        public string GetLocation() => $"line {LineNumber}, column {ColumnStart}";
    }
    
    /// <summary>
    /// Root node of the AST
    /// </summary>
    public class ProgramNode : ASTNode
    {
        public List<ASTNode> Statements { get; set; } = new();
        
        public override T Accept<T>(IASTVisitor<T> visitor) => visitor.Visit(this);
    }
    
    /// <summary>
    /// Group statement (contains multiple children)
    /// </summary>
    public class GroupNode : ASTNode
    {
        public string Name { get; set; }
        public Dictionary<string, string> Properties { get; set; } = new();
        public List<ASTNode> Children { get; set; } = new();
        
        public override T Accept<T>(IASTVisitor<T> visitor) => visitor.Visit(this);
    }
    
    /// <summary>
    /// Audio statement (loop/oneshot)
    /// </summary>
    public class StatementNode : ASTNode
    {
        public string Kind { get; set; }  // "loop" or "oneshot"
        public string Clip { get; set; }
        public int Count { get; set; } = 1;
        public Dictionary<string, object> Properties { get; set; } = new();
        
        public override T Accept<T>(IASTVisitor<T> visitor) => visitor.Visit(this);
    }
    
    /// <summary>
    /// Conditional statement (future)
    /// </summary>
    public class IfNode : ASTNode
    {
        public ExpressionNode Condition { get; set; }
        public List<ASTNode> ThenBranch { get; set; } = new();
        public List<ASTNode> ElseBranch { get; set; } = new();
        
        public override T Accept<T>(IASTVisitor<T> visitor) => visitor.Visit(this);
    }
    
    /// <summary>
    /// Repeat statement (future)
    /// </summary>
    public class RepeatNode : ASTNode
    {
        public ExpressionNode Count { get; set; }
        public List<ASTNode> Body { get; set; } = new();
        
        public override T Accept<T>(IASTVisitor<T> visitor) => visitor.Visit(this);
    }
    
    /// <summary>
    /// Expression node (for conditionals, variables, etc.)
    /// </summary>
    public abstract class ExpressionNode : ASTNode
    {
        // Subclasses: LiteralNode, VariableNode, BinaryOpNode, etc.
    }
    
    public class LiteralNode : ExpressionNode
    {
        public object Value { get; set; }
        
        public override T Accept<T>(IASTVisitor<T> visitor) => visitor.Visit(this);
    }
    
    public class VariableNode : ExpressionNode
    {
        public string Name { get; set; }
        
        public override T Accept<T>(IASTVisitor<T> visitor) => visitor.Visit(this);
    }
}
```

---

### 2.2 Visitor Pattern

**File**: `Packages/com.satie.lang/Runtime/Core/AST/IASTVisitor.cs`

```csharp
namespace Satie.AST
{
    /// <summary>
    /// Visitor interface for traversing AST
    /// </summary>
    public interface IASTVisitor<T>
    {
        T Visit(ProgramNode node);
        T Visit(GroupNode node);
        T Visit(StatementNode node);
        T Visit(IfNode node);
        T Visit(RepeatNode node);
        T Visit(LiteralNode node);
        T Visit(VariableNode node);
    }
    
    /// <summary>
    /// Base visitor with default implementations
    /// </summary>
    public abstract class ASTVisitorBase<T> : IASTVisitor<T>
    {
        public virtual T Visit(ProgramNode node)
        {
            foreach (var child in node.Statements)
                child.Accept(this);
            return default(T);
        }
        
        public virtual T Visit(GroupNode node)
        {
            foreach (var child in node.Children)
                child.Accept(this);
            return default(T);
        }
        
        public abstract T Visit(StatementNode node);
        public abstract T Visit(IfNode node);
        public abstract T Visit(RepeatNode node);
        public abstract T Visit(LiteralNode node);
        public abstract T Visit(VariableNode node);
    }
}
```

---

### 2.3 Recursive Descent Parser

**File**: `Packages/com.satie.lang/Runtime/Core/AST/SatieASTParser.cs`

```csharp
using System;
using System.Collections.Generic;
using Satie.AST;

namespace Satie
{
    /// <summary>
    /// Recursive descent parser that builds AST
    /// </summary>
    public class SatieASTParser
    {
        private string[] lines;
        private int currentLine;
        
        public ProgramNode Parse(string script)
        {
            lines = script.Replace("\r\n", "\n").Split('\n');
            currentLine = 0;
            
            var program = new ProgramNode();
            
            while (currentLine < lines.Length)
            {
                var node = ParseTopLevel();
                if (node != null)
                    program.Statements.Add(node);
                
                currentLine++;
            }
            
            return program;
        }
        
        private ASTNode ParseTopLevel()
        {
            string line = GetCurrentLine();
            
            if (IsGroupStart(line))
                return ParseGroup();
            
            if (IsStatement(line))
                return ParseStatement();
            
            // Comment, empty line, etc.
            return null;
        }
        
        private GroupNode ParseGroup()
        {
            string line = GetCurrentLine();
            int indent = GetIndent(line);
            
            var group = new GroupNode
            {
                Name = ExtractGroupName(line),
                LineNumber = currentLine + 1,
                SourceLine = line
            };
            
            currentLine++;
            
            // Parse group properties and children
            while (currentLine < lines.Length)
            {
                string childLine = GetCurrentLine();
                int childIndent = GetIndent(childLine);
                
                // End of group
                if (childIndent <= indent && !string.IsNullOrWhiteSpace(childLine))
                {
                    currentLine--; // Back up for parent parser
                    break;
                }
                
                if (IsProperty(childLine))
                {
                    var (key, value) = ParseProperty(childLine);
                    group.Properties[key] = value;
                }
                else if (IsStatement(childLine))
                {
                    var stmt = ParseStatement();
                    group.Children.Add(stmt);
                }
                else if (IsGroupStart(childLine))
                {
                    var nestedGroup = ParseGroup();
                    group.Children.Add(nestedGroup);
                }
                
                currentLine++;
            }
            
            return group;
        }
        
        private StatementNode ParseStatement()
        {
            // Implementation similar to current ParseSingle
            // but builds StatementNode instead of Statement
            
            string line = GetCurrentLine();
            var stmt = new StatementNode
            {
                LineNumber = currentLine + 1,
                SourceLine = line
            };
            
            // Parse kind, clip, count, properties...
            
            return stmt;
        }
        
        // Helper methods...
        private string GetCurrentLine() => 
            currentLine < lines.Length ? lines[currentLine] : string.Empty;
        
        private int GetIndent(string line)
        {
            int n = 0;
            while (n < line.Length && (line[n] == ' ' || line[n] == '\t')) n++;
            return n;
        }
        
        private bool IsGroupStart(string line) => 
            line.TrimStart().StartsWith("group ", StringComparison.OrdinalIgnoreCase);
        
        private bool IsStatement(string line) =>
            line.TrimStart().StartsWith("loop ") || line.TrimStart().StartsWith("oneshot ");
        
        private bool IsProperty(string line) =>
            !IsGroupStart(line) && !IsStatement(line) && !string.IsNullOrWhiteSpace(line);
        
        private string ExtractGroupName(string line) =>
            line.TrimStart().Substring(6).Trim();
        
        private (string key, string value) ParseProperty(string line)
        {
            var parts = line.Trim().Split(new[] { ' ' }, 2);
            return (parts[0].ToLower(), parts.Length > 1 ? parts[1] : "");
        }
    }
}
```

---

### 2.4 Code Generator (AST → Statement List)

**File**: `Packages/com.satie.lang/Runtime/Core/AST/StatementGenerator.cs`

```csharp
using System.Collections.Generic;
using Satie.AST;

namespace Satie
{
    /// <summary>
    /// Generates flat Statement list from AST
    /// </summary>
    public class StatementGenerator : IASTVisitor<List<Statement>>
    {
        private SatieRandom random;
        private Stack<Dictionary<string, string>> propertyStack = new();
        
        public StatementGenerator(SatieRandom random)
        {
            this.random = random;
            propertyStack.Push(new Dictionary<string, string>());
        }
        
        public List<Statement> Visit(ProgramNode node)
        {
            var result = new List<Statement>();
            
            foreach (var child in node.Statements)
            {
                result.AddRange(child.Accept(this));
            }
            
            return result;
        }
        
        public List<Statement> Visit(GroupNode node)
        {
            var result = new List<Statement>();
            
            // Push group properties onto stack
            var groupProps = new Dictionary<string, string>(propertyStack.Peek());
            foreach (var kv in node.Properties)
                groupProps[kv.Key] = kv.Value;
            propertyStack.Push(groupProps);
            
            // Generate statements for children
            foreach (var child in node.Children)
            {
                result.AddRange(child.Accept(this));
            }
            
            // Pop group properties
            propertyStack.Pop();
            
            return result;
        }
        
        public List<Statement> Visit(StatementNode node)
        {
            // Convert AST node to Statement object
            var stmt = new Statement
            {
                kind = node.Kind,
                clip = node.Clip,
                count = node.Count,
                LineNumber = node.LineNumber,
                SourceLine = node.SourceLine
            };
            
            // Apply properties from stack (inherited from groups)
            foreach (var kv in propertyStack.Peek())
            {
                ApplyProperty(stmt, kv.Key, kv.Value);
            }
            
            // Apply statement's own properties
            foreach (var kv in node.Properties)
            {
                ApplyProperty(stmt, kv.Key, kv.Value.ToString());
            }
            
            return new List<Statement> { stmt };
        }
        
        public List<Statement> Visit(IfNode node)
        {
            // Evaluate condition
            bool condition = EvaluateCondition(node.Condition);
            
            var branch = condition ? node.ThenBranch : node.ElseBranch;
            var result = new List<Statement>();
            
            foreach (var child in branch)
            {
                result.AddRange(child.Accept(this));
            }
            
            return result;
        }
        
        public List<Statement> Visit(RepeatNode node)
        {
            int count = EvaluateCount(node.Count);
            var result = new List<Statement>();
            
            for (int i = 0; i < count; i++)
            {
                foreach (var child in node.Body)
                {
                    result.AddRange(child.Accept(this));
                }
            }
            
            return result;
        }
        
        public List<Statement> Visit(LiteralNode node)
        {
            // Literals don't generate statements
            return new List<Statement>();
        }
        
        public List<Statement> Visit(VariableNode node)
        {
            // Variables don't generate statements
            return new List<Statement>();
        }
        
        // Helper methods
        private void ApplyProperty(Statement stmt, string key, string value)
        {
            // Same logic as current property parsing
            switch (key)
            {
                case "volume":
                    stmt.volume = RangeOrValue.Parse(value);
                    break;
                case "pitch":
                    stmt.pitch = RangeOrValue.Parse(value);
                    break;
                // ... etc
            }
        }
        
        private bool EvaluateCondition(ExpressionNode expr)
        {
            // Evaluate expression to boolean
            // Will need expression evaluator
            return true; // Placeholder
        }
        
        private int EvaluateCount(ExpressionNode expr)
        {
            // Evaluate expression to int
            return 1; // Placeholder
        }
    }
}
```

---

### 2.5 Backward Compatibility Layer

**File**: `Packages/com.satie.lang/Runtime/Core/SatieParser.cs` (update)

```csharp
public static class SatieParser
{
    // ===== LEGACY API (unchanged) =====
    
    /// <summary>
    /// Parse script to flat statement list (legacy API, maintained for compatibility)
    /// </summary>
    public static List<Statement> Parse(string script)
    {
        // Use new AST parser internally
        var ast = ParseToAST(script);
        
        // Generate flat list from AST
        var random = new SatieRandom(0); // Seed doesn't matter for parsing
        var generator = new StatementGenerator(random);
        
        return ast.Accept(generator);
    }
    
    // ===== NEW API =====
    
    /// <summary>
    /// Parse script to AST (new API for advanced use cases)
    /// </summary>
    public static ProgramNode ParseToAST(string script)
    {
        var parser = new SatieASTParser();
        return parser.Parse(script);
    }
    
    /// <summary>
    /// Generate statements from AST with specific random seed
    /// </summary>
    public static List<Statement> CompileAST(ProgramNode ast, SatieRandom random)
    {
        var generator = new StatementGenerator(random);
        return ast.Accept(generator);
    }
}
```

---

### 2.6 Advanced Features Enabled by AST

#### 2.6.1 Conditionals

```satie
# Future syntax
$time_of_day = "night"

if $time_of_day == "night"
    loop "crickets"
        volume 0.8
else
    loop "birds"
        volume 0.6
```

#### 2.6.2 Variables

```satie
$base_volume = 0.5
$room_size = 0.8

loop "ambient"
    volume $base_volume
    reverb wet 0.5 size $room_size
```

#### 2.6.3 Loops

```satie
repeat 5
    oneshot "beep"
        start $i * 0.5  # $i = iteration counter
```

#### 2.6.4 Functions/Macros

```satie
macro impact(vol, pitch)
    oneshot "impact"
        volume $vol
        pitch $pitch
        reverb wet 0.3

impact(0.5, 1.0)
impact(0.8, 0.9)
```

---

### 2.7 Testing Strategy for Phase 2

#### Unit Tests

```csharp
[Test]
public void AST_ParsesNestedGroups()
{
    string script = @"
group outer
    group inner
        loop ""clip""
";
    
    var ast = SatieParser.ParseToAST(script);
    
    Assert.AreEqual(1, ast.Statements.Count);
    Assert.IsInstanceOf<GroupNode>(ast.Statements[0]);
    
    var outer = (GroupNode)ast.Statements[0];
    Assert.AreEqual(1, outer.Children.Count);
    Assert.IsInstanceOf<GroupNode>(outer.Children[0]);
}

[Test]
public void AST_GeneratesCorrectStatements()
{
    string script = @"
group ambient
    volume 0.5
    loop ""rain""
";
    
    var ast = SatieParser.ParseToAST(script);
    var random = new SatieRandom(42);
    var statements = SatieParser.CompileAST(ast, random);
    
    Assert.AreEqual(1, statements.Count);
    Assert.AreEqual("loop", statements[0].kind);
    Assert.AreEqual("rain", statements[0].clip);
    Assert.AreEqual(0.5f, statements[0].volume.min);
}
```

#### Backward Compatibility Tests

```csharp
[Test]
public void LegacyParse_StillWorks()
{
    string script = @"
loop ""clip1""
    volume 0.5
";
    
    // Old API should still work
    var statements = SatieParser.Parse(script);
    
    Assert.AreEqual(1, statements.Count);
    Assert.AreEqual("loop", statements[0].kind);
}
```

---

## Migration Timeline

### Phase 1 (Immediate - 2-3 days)

**Week 1:**
- [ ] Day 1: Add metadata fields to Statement class
- [ ] Day 2: Update Parse() to track locations and group paths
- [ ] Day 3: Enhance error messages, add debug utils, write tests

**Deliverables:**
- Enhanced Statement class with location metadata
- Improved error messages with source context
- Debug utilities for statement inspection
- Unit tests for metadata tracking

### Phase 2 (Deferred - When Needed)

**Week 1-2: AST Foundation**
- [ ] Define AST node hierarchy
- [ ] Implement visitor pattern
- [ ] Write recursive descent parser
- [ ] Create backward compatibility layer

**Week 3: Code Generation**
- [ ] Implement StatementGenerator visitor
- [ ] Add property inheritance logic
- [ ] Test AST → Statement compilation

**Future: Advanced Features**
- [ ] Add conditional nodes (if/else)
- [ ] Add repeat/loop nodes
- [ ] Add variable/expression support
- [ ] Add macro/function support

---

## Success Criteria

### Phase 1
- ✅ All statements have valid line numbers
- ✅ Group hierarchy is preserved in GroupPath
- ✅ Error messages show source location and context
- ✅ No performance regression (<5% slower parsing)
- ✅ 100% backward compatible with existing scripts

### Phase 2
- ✅ AST correctly represents all language constructs
- ✅ Legacy Parse() API still works (calls AST internally)
- ✅ New ParseToAST() API available for advanced use
- ✅ Statement generation produces identical results to old parser
- ✅ Foundation ready for control flow features

---

## Risk Mitigation

### Phase 1 Risks

| Risk | Mitigation |
|------|------------|
| Performance regression | Benchmark before/after, optimize hot paths |
| Breaking changes in Statement | Add new fields only, no removals |
| Metadata accuracy | Extensive unit tests for edge cases |

### Phase 2 Risks

| Risk | Mitigation |
|------|------------|
| Breaking existing code | Maintain backward compatibility layer |
| Increased complexity | Thorough documentation, clear examples |
| Incomplete migration | Phase 2 is optional, Phase 1 stands alone |

---

## Appendix: Example Outputs

### Before Phase 1

**Script:**
```satie
loop "rain"
    volume abc
```

**Error:**
```
Parse error: Invalid volume value
```

### After Phase 1

**Script:**
```satie
group ambient
    loop "rain"
        volume abc
```

**Error:**
```
[Satie Syntax Error]
  Invalid volume value: expected number or range (e.g., 0.5 or 0.5to0.8)

  Location: line 3 in group 'ambient'

     3 | volume abc
              ^

  Property: volume
  Invalid value: 'abc'
```

**Debug Output:**
```
=== Satie Statement Tree ===
[L3]     loop "rain" /ambient
           ↳ volume: inherited (invalid)
           ↳ reverb: 0.5 (from group 'ambient')
```

---

## Conclusion

This hybrid approach gives Satie:
- **Immediate benefits**: Better errors, debugging, IDE support (Phase 1)
- **Future-proof foundation**: Ready for control flow when needed (Phase 2)
- **Backward compatibility**: Existing code keeps working
- **Low risk**: Phase 1 is additive only, Phase 2 is optional

Phase 1 should be implemented immediately for improved developer experience. Phase 2 should wait until control flow features are actually needed.
