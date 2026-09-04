export const dynamic = "force-dynamic"

import { getCampaignWithAccounts, getAutoCampaignForCampaign, getCompanySearchJobForCampaign } from "./actions"
import { AccountsClient } from "./accounts-client"
import { AutoCampaignPanel } from "./auto-campaign-panel"
import { notFound } from "next/navigation"

export default async function CampaignPage({ params }: { params: { id: string } }) {
  const { id } = await Promise.resolve(params)

  let data
  try {
    data = await getCampaignWithAccounts(id)
  } catch {
    notFound()
  }

  if (!data.campaign) notFound()

  const [autoCampaign, latestJob] = await Promise.all([
    getAutoCampaignForCampaign(id),
    getCompanySearchJobForCampaign(id),
  ])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      {autoCampaign && (
        <AutoCampaignPanel
          campaignId={id}
          initialData={autoCampaign}
          latestJobUrl={latestJob?.sales_nav_url ?? null}
          latestJobStatus={latestJob?.status ?? null}
        />
      )}
      <AccountsClient campaign={data.campaign} initialAccounts={data.accounts} />
    </div>
  )
}
