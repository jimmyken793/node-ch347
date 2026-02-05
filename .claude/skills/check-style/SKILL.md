---
name: check-style
description: Analyze codebase for API consistency, common interface extraction opportunities, and coding style issues. Use when reviewing code quality or before major refactoring.
allowed-tools: Read, Grep, Glob
---

# Coding Style Checker

Analyze this codebase for API consistency and design pattern adherence. Generate a comprehensive report.

## Analysis Checklist

### 1. Backend Interface Consistency

Compare implementations against the interface definition:

**Files to examine:**
- `src/backend.ts` - The canonical interface definition
- `src/backend-libusb.ts` - LibUSB backend implementation
- `src/backend-wch.ts` - WCH DLL backend implementation

**Check for:**
- [ ] All interface methods are implemented in both backends
- [ ] Method signatures match exactly (parameters, return types)
- [ ] Error handling follows consistent patterns (same error messages/types)
- [ ] Optional methods are handled consistently (throw vs return null)
- [ ] Async/await patterns are used consistently

**Report any:**
- Methods that exist in one backend but not the other
- Different parameter names or types for the same method
- Inconsistent return value shapes
- Platform-specific behavior not documented in the interface

### 2. Common Interface Extraction

Scan for opportunities to extract shared interfaces:

**Files to examine:**
- `src/types.ts` - Central type definitions
- All `src/*.ts` files - Look for inline type definitions

**Check for:**
- [ ] Duplicate type definitions across files
- [ ] Similar structures that could share a base interface
- [ ] Inline object types that should be extracted to `types.ts`
- [ ] Generic patterns that could use TypeScript generics

**Report any:**
- Types defined in multiple places
- Similar types with minor differences (candidates for union/base types)
- Anonymous types in function signatures that repeat

### 3. Output Format Normalization

Verify backends produce consistent output formats:

**Check for:**
- [ ] Both backends return identical data structures for the same operations
- [ ] Numeric values use consistent units (e.g., always bytes, always milliseconds)
- [ ] Boolean flags follow same semantics
- [ ] Arrays/collections have same ordering guarantees
- [ ] Null vs undefined is handled consistently

**Report any:**
- Platform-specific return value differences
- Different data shapes for logically equivalent operations
- Missing normalization of vendor-specific responses

### 4. Special Case Containment

Verify platform-specific code is properly encapsulated:

**Check for:**
- [ ] Windows-specific code is contained in WCH backend
- [ ] Linux/macOS-specific code is contained in LibUSB backend
- [ ] Platform checks don't leak into the main API (`index.ts`)
- [ ] Fallback behaviors are documented

**Report any:**
- Platform conditionals in the wrong layer
- Implementation details leaking through the facade
- Undocumented behavioral differences between backends

### 5. API Surface Consistency

Review the public API for consistency:

**Files to examine:**
- `src/index.ts` - Main exported API

**Check for:**
- [ ] Method naming follows consistent conventions (camelCase, verb-first)
- [ ] Similar operations have similar signatures
- [ ] Options objects follow consistent patterns
- [ ] Callbacks/promises are used consistently

## Report Format

Generate a report with the following sections:

```markdown
# Coding Style Check Report

## Summary
- Total issues found: X
- Critical (breaks API contract): X
- Warning (inconsistency): X
- Info (improvement opportunity): X

## Critical Issues
[List any issues that could cause runtime errors or break the API contract]

## Warnings
[List inconsistencies that should be addressed]

## Improvement Opportunities
[List suggestions for better interface extraction or normalization]

## Files Analyzed
[List all files examined with line counts]
```

## Specific Patterns for This Codebase

This codebase uses a **pluggable backend architecture**. Key patterns to verify:

1. **CH347Backend interface** (`backend.ts`) defines the contract
2. **LibUSBBackend** and **WCHBackend** must implement it identically
3. **CH347Device** (`index.ts`) is the facade that delegates to backends
4. **Types** should be centralized in `types.ts`

Focus on:
- GPIO operations: `gpioRead`, `gpioWrite`, `gpioReadAll`, `gpioPulse`, `gpioToggle`
- SPI operations: `spiInit`, `spiTransfer`, `spiSendCommand`, `spiBulkRead`
- Flash operations: all methods starting with `flash*`
- Device lifecycle: `open`, `close`, `isConnected`
