import { getCampaigns, getCompanySearchJobs } from "./actions"
import { getInboxConfig } from "../inbox/actions"
import { CompanySearchClient } from "./company-search-client"

export const dynamic = "force-dynamic"

export default async function CompanySearchPage() {
  const [campaigns, jobs, config] = await Promise.all([getCampaigns(), getCompanySearchJobs(), getInboxConfig()])
  return <CompanySearchClient campaigns={campaigns} initialJobs={jobs} initialExcludePrevious={config.exclude_previous ?? false} />
}
