# Technical Debt

This document tracks known technical limitations and areas for future improvement.

---

## TUI Chart Background Color Mismatch

**Status:** Open
**Priority:** Low
**Effort:** Medium to High
**Created:** 2026-02-09

### Problem Statement

The TUI chart background color renders as `#1e1e1e` (RGB 30, 30, 30) instead of the desired Catppuccin Mocha Base color `#1e1e2e` (RGB 30, 30, 46). This creates a visual inconsistency where the chart interior appears slightly darker than the surrounding UI elements.

**Visual Impact:**
- Difference: 16/255 (6.3%) in the blue channel only
- Chart area appears subtly darker than the rest of the UI
- Noticeable when viewing the app, though the difference is minimal

### Root Cause

The issue stems from plotext's terminal rendering pipeline:

1. **ANSI Color Code Generation**
   Plotext converts color specifications (hex, RGB, color names) into ANSI terminal escape codes for terminal compatibility.

2. **Limited ANSI 256 Color Palette**
   The ANSI 256-color palette does not include `#1e1e2e` (RGB 30, 30, 46). The closest available colors are:
   - ANSI 234: RGB(28, 28, 28) - too dark
   - ANSI 235: RGB(38, 38, 38) - too light and too gray

3. **Color Quantization**
   When plotext converts `#1e1e2e` to ANSI codes, it gets quantized to the nearest available color. During this conversion, the blue component (46) is lost, resulting in a neutral gray.

4. **Textual's ANSI Interpretation**
   Textual/Rich interprets the ANSI codes and renders them to SVG (for screenshots) or terminal display. The rendered color is `#1e1e1e` rather than the requested `#1e1e2e`.

5. **canvas_color() Limitation**
   Plotext's `canvas_color()` function sets the background color for the entire plot area, but this setting goes through the ANSI conversion pipeline. There is no way to bypass this conversion and set raw RGB values directly in the terminal output.

### What Was Tried

All attempts were documented in `TUI_COLOR_FIX_SUMMARY.md`. Summary of approaches:

| Approach | Method | Result |
|----------|--------|--------|
| Hex string | `canvas_color("#1e1e2e")` | ❌ Rendered as #1e1e1e |
| RGB tuple | `canvas_color((30, 30, 46))` | ❌ Rendered as #1e1e1e |
| ANSI color code | `canvas_color(235)` | ❌ Wrong shade |
| "default" | `canvas_color("default")` | ❌ No effect |
| Before/after theme | Set canvas_color multiple times | ❌ No effect |
| Background fill | Plot invisible filled area | ❌ No effect |
| CSS override | PlotextPlot widget background | ❌ ANSI codes override CSS |

**Conclusion:** The limitation is in plotext's core ANSI generation, not in how we're calling it.

### Potential Solutions

#### Option 1: Fork and Patch Plotext (Medium Effort)

**Approach:**
Fork the plotext library and modify its ANSI code generation to:
- Add support for true-color (24-bit) ANSI escape sequences
- Allow bypassing color quantization for specific use cases
- Expose a "raw ANSI" mode that accepts pre-formatted escape codes

**Pros:**
- Full control over color rendering
- Could be contributed back to upstream plotext
- Would benefit other users with similar needs

**Cons:**
- Maintenance burden of maintaining a fork
- Need to track upstream changes
- May not be accepted by upstream maintainers
- True-color support isn't universal across all terminals

**Estimated Effort:** 2-3 days
- 1 day: Study plotext internals and ANSI generation
- 1 day: Implement true-color support
- 0.5 day: Testing and integration
- 0.5 day: Documentation

#### Option 2: Modify textual-plotext Widget (Low-Medium Effort)

**Approach:**
Create a custom Textual widget that:
- Intercepts plotext's terminal output (ANSI codes)
- Post-processes the ANSI escape sequences
- Replaces specific color codes with desired RGB values

**Pros:**
- No need to fork plotext
- Textual-specific solution
- Can be implemented as a custom widget class

**Cons:**
- Brittle - depends on ANSI code format
- May break if plotext changes output format
- Only fixes the issue in Textual (not in actual terminal)

**Estimated Effort:** 1-2 days
- 0.5 day: Study textual-plotext rendering pipeline
- 1 day: Implement ANSI code interception and replacement
- 0.5 day: Testing

#### Option 3: Replace Plotext with Alternative Library (High Effort)

**Approach:**
Replace plotext with a different terminal plotting library that offers better color control:
- **matplotlib with termplotlib**: More complex but full RGB support
- **plotille**: Lightweight with better color handling
- **Rich's built-in charting**: Limited but integrates well with Textual
- **Custom ASCII/Braille renderer**: Full control but high effort

**Pros:**
- Potential for better features overall
- Full color control
- May offer better chart types or interactivity

**Cons:**
- High migration effort
- Need to rewrite all chart rendering code
- Learning curve for new library
- May lose plotext's simplicity

**Estimated Effort:** 3-5 days
- 1 day: Evaluate and choose replacement library
- 2 days: Rewrite chart rendering for all metric types
- 1 day: Testing and refinement
- 1 day: Polish and edge cases

#### Option 4: Accept and Document (Current Approach) (No Effort)

**Approach:**
Accept the limitation and document it clearly for users.

**Pros:**
- No development effort
- Focuses energy on more impactful features
- Difference is subtle in practice

**Cons:**
- Visual inconsistency remains
- May bother users who notice it

**Estimated Effort:** 0 days (already done)

#### Option 5: Change UI Color Scheme to Match (Low Effort)

**Approach:**
Change the entire UI to use `#1e1e1e` instead of `#1e1e2e` for consistency.

**Pros:**
- Quick fix
- Guaranteed consistency
- No library modifications needed

**Cons:**
- Deviates from Catppuccin Mocha theme
- Darker overall appearance
- Doesn't solve the root cause

**Estimated Effort:** 0.5 days
- 0.25 day: Update all color references in CSS
- 0.25 day: Test and verify consistency

### Recommendation

**Short-term (Current):** Option 4 - Accept and document
The visual difference is minimal and doesn't impact functionality. Development effort is better spent on features.

**Long-term (Future):** Option 1 - Fork and patch plotext
If this becomes a user complaint or if we need true-color support for other reasons, forking plotext and adding 24-bit color support would be the most robust solution. This could potentially be contributed back to the upstream project.

**Alternative Future:** Option 3 - Replace plotext
If plotext becomes limiting in other ways (limited chart types, poor performance, etc.), replacing it entirely would address this issue as a side effect.

### Impact Assessment

**User Impact:** Low
- Visual inconsistency is subtle
- Does not affect functionality
- Most users unlikely to notice without side-by-side comparison

**Developer Impact:** Low
- Well-documented limitation
- Workarounds are known if needed
- Doesn't block other development

**Business Impact:** None
- No effect on core functionality
- No user complaints received
- Not a blocker for any use cases

### Decision Criteria for Future Action

Consider addressing this issue if:
- [ ] Users file issues/complaints about the visual inconsistency
- [ ] We need true-color support for other charting features
- [ ] Plotext becomes limiting in other ways (justifying replacement)
- [ ] The app is being used in a context where visual polish is critical
- [ ] We have spare development capacity and no higher-priority items

### References

- **Color fix summary:** `TUI_COLOR_FIX_SUMMARY.md`
- **Commit:** c45f063 "Fix TUI chart colors and improve background consistency"
- **Plotext repo:** https://github.com/piccolomo/plotext
- **Textual-plotext repo:** https://github.com/Textualize/textual-plotext
- **Catppuccin Mocha palette:** https://github.com/catppuccin/catppuccin

### Related Issues

None currently.

---

## Future Tech Debt Items

_Additional technical debt items will be added here as they are identified._
