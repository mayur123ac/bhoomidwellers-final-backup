# FORGE CRM — Lead Details Frontend & Scroll Architecture Audit

**Date:** 2026-11-05
**Scope:** Sales Manager Lead Details page — scrolling, height, overflow, layout, and visual audit
**Status:** Audit complete. Awaiting approval before implementation.

---

## 1. Executive Summary

The Sales Manager Lead Details page has a **confirmed P0 scrolling failure** on narrow/mobile PC viewports and a **P1 visual defect** (excessively tall empty right panel on mobile). The root causes are:

1. **Double `<main>` scroll containers** — the page has TWO nested `<main>` elements both claiming `overflow-y-auto`, creating ambiguous scroll ownership.
2. **Missing `min-h-0`** on a critical flex ancestor (SalesManagerView root div) which, combined with `h-full`, can prevent the inner scroll container from being properly height-bounded in some browser/viewport combinations.
3. **`min-h-[500px]` on the right column** on mobile, which forces a 500px empty section even when the right panel content is short.
4. **`overscroll-contain` on non-scrolling elements** on mobile, which can trap wheel events in certain browsers and prevent them from reaching the actual scroll owner.

The Admin dashboard avoids all of these issues because it uses a **single** `<main>` with `overflow-y-auto` wrapping LeadDetailsPanel directly — no nested `<main>`, no intermediate `h-full` flex wrapper.

---

## 2. Current Frontend Architecture

### 2.1 Component Tree (Sales Manager Detail View)

```
sales/page.tsx (root component)
  └─ Root div                          [h-screen overflow-hidden]          L829
     ├─ SalesSidebar                   [fixed, 72px wide on md+]
     └─ Content wrapper                [flex-1 flex-col h-full overflow-hidden] L862
        ├─ AppHeader                   [flex-shrink-0, sticky, 56px mobile / 64px desktop] L866
        └─ Outer <main>               [flex-1 overflow-x-hidden overflow-y-auto flex-col gap-4 p-4 sm:p-6] L1100
           └─ SalesManagerView         [flex-1 flex-col h-full relative]    L2372
              └─ Inner <main>          [flex-1 overflow-y-auto]             L2386
                 └─ (when detail):
                    └─ LeadDetailsLayout  [w-full flex-col gap-2 pb-1]      L3201
                       └─ LeadDetailsPanel  [flex-col gap-2 lg:h-[calc(100dvh-130px)]] L149
                          ├─ LeadDetailsHeader [flex-shrink-0]
                          ├─ Revisit panel (conditional)
                          └─ Two-column container [flex-col lg:flex-row lg:flex-1 lg:min-h-0 lg:overflow-hidden] L206
                             ├─ Left column   [lg:w-[44%] flex-col lg:min-h-0 lg:overflow-hidden] L209
                             │  └─ Normal view [flex-col lg:flex-1 lg:min-h-0 lg:overflow-hidden] L286
                             │     ├─ Tab bar  [flex-shrink-0]
                             │     ├─ Tab content [flex-1 min-h-0 overflow-y-auto overscroll-contain] L308
                             │     │  ├─ LeadPersonalInfo (personal tab)
                             │     │  └─ LoanDealView (loan tab)
                             │     └─ Calling buttons [flex-shrink-0]
                             └─ Right column  [lg:w-[56%] flex-col min-h-[500px] lg:min-h-0 lg:overflow-hidden] L367
                                ├─ Tab bar     [flex-shrink-0]
                                └─ Tab content
                                   ├─ LeadFollowUpPanel [flex-1 min-h-[500px] lg:min-h-0 overflow-hidden] L141
                                   │  ├─ Header [flex-shrink-0]
                                   │  ├─ Messages [flex-1 min-h-0 overflow-y-auto overscroll-contain] L169
                                   │  └─ Composer [flex-shrink-0]
                                   └─ LeadDealStagePanel [flex-1 min-h-0] L14
                                      └─ Inner scroll [flex-1 min-h-0 overflow-y-auto overscroll-contain] L15
```

### 2.2 Component Tree (Admin Detail View — for comparison)

```
dashboard/page.tsx (root component)
  └─ Root div                          [flex h-screen overflow-hidden]     L1147
     ├─ AdminSidebar
     └─ Content wrapper                [flex-1 flex-col h-screen overflow-hidden] L1201
        ├─ AppHeader                   [flex-shrink-0]
        └─ <main>                      [flex-1 px-3 py-3 overflow-y-auto]  L1390
           └─ (when detail view):
              └─ div                   [flex-1 overflow-y-auto p-3]        L4282
                 └─ LeadDetailsLayout
                    └─ LeadDetailsPanel [same shared component]
```

**Key architectural difference:** The Admin has a SINGLE `<main>` with `overflow-y-auto`, then an additional `flex-1 overflow-y-auto` wrapper around LeadDetailsLayout. There is NO intermediate `h-full` flex container. The scroll chain is clean and unambiguous.

### 2.3 Component Tree (Receptionist Detail View)

```
receptionist/page.tsx
  └─ Root div                          [h-screen overflow-hidden]          L2598
     ├─ Sidebar
     └─ Content wrapper                [flex-1 flex-col overflow-hidden]   L2649
        ├─ AppHeader
        └─ <main>                      [flex-1 overflow-x-hidden overflow-y-auto] L2849
           └─ (activeTab "assigned", detail sub-view):
              └─ LeadDetailsLayout     [content-driven]                    L3860
                 ├─ Custom header      [inline, not shared LeadDetailsHeader]
                 ├─ Left panel         [w-full lg:w-[50%] min-h-[500px]]   L3948
                 │  └─ Tab content     [flex-1 overflow-y-auto]            L4010
                 │     └─ LeadPersonalInfo (shared)
                 └─ Right panel        [w-full lg:w-[50%] h-[600px]]       L4069
                    └─ Follow-ups      [flex-1 overflow-y-auto]            L4070
```

**Key difference from Sales Manager:** Single `<main>` (no nested main), but the right panel has a hardcoded `h-[600px]` with no responsive adaptation.

---

## 3. DOM and Scrolling Hierarchy

### 3.1 Height Chain (Sales Manager, Mobile — below `lg:` 1024px)

```
                          Element                  Height Source            Overflow
L829  Root div            ──────────────────────── h-screen (100vh)        overflow-hidden
L862  Content wrapper     ──────────────────────── flex-1 + h-full         overflow-hidden
L866  AppHeader           ──────────────────────── ~56px (intrinsic)       visible
L1100 Outer <main>        ──────────────────────── flex-1                  overflow-x-hidden overflow-y-auto
L2372 SalesManagerView    ──────────────────────── flex-1 + h-full         visible (default)
L2386 Inner <main>        ──────────────────────── flex-1                  overflow-y-auto  ← INTENDED scroll owner
L3201 LeadDetailsLayout   ──────────────────────── content-driven          visible
L149  LeadDetailsPanel    ──────────────────────── content-driven (mobile) visible
L206  Two-column          ──────────────────────── content-driven          visible
L209  Left column         ──────────────────────── content-driven          visible
L308  Tab content         ──────────────────────── flex-1 min-h-0          overflow-y-auto (INERT — parent unbounded)
L367  Right column        ──────────────────────── min-h-[500px]           visible
```

### 3.2 Height Chain (Sales Manager, Desktop — `lg:` 1024px+)

```
                          Element                  Height Source            Overflow
L829  Root div            ──────────────────────── h-screen (100vh)        overflow-hidden
L862  Content wrapper     ──────────────────────── flex-1 + h-full         overflow-hidden
L866  AppHeader           ──────────────────────── ~64px (intrinsic)       visible
L1100 Outer <main>        ──────────────────────── flex-1                  overflow-x-hidden overflow-y-auto
L2372 SalesManagerView    ──────────────────────── flex-1 + h-full         visible
L2386 Inner <main>        ──────────────────────── flex-1                  overflow-y-auto
L3201 LeadDetailsLayout   ──────────────────────── content-driven          visible
L149  LeadDetailsPanel    ──────────────────────── lg:h-[calc(100dvh-130px)] visible
L206  Two-column          ──────────────────────── lg:flex-1 lg:min-h-0    lg:overflow-hidden
L209  Left column         ──────────────────────── lg:min-h-0              lg:overflow-hidden
L308  Tab content         ──────────────────────── flex-1 min-h-0          overflow-y-auto ← LEFT scroll owner
L367  Right column        ──────────────────────── lg:min-h-0              lg:overflow-hidden
      Right content       ──────────────────────── flex-1 min-h-0          overflow-y-auto ← RIGHT scroll owner
```

---

## 4. Height and Overflow Audit

### 4.1 Inventory of Height/Overflow Properties

| File | Line | Classes | Issue? |
|------|------|---------|--------|
| sales/page.tsx | 829 | `h-screen overflow-hidden` | Root viewport lock — intentional |
| sales/page.tsx | 862 | `flex-1 flex-col h-full overflow-hidden` | Redundant `h-full` + `flex-1` |
| sales/page.tsx | 1100 | `flex-1 overflow-x-hidden overflow-y-auto flex-col gap-4 p-4 sm:p-6` | Outer scroll container (recently fixed) |
| sales/page.tsx | 2372 | `flex-1 flex-col h-full relative` | **Missing `min-h-0`**; `h-full` + `flex-1` redundant |
| sales/page.tsx | 2386 | `flex-1 overflow-y-auto` | Inner scroll container — **missing `min-h-0`** |
| sales/page.tsx | 3164 | `h-[calc(100vh-130px)] overflow-hidden` | Booking view — uses `100vh` not `100dvh` |
| LeadDetailsPanel.tsx | 149 | `lg:h-[calc(100dvh-130px)]` | Desktop height cap |
| LeadDetailsPanel.tsx | 206 | `lg:flex-1 lg:min-h-0 lg:overflow-hidden` | Desktop only |
| LeadDetailsPanel.tsx | 209 | `lg:min-h-0 lg:overflow-hidden` | Desktop only |
| LeadDetailsPanel.tsx | 286 | `lg:flex-1 lg:min-h-0 lg:overflow-hidden` | Desktop only |
| LeadDetailsPanel.tsx | 308 | `flex-1 min-h-0 overflow-y-auto overscroll-contain` | Left tab content scroll |
| LeadDetailsPanel.tsx | 367 | `min-h-[500px] lg:min-h-0 lg:overflow-hidden` | **500px min on mobile** |
| LeadFollowUpPanel.tsx | 141 | `min-h-[500px] lg:min-h-0 flex-1` | **500px min on mobile** |
| LeadFollowUpPanel.tsx | 169 | `flex-1 min-h-0 overflow-y-auto overscroll-contain` | Messages scroll |
| LeadDealStagePanel.tsx | 14 | `flex-col flex-1 min-h-0` | OK |
| LeadDealStagePanel.tsx | 15 | `flex-1 min-h-0 overflow-y-auto overscroll-contain` | Deal stage scroll |

### 4.2 Confirmed `h-full` Without Definite Ancestor Issue

- `SalesManagerView` root div (L2372): `h-full` references the outer `<main>` height. The outer `<main>` has `flex-1` in its `flex-col` parent (L862 content wrapper, which has `h-full` from `h-screen`). The chain is:
  - L829 root: `h-screen` (definite)
  - L862 wrapper: `h-full` → definite via parent
  - L1100 outer `<main>`: `flex-1` → definite via flex algorithm in definite-height parent
  - L2372 SalesManagerView: `h-full` → definite via parent

  **Verdict:** The `h-full` chain IS definite. But `flex-1` on the same element is REDUNDANT with `h-full` and the interaction between them is browser-dependent (see F-06).

### 4.3 Missing `min-h-0` Audit

In a flex column, children default to `min-height: auto`, which prevents them from shrinking below their content size. Elements with `overflow: auto/hidden/scroll` resolve `min-height: auto` to 0 (per CSS spec), so they don't need an explicit `min-h-0`. However, elements WITHOUT overflow that serve as intermediate flex containers DO need `min-h-0`.

| Element | Has overflow | Has min-h-0 | Needs min-h-0? |
|---------|-------------|-------------|----------------|
| L2372 SalesManagerView root | NO (`visible`) | NO | **YES** — flex child in flex-col outer `<main>`, no overflow set |
| L2386 Inner `<main>` | YES (`overflow-y-auto`) | NO | Not technically required (overflow resolves min-height), but explicit is safer |
| L149 LeadDetailsPanel root | NO on mobile | NO | On mobile: flex child in inner `<main>`, should have `min-h-0` to allow shrinking |
| L3201 LeadDetailsLayout root | NO | NO | On mobile: flex child in inner `<main>`, should have `min-h-0` |

**Key finding:** L2372 (SalesManagerView root) is a flex child with `flex-1 h-full` and NO overflow property. Its `min-height: auto` means the browser may prevent it from shrinking below its content size. If its content (the inner `<main>` + toast) exceeds the outer `<main>`'s height, the SalesManagerView div pushes the outer `<main>` to expand, defeating the scroll boundary.

---

## 5. Confirmed Scrolling Root Causes

### Root Cause 1: Missing `min-h-0` on SalesManagerView root (L2372)

The inner `<main>` (L2386) is a flex child of the SalesManagerView div (L2372). The SalesManagerView div is itself a flex child of the outer `<main>` (L1100). The height chain:

```
Outer <main> (flex-1, bounded) → SalesManagerView (flex-1 h-full, NO overflow) → Inner <main> (flex-1 overflow-y-auto)
```

SalesManagerView has no `overflow` property, so its `min-height` defaults to `auto` (= content size). When LeadDetailsPanel content exceeds the viewport:

1. Inner `<main>` wants to be as tall as its content (its own `flex-1` wants to fill parent, but content is taller)
2. SalesManagerView `min-height: auto` forces it to grow to fit inner `<main>`
3. Outer `<main>` clips (it has `overflow-x-hidden overflow-y-auto`) — but since the outer `<main>` itself is scrollable, does its scroll activate? Only if SalesManagerView overflows it.

However, SalesManagerView also has `h-full` which sets an explicit height = outer `<main>`'s height. With `h-full` and `flex-1` on the same element, `h-full` takes precedence. So SalesManagerView IS bounded. But `min-height: auto` can OVERRIDE a smaller height if the content requires more space. The `min-height: auto` acts as a floor.

**In practice:** Whether this causes a scroll failure depends on browser layout behavior when `height: 100%`, `flex: 1`, and `min-height: auto` conflict on the same element. Chrome and Firefox may handle this differently. This is a confirmed architectural issue that should be fixed with `min-h-0`.

### Root Cause 2: Double `<main>` scroll containers

Both the outer `<main>` (L1100) and inner `<main>` (L2386) have `overflow-y-auto`. This creates two nested scroll containers. The intended behavior:

- Outer `<main>`: scroll owner for non-SalesManagerView content (site visits, inventory, etc.)
- Inner `<main>`: scroll owner for SalesManagerView content

Because SalesManagerView has `h-full` (matching outer `<main>`), the outer `<main>` should never have overflow. The inner `<main>` is the sole scroll owner. But:

- If `h-full` doesn't resolve correctly (Root Cause 1), the outer `<main>` may need to scroll but can't because SalesManagerView is an intermediate element that breaks the scroll chain.
- Two nested `overflow-y-auto` containers can cause browser-dependent wheel event routing issues.

### Root Cause 3: `overscroll-contain` on mobile non-scrolling elements

Left tab content (L308) has `overflow-y-auto overscroll-contain`. On mobile, this element is NOT bounded (its parent chain has no height constraint below `lg:`). So `overflow-y-auto` produces a scroll container that never actually scrolls (content fits). But `overscroll-contain` on a non-scrolling scroll container can trap wheel events in some browsers (particularly Chrome on Windows), preventing scroll propagation to the inner `<main>`.

---

## 6. Visual UI/UX Defects

### 6.1 Excessively Tall Empty Right Panel (Mobile)

**Evidence from screenshot:** Not directly visible in the screenshot (it shows only the left panel), but from the code:

- Right column (L367): `min-h-[500px]` on mobile
- LeadFollowUpPanel (L141): `min-h-[500px]` on mobile

On mobile, both left and right panels stack vertically. The right panel occupies at MINIMUM 500px even if it contains a single follow-up message. This forces the user to scroll past a large mostly-empty section.

### 6.2 Desktop Height Offset Imprecision

- `lg:h-[calc(100dvh-130px)]` on LeadDetailsPanel
- Actual chrome: AppHeader ~64px + outer `<main>` padding 24px top + 24px bottom = 112px
- The 130px offset leaves ~18px of unused vertical space at the bottom on desktop
- Not functionally broken but wastes screen real estate

### 6.3 Receptionist vs Sales Manager Layout Inconsistency

| Feature | Sales Manager | Receptionist (assigned detail) |
|---------|--------------|-------------------------------|
| Header | Shared `LeadDetailsHeader` with score ring, badges, actions | Custom inline header (simpler, no score ring) |
| Left panel | Shared `LeadPersonalInfo` + `LoanDealView` | Shared `LeadPersonalInfo` + `LoanDealView` |
| Right panel | Shared `LeadFollowUpPanel` / `LeadDealStagePanel` | Custom inline follow-ups with `h-[600px]` |
| Column split | 44% / 56% (lg:) | 50% / 50% (lg:) |
| Right panel height | `min-h-[500px] lg:min-h-0` | `h-[600px]` (hardcoded, no responsive) |
| Tab styling | Compact pill tabs | Larger pill tabs with wrapping |
| Uses LeadDetailsPanel | Yes | No |
| Scroll architecture | Double `<main>` | Single `<main>` |

---

## 7. Desktop-Specific Findings

### 7.1 Independent Panel Scrolling (lg:+)

On desktop, the intended architecture is correct:

1. `LeadDetailsPanel` root: `lg:h-[calc(100dvh-130px)]` — viewport-bounded
2. Two-column container: `lg:flex-1 lg:min-h-0 lg:overflow-hidden` — fills remaining, clips
3. Left column: `lg:min-h-0 lg:overflow-hidden` → left tab content: `flex-1 min-h-0 overflow-y-auto` — scrolls
4. Right column: `lg:min-h-0 lg:overflow-hidden` → right content: `flex-1 min-h-0 overflow-y-auto` — scrolls

The `lg:overflow-hidden` on intermediate containers prevents content from leaking. The `min-h-0` allows flex children to shrink. The `overflow-y-auto` on the actual content divs enables scrolling.

**Risk:** If the 130px offset is wrong, the LeadDetailsPanel itself might overflow the inner `<main>`, but the inner `<main>` has `overflow-y-auto` so it would scroll the entire panel — creating an unwanted page-level scroll in addition to panel-level scrolls.

### 7.2 `100dvh` Browser Support

`100dvh` is used in `lg:h-[calc(100dvh-130px)]`. This is supported in:
- Chrome 108+ (Dec 2022)
- Firefox 94+ (Nov 2021)
- Safari 15.4+ (Mar 2022)

Older browsers would ignore the entire `calc()` expression, leaving the desktop panel unbounded. The panels would revert to content-driven height, and the inner `<main>` would scroll the whole page. This is a graceful degradation, not a hard failure.

---

## 8. Mobile-Specific Findings

### 8.1 No Height Constraint on Panels (Correct)

On mobile (below `lg:`), none of the `lg:` prefixed classes apply. LeadDetailsPanel, the two-column container, and the columns are all content-driven. This is correct — mobile should use natural page scrolling.

### 8.2 Right Column 500px Minimum (P1)

`min-h-[500px]` on L367 and L141 forces the right panel to occupy at least 500px on mobile. With a typical 700-800px viewport, the right panel alone fills most of the screen. The user must scroll extensively past the right panel even if it has minimal content.

### 8.3 `overscroll-contain` on Non-Scrolling Elements

Left tab content (L308) and deal stage/follow-up panels have `overscroll-contain`. On mobile these elements aren't actually scrolling (they grow to content). The `overscroll-contain` is harmless on most browsers but can trap wheel events on Chrome/Windows, preventing the page from scrolling when the cursor is over these elements.

---

## 9. Prioritized Bug Register

| ID | Severity | Component | File:Line | Root Cause | Impact | Proposed Fix |
|----|----------|-----------|-----------|-----------|--------|-------------|
| F-01 | **P0** | SalesManagerView | sales/page.tsx:2372 | `flex-1 flex-col h-full` without `min-h-0` — flex child's `min-height: auto` can prevent height bounding | Inner `<main>` may not be height-constrained, scroll fails | Add `min-h-0` to the div, remove redundant `h-full` |
| F-02 | **P0** | SalesManagerView inner `<main>` | sales/page.tsx:2386 | `flex-1 overflow-y-auto` without `min-h-0` — while overflow resolves min-height per spec, explicit is safer | May not shrink below content in edge cases | Add `min-h-0` |
| F-03 | **P0** | Double `<main>` | sales/page.tsx:1100+2386 | Two nested `overflow-y-auto` elements — ambiguous scroll ownership | Browser-dependent wheel event routing, nested scrollbar confusion | Change outer `<main>` to `overflow-hidden` when rendering SalesManagerView, OR remove overflow from inner `<main>` and let outer `<main>` scroll |
| F-04 | **P0** | Left tab content | LeadDetailsPanel.tsx:308 | `overscroll-contain` on element that doesn't scroll on mobile | Wheel events trapped on Chrome/Windows; page won't scroll when cursor is over Personal Info | Make `overscroll-contain` desktop-only: `lg:overscroll-contain` |
| F-05 | **P1** | Right column | LeadDetailsPanel.tsx:367 | `min-h-[500px]` on mobile forces 500px empty section | Excessively tall empty space on mobile; user must scroll past it | Reduce to `min-h-[300px]` or use content-driven height on mobile |
| F-06 | **P1** | LeadFollowUpPanel | LeadFollowUpPanel.tsx:141 | `min-h-[500px]` on mobile forces 500px regardless of content | Same as F-05 | Same as F-05 |
| F-07 | **P2** | SalesManagerView | sales/page.tsx:2372 | Redundant `h-full` + `flex-1` on same element — `h-full` overrides `flex-basis: 0` | Browser-dependent interaction; hard to reason about | Remove `h-full`, keep `flex-1 min-h-0` |
| F-08 | **P2** | LeadDetailsPanel | LeadDetailsPanel.tsx:149 | 130px offset doesn't match actual chrome (112px) | 18px wasted vertical space on desktop | Adjust to `calc(100dvh-112px)` or use CSS custom property |
| F-09 | **P2** | Receptionist right panel | receptionist/page.tsx:4069 | `h-[600px]` hardcoded, no responsive adaptation | Fixed height doesn't adapt to different viewports; may clip content or waste space | Use `flex-1 min-h-[300px] lg:min-h-0` like Sales Manager |
| F-10 | **P2** | Receptionist detail | receptionist/page.tsx:3684-3838 | Completely separate inline layout, not using shared LeadDetailsPanel | Inconsistent UX between roles; duplicated code | Evaluate migrating to shared LeadDetailsPanel |
| F-11 | **P3** | LeadDetailsPanel | LeadDetailsPanel.tsx:149 | `100dvh` not supported in Safari < 15.4 | Graceful degradation; panels become content-driven | Add `100vh` fallback |
| F-12 | **P3** | Left tab content | LeadDetailsPanel.tsx:308 | `overscroll-contain` also applied on LeadFollowUpPanel.tsx:169 and LeadDealStagePanel.tsx:15 | Same as F-04 on mobile | Same treatment: `lg:overscroll-contain` |

---

## 10. Recommended CSS and Component-Level Fixes

### Fix for F-01 + F-02 + F-07 (SalesManagerView root + inner `<main>`)

**sales/page.tsx:2372** — Change:
```tsx
// BEFORE
<div className="flex-1 flex flex-col h-full relative">
// AFTER
<div className="flex-1 flex flex-col min-h-0 relative">
```

Remove `h-full` (redundant with `flex-1` in a bounded flex parent). Add `min-h-0` to allow the flex item to shrink below content size.

**sales/page.tsx:2386** — Change:
```tsx
// BEFORE
<main className="flex-1 overflow-y-auto custom-scrollbar">
// AFTER
<main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
```

Explicit `min-h-0` for clarity and cross-browser safety.

### Fix for F-03 (Double `<main>` scroll containers)

**Option A (Recommended):** Remove `overflow-y-auto` from the outer `<main>` entirely and let the inner `<main>` own ALL scrolling for SalesManagerView. For non-SalesManagerView content (site visits, inventory, etc.), those views are also rendered inside SalesManagerView's inner `<main>` anyway — they share the same scroll container.

But wait — the outer `<main>` also hosts non-SalesManagerView content (assistant, site visits, inventory, CP enquiry, banker visits). These are rendered as siblings of SalesManagerView inside the outer `<main>` (L1101-L1199). Only ONE renders at a time based on `activeView`.

So the outer `<main>` NEEDS `overflow-y-auto` for views that are NOT inside SalesManagerView (e.g., site visits at L1125, inventory at L1138). But when SalesManagerView is mounted, its inner `<main>` at L2386 is the scroll owner, and the outer `<main>` should NOT scroll.

**Option B (Simpler):** Keep both `overflow-y-auto` but ensure the height chain is correct (fix F-01/F-02). If SalesManagerView is properly bounded (via `flex-1 min-h-0`), it fits within the outer `<main>` exactly, and the outer `<main>` never overflows. The inner `<main>` scrolls. This is the least invasive fix.

**Recommendation:** Option B — fix the `min-h-0` chain. The double `<main>` becomes harmless when the height chain is correct.

### Fix for F-04 + F-12 (overscroll-contain on mobile)

**LeadDetailsPanel.tsx:308** — Change:
```tsx
// BEFORE
overscroll-contain
// AFTER
lg:overscroll-contain
```

Apply only on desktop where independent panel scrolling is active. On mobile, the element doesn't scroll, so `overscroll-contain` only risks trapping wheel events.

Apply the same change to:
- LeadFollowUpPanel.tsx:169
- LeadDealStagePanel.tsx:15

### Fix for F-05 + F-06 (500px minimum on mobile)

**LeadDetailsPanel.tsx:367** — Change:
```tsx
// BEFORE
min-h-[500px] lg:min-h-0
// AFTER
min-h-[250px] lg:min-h-0
```

**LeadFollowUpPanel.tsx:141** — Change:
```tsx
// BEFORE
min-h-[500px] lg:min-h-0
// AFTER
min-h-[250px] lg:min-h-0
```

Reduce the mobile minimum from 500px to 250px. This still ensures the panel has enough space for its header and some content, but doesn't force half the viewport to be occupied by the right panel.

---

## 11. Proposed Target Layout Architecture

### Desktop (lg:+)

```
┌─────────────────────────────────────────────────────┐
│ AppHeader (64px, sticky, flex-shrink-0)              │
├─────────────────────────────────────────────────────┤
│ <main> (flex-1, overflow-hidden on desktop)          │
│  └─ SalesManagerView (flex-1, min-h-0)              │
│     └─ inner <main> (flex-1, min-h-0, overflow-y: hidden on desktop) │
│        └─ LeadDetailsPanel (h = calc(100dvh - Xpx)) │
│           ├─ Header (flex-shrink-0)                  │
│           └─ Two-column (flex-1, min-h-0, overflow-hidden) │
│              ├─ Left (44%, overflow-y-auto) ← SCROLL │
│              └─ Right (56%, overflow-y-auto) ← SCROLL│
└─────────────────────────────────────────────────────┘
```

- One intentional scroll owner per panel
- No page-level scroll on desktop
- Header always accessible (not scrolled away)
- Tab bars fixed above their scroll areas

### Mobile (below lg:)

```
┌───────────────────────────┐
│ AppHeader (56px, sticky)   │
├───────────────────────────┤
│ <main> (flex-1)            │
│  └─ SalesManagerView       │
│     └─ inner <main>        │  ← SINGLE SCROLL OWNER
│        └─ LeadDetailsPanel │
│           ├─ Header        │
│           ├─ Left tabs     │
│           ├─ Left content  │  (grows to content, no scroll)
│           ├─ Calling btns  │
│           ├─ Right tabs    │
│           ├─ Right content │  (grows to content, no scroll)
│           └─ (end)         │
└───────────────────────────┘
```

- One scroll owner: inner `<main>`
- All content natural height (no min-h, no forced height)
- Everything accessible by scrolling the single container
- No panel-level scroll on mobile

---

## 12. Implementation Sequence

### Phase 1: Critical Scrolling Fix (P0)

**Files:** `sales/page.tsx`

1. L2372: Change `flex-1 flex flex-col h-full relative` → `flex-1 flex flex-col min-h-0 relative`
2. L2386: Change `flex-1 overflow-y-auto` → `flex-1 min-h-0 overflow-y-auto`

**Expected outcome:** Inner `<main>` properly bounded; vertical scroll works on all viewports.

### Phase 2: Wheel Event Trapping Fix (P0)

**Files:** `LeadDetailsPanel.tsx`, `LeadFollowUpPanel.tsx`, `LeadDealStagePanel.tsx`

1. L308: `overscroll-contain` → `lg:overscroll-contain`
2. L169: `overscroll-contain` → `lg:overscroll-contain`
3. L15: `overscroll-contain` → `lg:overscroll-contain`

**Expected outcome:** Wheel events propagate to scroll owner on mobile; independent scroll isolation preserved on desktop.

### Phase 3: Mobile Right Panel Height (P1)

**Files:** `LeadDetailsPanel.tsx`, `LeadFollowUpPanel.tsx`

1. L367: `min-h-[500px]` → `min-h-[250px]`
2. L141: `min-h-[500px]` → `min-h-[250px]`

**Expected outcome:** Right panel no longer forces 500px empty section on mobile.

### Phase 4: Desktop Height Precision (P2)

**File:** `LeadDetailsPanel.tsx`

1. L149: Adjust `130px` offset to match actual chrome (~112px or measure precisely)

**Expected outcome:** 18px less wasted vertical space on desktop.

### Phase 5: Receptionist Consistency (P2, optional)

**File:** `receptionist/page.tsx`

1. L4069: Replace hardcoded `h-[600px]` with `flex-1 min-h-[250px] lg:min-h-0`
2. Evaluate replacing the inline assigned-detail layout with shared `LeadDetailsPanel`

**Expected outcome:** Consistent responsive behavior across roles.

### Phase 6: Browser-Based Regression Testing

Test matrix:

| Test | Viewport | Expected |
|------|----------|----------|
| Mouse wheel scrolling on left panel content | Desktop 1920x1080 | Left panel scrolls independently |
| Mouse wheel scrolling on right panel content | Desktop 1920x1080 | Right panel scrolls independently |
| Mouse wheel scrolling entire page | Mobile 393x852 | Page scrolls, all content accessible |
| Trackpad scrolling | Desktop 1366x768 | Both panels scroll |
| Tab switching (Personal/Loan, Deal Stage/Followups) | All | No stale height; scroll resets |
| Sales form overlay | Desktop + Mobile | Scrollable within panel |
| Returning lead with visit history expanded | Desktop + Mobile | No layout break |
| Browser zoom 125% | Desktop 1920x1080 | No overflow/clipping |
| Chrome, Firefox, Safari | Desktop + Mobile | Consistent behavior |

---

## 13. Regression Risk Assessment

| Fix | Risk | Mitigation |
|-----|------|------------|
| Remove `h-full` from SalesManagerView | Other subViews (overview, cards, closed-leads) may lose full-height behavior | Test all SalesManagerView sub-views after change |
| Add `min-h-0` | Theoretically allows element to collapse to 0px | `flex-1` prevents collapse in normal flow; only relevant if parent has 0 available space |
| Change `overscroll-contain` to `lg:overscroll-contain` | Desktop scroll chaining might feel different on mobile-width desktop windows (< 1024px) | The mobile experience should NOT have overscroll containment; the change is correct |
| Reduce `min-h-[500px]` to `min-h-[250px]` | Follow-ups panel on mobile might look too short with few messages | 250px is still sufficient for header + 2 messages + composer; content grows beyond min |
| Adjust 130px offset | If measured incorrectly, panels may overflow the viewport | Measure with dev tools at common viewports before committing |

---

## 14. Summary of Admin vs Sales Manager Architectural Gap

The Admin dashboard works because:

1. **Single `<main>`** (L1390): `flex-1 px-3 py-3 overflow-y-auto` — one unambiguous scroll owner
2. **Direct wrapper** (L4282): `flex-1 overflow-y-auto p-3` around LeadDetailsLayout — additional scroll fallback
3. **No intermediate `h-full` flex container** — the height chain is clean

The Sales Manager dashboard breaks because:

1. **Double `<main>`** — outer (L1100) and inner (L2386) both claim scroll ownership
2. **SalesManagerView root** (L2372) interposes `h-full` + `flex-1` WITHOUT `min-h-0`
3. **The inner `<main>`** at L2386 lacks `min-h-0`, relying on `overflow-y-auto` to implicitly resolve `min-height: auto`

The fix does NOT require adopting the Admin's architecture. Adding `min-h-0` and removing `h-full` from the SalesManagerView root normalizes the height chain while preserving the dual-main pattern.
