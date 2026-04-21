# Proposal: Improve Shell Usability and Performance

## Summary

This change packages the next high-value product improvements for Better Agent Terminal into a single roadmap-oriented change:

1. Add a global command palette and fast workspace/session switching surface.
2. Add durable session snapshot and recovery support for long-running AI-assisted work.
3. Improve responsiveness and maintainability by reducing render pressure, shrinking architectural hotspots, and adding regression coverage for core interaction paths.

## Why Now

The product already has strong breadth: multi-workspace management, terminal tabs, Claude/Codex integration, file and git views, right-side tools, remote features, and persistent session metadata. The next bottlenecks are not missing major surfaces but:

- discoverability: users must remember where commands live
- resilience: long-running work is valuable but fragile across restarts and interruptions
- maintainability: several UI and manager modules are large enough to slow iteration and increase regression risk
- confidence: core flows are only lightly protected by automated tests

## Goals

- Reduce command discovery friction for both novice and expert users.
- Preserve and recover high-value work across app restarts and interrupted agent sessions.
- Improve large-session responsiveness and create clearer performance guardrails.
- Raise confidence when changing workspace, tab, session, and side-panel behavior.

## Non-Goals

- Replacing the current terminal/agent architecture.
- Redesigning every UI surface in this change.
- Adding new third-party cloud dependencies.
- Building a full sync service across devices.

## Proposed Capabilities

### 1. Global Command Palette

Provide a single searchable action surface for high-frequency commands:

- create terminal / agent / worktree tabs
- switch workspace
- switch current pane (terminal/files/git/github)
- open snippets / skills / agents drawer
- rest / wake current session
- reopen recent workspaces and sessions

### 2. Session Snapshot and Recovery

Persist enough state to help users resume active work safely:

- active workspace and tab context
- focused terminal/session context
- recoverable AI session metadata and user-facing snapshot labels
- recent files or context references where recovery adds value

### 3. Performance and Reliability Guardrails

Prioritize architecture and UX areas with the highest leverage:

- decompose oversized UI/manager modules
- reduce long-list and long-message rendering cost
- clean build warnings that hide signal
- add regression tests around critical workflows

## Expected User Impact

- Faster access to actions with less navigation overhead.
- Lower anxiety around restarting the app or pausing work.
- Better responsiveness in long-running conversations and large workspaces.
- Fewer regressions when evolving tab, drawer, workspace, and agent flows.

## Risks

- Recovery features may create user confusion if restored state is stale or incomplete.
- Command palette value depends on good action ranking and naming.
- Decomposing large modules may create temporary integration churn if not phased carefully.

## Success Indicators

- Users can trigger the most common actions without reaching for multiple UI regions.
- Recoverable sessions survive restart with clear affordances and minimal ambiguity.
- Long session navigation remains responsive.
- Core interaction regressions are caught by automated tests before release.
