import {SettingsContent} from '@/features/settings/settings-content';
import {getAccountSummary} from '@/lib/account/account-summary';
import {getSourceRuntimeContext} from '@/lib/platform/source-runtime';
import {D1SourceConnectionRepository} from '@/lib/db/d1/repositories/source-connections';

export default async function SettingsPage(){
  const {db,scope}=await getSourceRuntimeContext();
  const [account,canvasConnection]=await Promise.all([
    getAccountSummary(db,scope),new D1SourceConnectionRepository(db,scope).getByKind('canvas'),
  ]);
  return <SettingsContent account={account} canvasConnection={canvasConnection}/>;
}
