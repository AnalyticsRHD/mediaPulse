'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useRef, useState } from 'react';
import styles from './AppSidebar.module.css';

export type AppSidebarItem = 'control' | 'forecast' | 'credit-alloc' | 'panel';

type SidebarUser = {
  name: string;
  email: string;
  role: 'ADMIN' | 'MEDIA' | 'CLIENT';
};

type AppSidebarProps = {
  activeItem: AppSidebarItem;
  children: ReactNode;
  user: SidebarUser;
  onLogout: () => void;
  onNavigate?: (item: AppSidebarItem) => void;
};

type NavigationItem = {
  id: AppSidebarItem;
  href: string;
  label: string;
  icon: 'control' | 'forecast' | 'credit' | 'panel';
  adminOnly?: boolean;
};

const navigationItems: NavigationItem[] = [
  { id: 'control', href: '/control', label: 'Control', icon: 'control' },
  { id: 'forecast', href: '/carga-manual', label: 'Forecast', icon: 'forecast' },
  { id: 'credit-alloc', href: '/CreditAlloc', label: 'Credit Alloc', icon: 'credit', adminOnly: true },
  { id: 'panel', href: '/panel', label: 'Panel', icon: 'panel', adminOnly: true }
];

const roleLabels: Record<SidebarUser['role'], string> = {
  ADMIN: 'Admin',
  MEDIA: 'Media',
  CLIENT: 'Client'
};

export function AppSidebar({ activeItem, children, user, onLogout, onNavigate }: AppSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [activeItem]);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileOpen]);

  function closeMobileMenu(restoreFocus = false) {
    setMobileOpen(false);
    if (restoreFocus) window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }

  function handleNavigation(event: React.MouseEvent<HTMLAnchorElement>, item: NavigationItem) {
    closeMobileMenu();
    if (!onNavigate) return;
    event.preventDefault();
    onNavigate(item.id);
  }

  const initials = getInitials(user.name || user.email);

  return (
    <div className={styles.appFrame}>
      <button
        ref={menuButtonRef}
        className={styles.mobileMenuButton}
        type="button"
        aria-label="Abrir menu de navegacion"
        aria-controls="mediapulse-sidebar"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
      >
        <MenuIcon />
        <span>Menu</span>
      </button>

      {mobileOpen ? (
        <button
          className={styles.backdrop}
          type="button"
          aria-label="Cerrar menu de navegacion"
          onClick={() => closeMobileMenu(true)}
        />
      ) : null}

      <aside
        ref={sidebarRef}
        id="mediapulse-sidebar"
        className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ''}`}
        aria-label="Navegacion de MediaPulse"
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? true : undefined}
      >
        <div className={styles.brandRow}>
          <Link
            className={styles.brand}
            href="/control"
            aria-label="Ir a Control"
            onClick={() => closeMobileMenu()}
          >
            <MediaPulseMark />
            <span className={styles.brandLabel}>MEDIAPULSE</span>
          </Link>
          <button
            ref={closeButtonRef}
            className={styles.mobileCloseButton}
            type="button"
            aria-label="Cerrar menu de navegacion"
            onClick={() => closeMobileMenu(true)}
          >
            <CloseIcon />
          </button>
        </div>

        <nav className={styles.navigation} aria-label="Vistas principales">
          {navigationItems
            .filter((item) => !item.adminOnly || user.role === 'ADMIN')
            .map((item) => (
              <Link
                key={item.id}
                className={`${styles.navigationLink} ${activeItem === item.id ? styles.active : ''}`}
                href={item.href}
                aria-current={activeItem === item.id ? 'page' : undefined}
                title={item.label}
                onClick={(event) => handleNavigation(event, item)}
              >
                <NavigationIcon name={item.icon} />
                <span className={styles.navigationLabel}>{item.label}</span>
              </Link>
            ))}
        </nav>

        <div className={styles.accountArea}>
          <div className={styles.accountSummary} title={user.email}>
            <span className={styles.avatar} aria-hidden="true">{initials}</span>
            <span className={styles.accountCopy}>
              <strong>{roleLabels[user.role]}</strong>
              <small>{user.email}</small>
            </span>
          </div>
          <button
            className={styles.logoutButton}
            type="button"
            title="Cerrar sesion"
            onClick={onLogout}
          >
            <LogoutIcon />
            <span className={styles.logoutLabel}>Cerrar sesion</span>
          </button>
        </div>
      </aside>

      <div className={styles.content}>{children}</div>
    </div>
  );
}

function getInitials(value: string) {
  const normalized = value.trim();
  if (!normalized) return 'MP';

  const parts = normalized.includes('@')
    ? normalized.split('@')[0].split(/[._-]+/)
    : normalized.split(/\s+/);

  return parts
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'MP';
}

function MediaPulseMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <img className={styles.brandMarkImage} src="/assets/rhd-no-bg.png" alt="" />
    </span>
  );
}

function NavigationIcon({ name }: { name: NavigationItem['icon'] }) {
  if (name === 'control') {
    return (
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M3.5 11.2 12 4l8.5 7.2" />
        <path d="M5.7 10.5v9h12.6v-9M9.5 19.5v-5.8h5v5.8" />
      </svg>
    );
  }

  if (name === 'forecast') {
    return (
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 19.5h16M6.5 17V9.8M11.8 17V5M17.2 17v-4.5" />
        <path d="m5.8 7.4 5.5-4 5.1 4.1 3.3-3" />
      </svg>
    );
  }

  if (name === 'credit') {
    return (
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3.2" y="6.2" width="17.6" height="12" rx="2" />
        <path d="M3.2 10.3h17.6M7 15h3.2" />
      </svg>
    );
  }

  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 20V8.2L12 4l8 4.2V20" />
      <path d="M8 10.2h1M11.5 10.2h1M15 10.2h1M8 13.7h1M11.5 13.7h1M15 13.7h1M9.5 20v-3h5v3M2.8 20h18.4" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className={styles.buttonIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className={styles.buttonIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10 5H5.5v14H10M14.5 8l4 4-4 4M8.5 12h10" />
    </svg>
  );
}
