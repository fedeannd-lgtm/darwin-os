export const dynamic = "force-dynamic"

import { getSavedUrls, getProviderUsage, getCampaignIndustries, getClientCompanies } from "./actions"
import { getProviderStatus } from "./provider-status"
import { SettingsClient } from "./settings-client"
import { getInboxConfig } from "../inbox/actions"

export default async function SettingsPage() {
  const [savedUrls, providerStatus, providerUsage, inboxConfig, campaignIndustries, clientCompanies] = await Promise.all([
    getSavedUrls(),
    getProviderStatus(),
    getProviderUsage(),
    getInboxConfig(),
    getCampaignIndustries(),
    getClientCompanies(),
  ])
  return <SettingsClient savedUrls={savedUrls} providerStatus={providerStatus} providerUsage={providerUsage} inboxConfig={inboxConfig} campaignIndustries={campaignIndustries} clientCompanies={clientCompanies} />
}
