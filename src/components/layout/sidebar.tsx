'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import {
  IMUS_ONLY,
  ENABLE_PATIENT_PACKAGES,
  ENABLE_SHIFTS,
  ENABLE_DOCTOR_COMMISSIONS,
  ENABLE_SERVICE_BOM,
} from '@/lib/feature-flags';
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Boxes,
  ClipboardList,
  Syringe,
  Gift,
  BadgeDollarSign,
  BarChart3,
  UserCog,
  Clock,
  FileText,
  Building2,
  ChevronRight,
  LogOut,
  Settings,
  X,
  Menu,
  Stethoscope,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ─── Navigation Config ──────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'items' in entry;
}

/**
 * Role-aware navigation builder.
 *
 * Owner sees the full structure including Dashboard and Admin.
 * Non-owner (manager/cashier — same role in the current auth model)
 * sees the full operational toolset minus Dashboard and Admin > Users.
 */
function buildNav(role: 'owner' | 'manager' | 'cashier'): NavEntry[] {
  const isOwner = role === 'owner';
  const nav: NavEntry[] = [];

  // ─── Top-level items ──────────────────────────────────
  if (isOwner) {
    nav.push({ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard });
  }
  nav.push({ href: '/pos', label: 'POS', icon: ShoppingCart });
  nav.push({ href: '/customers', label: 'Customers', icon: Users });

  // ─── Inventory group ──────────────────────────────────
  const inventoryItems: NavItem[] = [
    { href: '/products', label: 'Products', icon: Package },
    { href: '/inventory', label: 'Stock Levels', icon: Boxes },
  ];
  if (ENABLE_SERVICE_BOM) {
    inventoryItems.push({ href: '/inventory-logs', label: 'Stock Logs', icon: ClipboardList });
  }
  nav.push({ id: 'inventory', label: 'Inventory', icon: Boxes, items: inventoryItems });

  // ─── Clinic group ─────────────────────────────────────
  const clinicItems: NavItem[] = [
    { href: '/services', label: 'Services', icon: Syringe },
    { href: '/bundles', label: 'Bundles', icon: Gift },
  ];
  if (ENABLE_PATIENT_PACKAGES) {
    clinicItems.push({ href: '/packages', label: 'Packages', icon: Package });
  }
  if (ENABLE_DOCTOR_COMMISSIONS) {
    clinicItems.push({ href: '/doctors', label: 'Doctors', icon: Stethoscope });
  }
  nav.push({ id: 'clinic', label: 'Clinic', icon: Stethoscope, items: clinicItems });

  // ─── Finance group ────────────────────────────────────
  const financeItems: NavItem[] = [
    { href: '/sales', label: 'Sales', icon: BadgeDollarSign },
  ];
  if (ENABLE_DOCTOR_COMMISSIONS) {
    financeItems.push({ href: '/commissions', label: 'Commissions', icon: Wallet });
  }
  financeItems.push({ href: '/reports', label: 'Reports', icon: BarChart3 });
  nav.push({ id: 'finance', label: 'Finance', icon: BadgeDollarSign, items: financeItems });

  // ─── Admin group (Owner only) ─────────────────────────
  if (isOwner) {
    const adminItems: NavItem[] = [
      { href: '/users', label: 'Users', icon: UserCog },
    ];
    if (ENABLE_SHIFTS) {
      adminItems.push({ href: '/shifts', label: 'Shifts', icon: Clock });
    }
    adminItems.push({ href: '/audit-logs', label: 'Audit Logs', icon: FileText });
    if (!IMUS_ONLY) {
      adminItems.push({ href: '/branches', label: 'Branches', icon: Building2 });
    }
    nav.push({ id: 'admin', label: 'Admin', icon: Settings, items: adminItems });
  }

  // ─── Non-owner top-level extras ───────────────────────
  // Shifts and Audit Logs surface as flat items (not buried in Admin)
  if (!isOwner) {
    if (ENABLE_SHIFTS) {
      nav.push({ href: '/shifts', label: 'Shifts', icon: Clock });
    }
    nav.push({ href: '/audit-logs', label: 'Audit Logs', icon: FileText });
  }

  return nav;
}

// ─── Sidebar Component ──────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, isOwner, isManager, signOut } = useAuth();

  const role = isOwner ? 'owner' : isManager ? 'manager' : 'cashier';
  const nav = buildNav(role);

  // Collapsed groups — auto-expand if a child is active
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Auto-expand groups that contain the active route
  useEffect(() => {
    const newExpanded: Record<string, boolean> = {};
    for (const entry of nav) {
      if (isGroup(entry)) {
        const hasActive = entry.items.some(
          (item) => pathname === item.href || pathname.startsWith(item.href + '/')
        );
        if (hasActive) newExpanded[entry.id] = true;
      }
    }
    setExpanded((prev) => {
      // Only add active expansions; preserve manual collapses for non-active groups
      const merged = { ...prev };
      for (const [key, val] of Object.entries(newExpanded)) {
        if (val) merged[key] = true;
      }
      return merged;
    });
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle group
  const toggleGroup = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // Keyboard shortcut: Ctrl/Cmd+P → POS
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        router.push('/pos');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Sign out with hard redirect
  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      window.location.href = '/login';
    }
  }, [signOut]);

  // Check active
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  // ─── Render nav item ──────────────────────────────────
  const renderNavItem = (item: NavItem, nested = false) => {
    const active = isActive(item.href);
    const isPOS = item.href === '/pos';

    if (isPOS) {
      return (
        <Link
          key={item.href}
          href={item.href}
          className={`group flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-150
            ${active
              ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
              : 'bg-brand-50 text-brand-700 hover:bg-brand-100 hover:shadow-sm'
            }`}
        >
          <item.icon className={`w-[17px] h-[17px] flex-shrink-0 ${active ? 'text-white' : 'text-brand-500 group-hover:text-brand-600'}`} />
          <span>{item.label}</span>
          <kbd className={`ml-auto text-[9px] px-1.5 py-0.5 rounded font-mono ${active ? 'bg-white/20 text-white/70' : 'bg-brand-100 text-brand-400'}`}>
            ⌘P
          </kbd>
        </Link>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex items-center gap-2.5 ${nested ? 'pl-8 pr-3' : 'px-3'} py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150
          ${active
            ? 'bg-brand-50 text-brand-700'
            : 'text-brand-400 hover:bg-brand-50/50 hover:text-brand-600'
          }`}
      >
        <item.icon className={`w-[15px] h-[15px] flex-shrink-0 ${active ? 'text-brand-500' : ''}`} />
        <span>{item.label}</span>
      </Link>
    );
  };

  // ─── Render nav group ─────────────────────────────────
  const renderNavGroup = (group: NavGroup) => {
    const open = expanded[group.id] ?? false;
    const hasActive = group.items.some((item) => isActive(item.href));

    return (
      <div key={group.id}>
        <button
          onClick={() => toggleGroup(group.id)}
          className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150
            ${hasActive
              ? 'text-brand-700'
              : 'text-brand-400 hover:text-brand-600 hover:bg-brand-50/40'
            }`}
        >
          <group.icon className={`w-[15px] h-[15px] flex-shrink-0 ${hasActive ? 'text-brand-500' : ''}`} />
          <span className="flex-1 text-left">{group.label}</span>
          <ChevronRight
            className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
        </button>
        <div
          className={`overflow-hidden transition-all duration-200 ${
            open ? 'max-h-96 opacity-100 mt-0.5' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="space-y-px pb-0.5">
            {group.items.map((item) => renderNavItem(item, true))}
          </div>
        </div>
      </div>
    );
  };

  // ─── Section separator ────────────────────────────────
  const Divider = () => <div className="h-px bg-brand-100/50 mx-3 my-1.5" />;

  // ─── Sidebar content (shared between desktop + mobile) ─
  const sidebarContent = (
    <>
      {/* Brand Header */}
      <div className="px-4 py-3.5 border-b border-brand-100/50 flex items-center justify-between">
        <Link href={role === 'owner' ? '/dashboard' : '/pos'} className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
            <span className="text-xs font-bold text-white font-display">FW</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-brand-900 leading-none">FitWhite</h1>
            <p className="text-[9px] text-brand-400 mt-0.5">Aesthetics · Imus</p>
          </div>
        </Link>
        {/* Mobile close */}
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1 rounded-md text-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <div className="space-y-px">
          {nav.map((entry, i) => {
            // Insert a divider before the first group (visual separation from top-level items)
            const prevEntry = nav[i - 1];
            const needsDivider = isGroup(entry) && prevEntry && !isGroup(prevEntry);

            return (
              <div key={isGroup(entry) ? entry.id : entry.href}>
                {needsDivider && <Divider />}
                {isGroup(entry) ? renderNavGroup(entry) : renderNavItem(entry)}
              </div>
            );
          })}
        </div>
      </nav>

      {/* User Footer */}
      <div className="p-2 border-t border-brand-100/50">
        <Link
          href="/profile"
          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all hover:bg-brand-50/60 ${
            pathname === '/profile' ? 'bg-brand-50 text-brand-700' : ''
          }`}
        >
          <div className="w-7 h-7 rounded-md bg-brand-100 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-semibold text-brand-600">
              {profile?.first_name?.[0]}
              {profile?.last_name?.[0]}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-brand-800 truncate leading-tight">
              {profile?.first_name} {profile?.last_name}
            </p>
            <p className="text-[10px] text-brand-400 capitalize leading-tight">
              {profile?.role}
            </p>
          </div>
        </Link>
        <button
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 mt-0.5 rounded-lg text-xs font-medium
                     text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-all
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <LogOut className="w-3.5 h-3.5" />
          {isSigningOut ? 'Signing out…' : 'Sign Out'}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-xl bg-white border border-brand-200 shadow-sm text-brand-600 hover:bg-brand-50 transition-colors"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 lg:hidden animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-white border-r border-brand-100/80 shadow-sidebar flex flex-col z-50
          lg:hidden transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-64 bg-white border-r border-brand-100/80 shadow-sidebar flex-col z-40">
        {sidebarContent}
      </aside>
    </>
  );
}
