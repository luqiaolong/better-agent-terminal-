import type { AgentPresetId } from './agent-presets'
import type { AgentParamValue } from './index'

export interface AgentParamOption {
  value: AgentParamValue
  label: string
}

export interface AgentParamDefinition {
  key: string
  label: string
  type: 'select' | 'boolean'
  defaultValue: AgentParamValue
  options?: AgentParamOption[]
}

const CODEX_AGENT_PARAM_DEFINITIONS: AgentParamDefinition[] = [
  {
    key: 'sandboxMode',
    label: 'Codex sandbox mode',
    type: 'select',
    defaultValue: 'workspace-write',
    options: [
      { value: 'read-only', label: 'sandbox: read-only' },
      { value: 'workspace-write', label: 'sandbox: workspace-write' },
      { value: 'danger-full-access', label: 'sandbox: danger-full-access' },
    ],
  },
  {
    key: 'approvalPolicy',
    label: 'Codex approval policy',
    type: 'select',
    defaultValue: 'on-request',
    options: [
      { value: 'untrusted', label: 'approval: untrusted' },
      { value: 'on-request', label: 'approval: on-request' },
      { value: 'never', label: 'approval: never' },
    ],
  },
]

function getAgentParamDefinitions(agentPreset?: AgentPresetId | null): AgentParamDefinition[] {
  if (agentPreset === 'codex-agent') return CODEX_AGENT_PARAM_DEFINITIONS
  return []
}

function isValidAgentParamValue(definition: AgentParamDefinition, value: AgentParamValue | undefined): boolean {
  if (value === undefined) return false
  if (definition.type === 'boolean') return typeof value === 'boolean'
  if (definition.type === 'select') return !!definition.options?.some(option => option.value === value)
  return false
}

export function normalizeAgentParams(
  agentPreset?: AgentPresetId | null,
  params?: Record<string, AgentParamValue>,
): Record<string, AgentParamValue> | undefined {
  const definitions = getAgentParamDefinitions(agentPreset)
  if (definitions.length === 0) return params

  const normalized: Record<string, AgentParamValue> = { ...(params || {}) }
  for (const definition of definitions) {
    const currentValue = params?.[definition.key]
    normalized[definition.key] = isValidAgentParamValue(definition, currentValue)
      ? currentValue
      : definition.defaultValue
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}
