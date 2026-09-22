"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SidebarGroupConfig } from "@/lib/sidebar-config";
import { SECTION_HEADER, ITEM, PRIMARY, FOOTER } from "@/lib/sidebar-config";

export function NavListPanel({ group }: { group: SidebarGroupConfig }) {
  const pathname = usePathname();
  const items = group.items;

  if (!items || items.length === 0) return null;

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Pages</p>
        <div>
          {items.map((item) => {
            const isActive =
              item.route === "/"
                ? pathname === "/"
                : pathname.startsWith(item.route);
            return (
              <Link
                key={item.route}
                href={item.route}
                className={`${ITEM} ${isActive ? "bg-muted" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className={PRIMARY}>{item.label}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
      <Link href={group.route} className={FOOTER}>
        View All →
      </Link>
    </>
  );
}
