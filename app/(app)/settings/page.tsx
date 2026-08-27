export const dynamic = "force-dynamic"

import { getSavedUrls, getProviderUsage, getCampaignIndustries } from "./actions"
import { getProviderStatus } from "./provider-status"
import { SettingsClient } from "./settings-client"
import { getInboxConfig } from "../inbox/actions"

export default async function SettingsPage() {
  const [savedUrls, providerStatus, providerUsage, inboxConfig, campaignIndustries] = await Promise.all([
    getSavedUrls(),
    getProviderStatus(),
    getProviderUsage(),
    getInboxConfig(),
    getCampaignIndustries(),
  ])
  return <SettingsClient savedUrls={savedUrls} providerStatus={providerStatus} providerUsage={providerUsage} inboxConfig={inboxConfig} campaignIndustries={campaignIndustries} />
}
