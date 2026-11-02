import { WorldMarketplaceHub } from '../../../../src/components/giving/WorldMarketplaceHub';
import { WorldLaunchGateBySlug } from '../../../../src/components/worlds/WorldLaunchGate';
import { worldSubScreens } from '../../../../src/components/giving/worldSubScreens';

export default function KnowledgeHubScreen() {
  return (
    <WorldLaunchGateBySlug worldSlug="knowledge">
      <WorldMarketplaceHub
        worldSlug="knowledge"
        icon="school-outline"
        introKey="donations.knowledge.hubBody"
        linksCategory="knowledge"
        subScreens={worldSubScreens('/(tabs)/donations/knowledge/handoffs')}
      />
    </WorldLaunchGateBySlug>
  );
}
