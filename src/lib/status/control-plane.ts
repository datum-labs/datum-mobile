/**
 * Ported from cloud-portal `app/utils/helpers/control-plane.helper.ts`
 * (transformControlPlaneStatus). Behaviour is kept identical so the app shows
 * the same status as the portal for every resource.
 */
import {
  ControlPlaneStatus,
  type ConditionSummary,
  type ExtendedControlPlaneStatus,
  type RawCondition,
} from './types';

export interface TransformStatusOptions {
  /**
   * Which conditions must be True for Success.
   * - undefined: auto-detect (Ready → Accepted+Programmed → Accepted → first)
   * - null: every condition
   * - string[]: exactly these
   */
  requiredConditions?: string[] | null;
  includeConditionDetails?: boolean;
}

function autoDetectRequiredConditions(conditionMap: Map<string, RawCondition>): string[] {
  if (conditionMap.has('Ready')) return ['Ready'];
  if (conditionMap.has('Accepted') && conditionMap.has('Programmed')) return ['Accepted', 'Programmed'];
  if (conditionMap.has('Accepted')) return ['Accepted'];
  const first = Array.from(conditionMap.keys())[0];
  return first ? [first] : [];
}

export function transformControlPlaneStatus(
  status: { conditions?: RawCondition[] | null; [key: string]: unknown } | null | undefined,
  options: TransformStatusOptions = {}
): ExtendedControlPlaneStatus {
  const { includeConditionDetails = false } = options;

  if (!status) {
    return { status: ControlPlaneStatus.Pending, message: 'Resource is being provisioned' };
  }

  const { conditions: rawConditions, ...rest } = status;
  const conditions = rawConditions ?? [];
  if (conditions.length === 0) {
    return { status: ControlPlaneStatus.Pending, message: 'Resource is being provisioned' };
  }

  const conditionMap = new Map<string, RawCondition>();
  for (const c of conditions) conditionMap.set(c.type ?? '', c);

  let requiredConditions: string[];
  if (options.requiredConditions === null) {
    requiredConditions = Array.from(conditionMap.keys());
  } else if (options.requiredConditions === undefined) {
    requiredConditions = autoDetectRequiredConditions(conditionMap);
  } else {
    requiredConditions = options.requiredConditions;
  }

  const allConditionsMet = requiredConditions.every(
    (type) => conditionMap.get(type)?.status === 'True'
  );

  let finalStatus: ControlPlaneStatus;
  let finalMessage = '';
  if (allConditionsMet) {
    finalStatus = ControlPlaneStatus.Success;
  } else {
    finalStatus = ControlPlaneStatus.Pending;
    const messages: string[] = [];
    const seen = new Set<string>();
    for (const type of requiredConditions) {
      const condition = conditionMap.get(type);
      if (condition?.status !== 'True') {
        const message = condition?.message || `Awaiting ${type.toLowerCase()}`;
        if (!seen.has(message.toLowerCase())) {
          messages.push(message);
          seen.add(message.toLowerCase());
        }
      }
    }
    finalMessage = messages.length > 0 ? messages.join('; ') : 'Resource is being provisioned';
  }

  // Same spread order as the portal: extra status fields follow the computed ones.
  const response: ExtendedControlPlaneStatus = { status: finalStatus, message: finalMessage, ...rest };

  if (includeConditionDetails) {
    const programmed = conditionMap.get('Programmed');
    const accepted = conditionMap.get('Accepted');
    if (programmed) {
      response.isProgrammed = programmed.status === 'True';
      response.programmedReason = programmed.reason;
    }
    if (accepted) {
      response.isAccepted = accepted.status === 'True';
      response.acceptedReason = accepted.reason;
    }
    response.conditions = conditions.map(
      (c): ConditionSummary => ({
        type: c.type ?? '',
        status: c.status ?? 'Unknown',
        reason: c.reason,
        message: c.message,
      })
    );
  }

  return response;
}
