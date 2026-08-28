/**
 * Updates the ACCOUNT_LIST filter in a Sales Navigator People Search URL.
 * - Keeps all existing list entries (permanent filters from the base URL)
 * - Removes the previously used campaign list (oldListId) if present
 * - Adds the new campaign list
 */
export function updateAccountListInUrl(
  currentUrl: string,
  newListId: string,
  newListName: string,
  oldListId?: string | null
): string {
  const ACCOUNT_LIST_MARKER = "type%3AACCOUNT_LIST"
  const markerIdx = currentUrl.indexOf(ACCOUNT_LIST_MARKER)

  const encodedName = encodeURIComponent(newListName)
    .replace(/%20/g, "%2520")
    .replace(/%2C/g, "%252C")
    .replace(/%3A/g, "%253A")
  const newEntry = `(id%3A${newListId}%2Ctext%3A${encodedName}%2CselectionType%3AINCLUDED%2Cicon%3Alist)`
  const newFilterBlock = `(type%3AACCOUNT_LIST%2Cvalues%3AList(${newEntry}))`

  // No ACCOUNT_LIST in URL yet — inject it into the filters:List(...)
  if (markerIdx === -1) {
    const filtersMarker = "filters%3AList("
    const fIdx = currentUrl.indexOf(filtersMarker)
    if (fIdx === -1) return currentUrl
    const insertAt = fIdx + filtersMarker.length
    // If filters list is non-empty, prepend a comma separator
    const nextChar = currentUrl[insertAt]
    const sep = nextChar === ")" ? "" : "%2C"
    return currentUrl.slice(0, insertAt) + newFilterBlock + sep + currentUrl.slice(insertAt)
  }

  // Find the opening ( of the type:ACCOUNT_LIST group
  const openIdx = currentUrl.lastIndexOf("(", markerIdx)

  // Find the matching closing )
  let depth = 0, closeIdx = -1
  for (let i = openIdx; i < currentUrl.length; i++) {
    if (currentUrl[i] === "(") depth++
    else if (currentUrl[i] === ")") { depth--; if (depth === 0) { closeIdx = i; break } }
  }
  if (closeIdx === -1) return currentUrl

  const block = currentUrl.slice(openIdx, closeIdx + 1)

  // Find values%3AList( and its matching )
  const valuesMarker = "values%3AList("
  const vmIdx = block.indexOf(valuesMarker)
  if (vmIdx === -1) return currentUrl

  const entriesStartIdx = vmIdx + valuesMarker.length

  // Find the matching ) for values%3AList(
  let vd = 0, vCloseIdx = -1
  for (let i = entriesStartIdx - 1; i < block.length; i++) {
    if (block[i] === "(") vd++
    else if (block[i] === ")") { vd--; if (vd === 0) { vCloseIdx = i; break } }
  }
  if (vCloseIdx === -1) return currentUrl

  // Parse individual (entry) items between entriesStartIdx and vCloseIdx
  const entriesStr = block.slice(entriesStartIdx, vCloseIdx)
  const entries: string[] = []
  let d = 0, start = -1
  for (let i = 0; i < entriesStr.length; i++) {
    if (entriesStr[i] === "(") { if (d === 0) start = i; d++ }
    else if (entriesStr[i] === ")") {
      d--
      if (d === 0 && start !== -1) { entries.push(entriesStr.slice(start, i + 1)); start = -1 }
    }
  }

  // Keep all entries except: previous campaign list + any duplicate of the new list
  const filtered = entries.filter((e) => {
    if (oldListId && e.includes(`id%3A${oldListId}`)) return false
    if (e.includes(`id%3A${newListId}`)) return false
    return true
  })

  filtered.push(newEntry)

  const beforeEntries = block.slice(0, entriesStartIdx)
  const afterEntries = block.slice(vCloseIdx) // starts with )
  const newBlock = beforeEntries + filtered.join("%2C") + afterEntries

  return currentUrl.slice(0, openIdx) + newBlock + currentUrl.slice(closeIdx + 1)
}

/**
 * Adds account list exclusions (selectionType:EXCLUDED) to a Sales Navigator Company Search URL.
 * If an ACCOUNT_LIST block already exists (e.g. with INCLUDED entries), adds the EXCLUDED
 * entries inside the same block without touching existing entries.
 * If no ACCOUNT_LIST block exists yet, creates a new one.
 */
export function addExclusionListsToUrl(
  currentUrl: string,
  lists: { id: string; name: string }[]
): string {
  if (!lists.length) return currentUrl

  const ACCOUNT_LIST_MARKER = "type%3AACCOUNT_LIST"
  const markerIdx = currentUrl.indexOf(ACCOUNT_LIST_MARKER)

  const excludedEntries = lists.map(({ id, name }) => {
    const encodedName = encodeURIComponent(name)
      .replace(/%20/g, "%2520")
      .replace(/%2C/g, "%252C")
      .replace(/%3A/g, "%253A")
    return `(id%3A${id}%2Ctext%3A${encodedName}%2CselectionType%3AEXCLUDED%2Cicon%3Alist)`
  })

  // No ACCOUNT_LIST block yet — inject a new one into filters:List(...)
  if (markerIdx === -1) {
    const newBlock = `(type%3AACCOUNT_LIST%2Cvalues%3AList(${excludedEntries.join("%2C")}))`
    const filtersMarker = "filters%3AList("
    const fIdx = currentUrl.indexOf(filtersMarker)
    if (fIdx === -1) return currentUrl
    const insertAt = fIdx + filtersMarker.length
    const nextChar = currentUrl[insertAt]
    const sep = nextChar === ")" ? "" : "%2C"
    return currentUrl.slice(0, insertAt) + newBlock + sep + currentUrl.slice(insertAt)
  }

  // ACCOUNT_LIST block exists — find it and append EXCLUDED entries
  const openIdx = currentUrl.lastIndexOf("(", markerIdx)
  let depth = 0, closeIdx = -1
  for (let i = openIdx; i < currentUrl.length; i++) {
    if (currentUrl[i] === "(") depth++
    else if (currentUrl[i] === ")") { depth--; if (depth === 0) { closeIdx = i; break } }
  }
  if (closeIdx === -1) return currentUrl

  const block = currentUrl.slice(openIdx, closeIdx + 1)
  const valuesMarker = "values%3AList("
  const vmIdx = block.indexOf(valuesMarker)
  if (vmIdx === -1) return currentUrl

  const entriesStartIdx = vmIdx + valuesMarker.length
  let vd = 0, vCloseIdx = -1
  for (let i = entriesStartIdx - 1; i < block.length; i++) {
    if (block[i] === "(") vd++
    else if (block[i] === ")") { vd--; if (vd === 0) { vCloseIdx = i; break } }
  }
  if (vCloseIdx === -1) return currentUrl

  // Parse existing entries
  const entriesStr = block.slice(entriesStartIdx, vCloseIdx)
  const entries: string[] = []
  let d = 0, start = -1
  for (let i = 0; i < entriesStr.length; i++) {
    if (entriesStr[i] === "(") { if (d === 0) start = i; d++ }
    else if (entriesStr[i] === ")") {
      d--
      if (d === 0 && start !== -1) { entries.push(entriesStr.slice(start, i + 1)); start = -1 }
    }
  }

  // Append EXCLUDED entries, skipping any already present
  for (const entry of excludedEntries) {
    const idMatch = entry.match(/id%3A([^%,)]+)/)
    const id = idMatch?.[1]
    if (!id || !entries.some(e => e.includes(`id%3A${id}`) && e.includes("EXCLUDED"))) {
      entries.push(entry)
    }
  }

  const beforeEntries = block.slice(0, entriesStartIdx)
  const afterEntries = block.slice(vCloseIdx)
  const newBlock = beforeEntries + entries.join("%2C") + afterEntries

  return currentUrl.slice(0, openIdx) + newBlock + currentUrl.slice(closeIdx + 1)
}

const COMPANY_FILTER_TYPES = [
  "COMPANY_HEADCOUNT",
  "COMPANY_HEADQUARTERS",
  "COMPANY_TYPE",
  "ACCOUNT_LIST",
  "INDUSTRY",
]

/**
 * Removes company-level filter blocks from a Sales Navigator people search URL.
 * Strips COMPANY_HEADCOUNT, COMPANY_HEADQUARTERS, COMPANY_TYPE, INDUSTRY, and ACCOUNT_LIST
 * (ACCOUNT_LIST gets injected dynamically per campaign via updateAccountListInUrl).
 */
export function stripCompanyFiltersFromUrl(url: string): string {
  const filtersMarker = "filters%3AList("
  const markerIdx = url.indexOf(filtersMarker)
  if (markerIdx === -1) return url

  const listStart = markerIdx + filtersMarker.length

  let depth = 0, listEnd = -1
  for (let i = listStart - 1; i < url.length; i++) {
    if (url[i] === "(") depth++
    else if (url[i] === ")") { depth--; if (depth === 0) { listEnd = i; break } }
  }
  if (listEnd === -1) return url

  const listContent = url.slice(listStart, listEnd)

  const blocks: string[] = []
  let d = 0, start = -1
  for (let i = 0; i < listContent.length; i++) {
    if (listContent[i] === "(") { if (d === 0) start = i; d++ }
    else if (listContent[i] === ")") {
      d--
      if (d === 0 && start !== -1) { blocks.push(listContent.slice(start, i + 1)); start = -1 }
    }
  }

  const kept = blocks.filter(
    (block) => !COMPANY_FILTER_TYPES.some((type) => block.includes(`type%3A${type}`))
  )

  return url.slice(0, listStart) + kept.join("%2C") + url.slice(listEnd)
}
