"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Building2, Users, UserCheck, Briefcase, Sparkles, Send, Settings, Inbox, Star } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/company-search", label: "Company Search", icon: Building2 },
  { href: "/accounts", label: "Empresas", icon: Briefcase },
  { href: "/people-search", label: "People Search", icon: Users },
  { href: "/prospects", label: "Prospectos", icon: UserCheck },
  { href: "/enrichment", label: "Enrichment", icon: Sparkles },
  { href: "/shortlist", label: "Shortlist", icon: Star },
  { href: "/distribution", label: "Distribution", icon: Send },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppSidebar({ inboxCount = 0 }: { inboxCount?: number }) {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <span className="text-base font-semibold tracking-tight">ProspectOS</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Módulos</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={pathname.startsWith(item.href)}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                    {item.href === "/inbox" && inboxCount > 0 && (
                      <span className="ml-auto inline-flex items-center rounded-full bg-primary px-1.5 py-0 text-[10px] font-medium text-primary-foreground">
                        {inboxCount}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
