import { ClaudeAgentPanel, type ClaudeAgentPanelProps } from './ClaudeAgentPanel'

export interface CodexAgentPanelProps extends Omit<ClaudeAgentPanelProps, 'targetAgent'> {}

export function CodexAgentPanel(props: Readonly<CodexAgentPanelProps>) {
  return <ClaudeAgentPanel {...props} targetAgent="codex" />
}
