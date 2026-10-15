import {OnboardingWizard} from '@/features/onboarding/onboarding-wizard';
import {getSourceRuntimeContext} from '@/lib/platform/source-runtime';
import {D1OnboardingRepository} from '@/lib/db/d1/repositories/onboarding';
import {D1SettingsRepository} from '@/lib/db/d1/repositories/settings';
import {D1SourceConnectionRepository} from '@/lib/db/d1/repositories/source-connections';
import {FIREFOX_ADDON_LISTING_URL,getFirefoxDistribution} from '@/lib/extension-distribution';
export default async function OnboardingPage(){
  const {db,scope}=await getSourceRuntimeContext();
  const settings=new D1SettingsRepository(db,scope);
  const state=await new D1OnboardingRepository(db,scope).ensureInitialized();
  const [timeZone,canvas,enabled]=await Promise.all([
    settings.getTimeZone(),
    new D1SourceConnectionRepository(db,scope).getByKind('canvas'),settings.getCanvasSubmissionStatusEnabled(),
  ]);
  return <OnboardingWizard initialState={state} initialTimeZone={timeZone} canvasConnection={canvas} submissionEnabled={enabled} distribution={getFirefoxDistribution({listingUrl:FIREFOX_ADDON_LISTING_URL})}/>;
}
