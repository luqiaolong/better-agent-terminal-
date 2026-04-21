# Design: Improve Shell Usability and Performance

## Overview

This change is intentionally split into three implementation lanes that can advance in parallel after shared architecture decisions are fixed:

1. Command palette and quick switching
2. Session snapshot/recovery
3. Performance/test hardening

The design goal is to improve the user’s high-frequency development loop without destabilizing the current workspace and session model.

## Current Constraints

- App-level orchestration and panel visibility live in [src/App.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/App.tsx).
- Workspace and terminal persistence currently live in [src/stores/workspace-store.ts](/D:/java/agentprojects/github/better-agent-terminal/src/stores/workspace-store.ts).
- Claude and Codex session lifecycle logic lives in separate but similarly large managers:
  - [electron/claude-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/claude-agent-manager.ts)
  - [electron/codex-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/codex-agent-manager.ts)
- The largest UI surfaces are the Claude/Codex agent panels, which already carry heavy rendering and event logic.

## Lane A: Command Palette

### Proposed Model

Introduce a central registry of command palette actions grouped by domain:

- workspace actions
- terminal/tab actions
- drawer actions
- session actions
- utility/navigation actions

The first release should surface two high-value result groups by default:

- `Workspaces`
- `Actions`

Each action entry should define:

- id
- title
- optional subtitle/keywords
- availability predicate
- handler

### First-Release Flow

- `Ctrl/Cmd+K` opens a global floating palette from anywhere in the main app shell.
- `Esc` closes the palette and restores focus to the previous terminal, input, or interactive surface.
- Search matches workspace alias, name, path, group, and action labels.
- Workspace results should sort by current usefulness, not only alphabetically:
  - currently active
  - recently active
  - pending action present
  - current group relevance

### First-Release Scope

- switch workspace
- switch current workspace pane/tab
- create terminal / agent / worktree terminal
- open/add workspace
- open settings / profiles
- toggle left and right utility surfaces

### Delivery Approach

Use [src/App.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/App.tsx) as the palette host and route first-release actions through existing handlers or typed custom events rather than forcing a large action-layer rewrite up front.

### Likely Integration Points

- [src/App.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/App.tsx) for global open/close and keyboard binding
- [src/stores/workspace-store.ts](/D:/java/agentprojects/github/better-agent-terminal/src/stores/workspace-store.ts) for workspace/session state lookups
- new command palette UI component(s) under `src/components/`
- [src/components/WorkspaceView.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/WorkspaceView.tsx) for bridging tab/terminal creation actions
- [src/components/Sidebar.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/Sidebar.tsx) for workspace-oriented actions and context menu parity
- [src/components/ThumbnailBar.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/ThumbnailBar.tsx) for top-bar action parity
- [src/components/FolderPicker.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/FolderPicker.tsx) for open/add workspace flows

### Design Principles

- keyboard-first
- action names should match user intent, not implementation details
- actions should degrade cleanly when unavailable
- no duplicate logic if an existing handler already exists elsewhere in the UI
- avoid introducing a new fuzzy-search dependency in v1 unless current lightweight scoring proves insufficient
- keep session-specific slash-command discovery out of the first release unless it can be made stable and timely

## Lane B: Session Snapshot and Recovery

### Proposed Model

Add a recoverable snapshot layer that stores user-meaningful recovery state, not just low-level identifiers.

Potential snapshot contents:

- workspace id
- focused terminal id
- active pane/tab
- session identifiers and API flavor
- session label or preview
- timestamp and recovery reason

Recovery should be treated as a layered model:

1. `Profile/Window Recovery`
2. `Terminal Context Recovery`
3. `Agent Session Recovery`

This lets the app restore meaningful context without pretending every live process can be losslessly resumed.

### Recommended Snapshot Shape

- workspace id
- focused terminal id
- active pane/tab
- terminal kind (`pty`, `claude`, `codex`, `worker`)
- `cwd`
- `historyKey`
- `agentPreset`
- worktree metadata
- pending prompt/images where applicable
- session identifiers (`sdkSessionId` / thread id)
- model and relevant session mode metadata
- recovery state (`fresh`, `recoverable`, `resting`, `failed`)
- user-facing label/preview
- timestamp

### Existing State to Build On

- [src/stores/workspace-store.ts](/D:/java/agentprojects/github/better-agent-terminal/src/stores/workspace-store.ts) already persists terminal-level `sdkSessionId`, model, and session metadata.
- [electron/profile-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/profile-manager.ts) already stores window snapshots and profile state.
- [electron/claude-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/claude-agent-manager.ts) already supports resume-aware startup and history loading.
- [electron/codex-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/codex-agent-manager.ts) already carries codex thread/session recovery data.

### Important Distinction

Recovery should separate:

- **restorable UI context**
- **restorable AI session linkage**
- **non-guaranteed live process state**

This avoids misleading users into thinking a suspended PTY or agent process can always be recreated exactly.

### Likely Integration Points

- [src/stores/workspace-store.ts](/D:/java/agentprojects/github/better-agent-terminal/src/stores/workspace-store.ts)
- [electron/claude-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/claude-agent-manager.ts)
- [electron/codex-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/codex-agent-manager.ts)
- [electron/profile-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/profile-manager.ts)
- window/profile persistence handlers in the electron process
- [src/components/WorkspaceView.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/WorkspaceView.tsx) for startup rehydration orchestration

### Known Gaps to Address

- store persistence does not currently carry all recovery-critical fields
- some restored fields are normalized back to workspace root state instead of the persisted terminal context
- focused terminal recovery and active terminal persistence are not consistently modeled
- resting state is currently runtime-only
- pending prompt/procfile/worktree-related metadata is not fully durable across restart

## Lane C: Performance and Reliability Guardrails

### Primary Targets

- break down oversized agent panels into smaller subcomponents
- break manager logic into clearer subsystems
- reduce re-render pressure for long histories/tool streams
- add tests for the most failure-prone interactions
- reduce avoidable build warnings

### Concrete Hotspots

- [src/components/ClaudeAgentPanel.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/ClaudeAgentPanel.tsx) and [src/components/CodexAgentPanel.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/CodexAgentPanel.tsx) are oversized and highly parallel.
- [electron/claude-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/claude-agent-manager.ts) and [electron/codex-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/codex-agent-manager.ts) are backend orchestration hotspots.
- Long transcript rendering still does repeated whole-list work during streaming.
- [src/components/FileTree.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/FileTree.tsx) currently mixes navigation and preview-heavy concerns in a way that weakens chunking.

### Measurable Targets

- Reduce each agent panel below roughly 1500 lines through extracted hooks/components.
- Reduce [electron/claude-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/claude-agent-manager.ts) below roughly 1400 lines through subsystem splits.
- Bound visible transcript DOM rows for long sessions.
- Bring `npm run compile` warning count to zero where practical.
- Add automated protection for the most regression-prone workspace, tab, drawer, and recovery interactions.

### Likely Integration Points

- [src/components/ClaudeAgentPanel.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/ClaudeAgentPanel.tsx)
- [src/components/CodexAgentPanel.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/CodexAgentPanel.tsx)
- [electron/claude-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/claude-agent-manager.ts)
- [electron/codex-agent-manager.ts](/D:/java/agentprojects/github/better-agent-terminal/electron/codex-agent-manager.ts)
- build configuration and import boundaries around [src/components/WorkspaceView.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/WorkspaceView.tsx) and [src/components/FileTree.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/FileTree.tsx)
- [src/components/MarkdownPreviewPanel.tsx](/D:/java/agentprojects/github/better-agent-terminal/src/components/MarkdownPreviewPanel.tsx)
- [src/stores/workspace-store.ts](/D:/java/agentprojects/github/better-agent-terminal/src/stores/workspace-store.ts)

## Delivery Strategy

### Phase 1

- command palette shell
- action registry for top user actions
- session snapshot schema
- initial recovery entry surface
- warning cleanup inventory
- validation checklist for keyboard and focus conflicts

### Phase 2

- richer action ranking and quick switch flows
- deeper recovery affordances
- high-value agent panel decomposition
- initial regression coverage

### Phase 3

- long-history rendering improvements
- manager decomposition
- expanded diagnostics/performance metrics

## Open Questions

- Should recovery be automatic, suggested, or explicit by default?
- Which actions deserve top ranking in the command palette on first release?
- How much session content preview is safe and useful in a recovery surface?
- Should workspace quick switch live only inside the palette or also get a lightweight dedicated switcher?
