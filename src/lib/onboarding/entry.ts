import type {OnboardingState} from './types';
export const dashboardPaths=new Set(['/upcoming','/assignments','/calendar','/sources','/settings','/onboarding']);
export function resolveDashboardEntry(state:OnboardingState,pathname:string):'/onboarding'|null{
  return state.status==='active'&&pathname!=='/onboarding'&&dashboardPaths.has(pathname)?'/onboarding':null;
}
