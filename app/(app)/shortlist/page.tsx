export const dynamic = "force-dynamic"

import { getShortlistedProspects } from "./actions"
import { getInboxConfig } from "../inbox/actions"
import { ShortlistClient } from "./shortlist-client"

export default async function ShortlistPage() {
  const [prospects, inboxConfig] = await Promise.all([
    getShortlistedProspects(),
    getInboxConfig(),
  ])
  return <ShortlistClient initialProspects={prospects} inboxConfig={inboxConfig} />
}
