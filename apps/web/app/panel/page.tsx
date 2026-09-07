'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppSidebar } from '../components/AppSidebar';
import { BrandLoader } from '../components/BrandLoader';
import styles from './panel.module.css';
import { DatabaseExport } from './DatabaseExport';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3333';
const SESSION_STORAGE_KEY = 'mediapulse-auth';

type UserRole = 'ADMIN' | 'MEDIA' | 'CLIENT';

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

type AdvertisingPlatform = 'META' | 'Google' | 'MELI' | 'TikTok';

type PlatformAccount = {
  id: string;
  platform: AdvertisingPlatform;
  accountId: string;
};

type ManagedBrandMapping = {
  id: string;
  cliente: string;
  marca: string;
  accounts: PlatformAccount[];
  enabled: boolean;
  suspendedAt?: string | null;
};

type UserFormState = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
};

type AdvertiserFormState = {
  cliente: string;
  marca: string;
};

type ApiAccountBatchFormState = {
  platform: AdvertisingPlatform;
  accountIds: string;
  accountName: string;
};

type Notice = {
  tone: 'success' | 'error';
  message: string;
} | null;

type AuthState = 'checking' | 'ready' | 'error';
type UserEditorTab = 'create' | 'edit';
type MappingEditorTab = 'create' | 'edit';

const EMPTY_USER_FORM: UserFormState = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  role: 'CLIENT'
};

const EMPTY_ADVERTISER_FORM: AdvertiserFormState = {
  cliente: '',
  marca: ''
};

const EMPTY_API_ACCOUNT_BATCH_FORM: ApiAccountBatchFormState = {
  platform: 'META',
  accountIds: '',
  accountName: ''
};

const PLATFORM_LABELS: Record<AdvertisingPlatform, string> = {
  META: 'Meta Ads',
  Google: 'Google Ads',
  MELI: 'Mercado Libre',
  TikTok: 'TikTok Ads'
};

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Admin',
  MEDIA: 'Media',
  CLIENT: 'Client'
};

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function apiRequest<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    cache: options.cache ?? 'no-store'
  });

  const payload = response.status === 204
    ? null
    : await response.json().catch(() => null) as { message?: string | string[] } | null;

  if (!response.ok) {
    const rawMessage = payload?.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(', ')
      : rawMessage || 'No se pudo completar la operación';
    throw new ApiRequestError(message, response.status);
  }

  return payload as T;
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function sortUsers(users: AuthUser[]): AuthUser[] {
  return [...users].sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

function sortMappings(mappings: ManagedBrandMapping[]): ManagedBrandMapping[] {
  return [...mappings].sort((left, right) => (
    left.cliente.localeCompare(right.cliente, 'es')
    || left.marca.localeCompare(right.marca, 'es')
  ));
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M3.5 19c.3-4 2.2-6 5.5-6s5.2 2 5.5 6M14 14c3.7-.8 6.2 1 6.5 4" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 21V4h10v17M15 9h4v12M3 21h18M8 8h1M12 8h1M8 12h1M12 12h1M8 16h1M12 16h1" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8 4 20ZM14.7 6.1l3.2 3.2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  );
}

function PlatformSelect({
  value,
  onChange,
  disabled = false
}: {
  value: AdvertisingPlatform;
  onChange: (value: AdvertisingPlatform) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`${styles.platformSelect} ${open ? styles.platformSelectOpen : ''}`}>
      <button
        className={styles.platformSelectTrigger}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <span>{PLATFORM_LABELS[value]}</span>
        <span className={styles.platformSelectArrow} aria-hidden="true">▼</span>
      </button>
      {open ? (
        <div className={styles.platformSelectMenu} role="listbox" aria-label="Plataforma">
          {(Object.keys(PLATFORM_LABELS) as AdvertisingPlatform[]).map((platform) => (
            <button
              className={platform === value ? styles.platformSelectOptionSelected : styles.platformSelectOption}
              key={platform}
              type="button"
              role="option"
              aria-selected={platform === value}
              onClick={() => {
                onChange(platform);
                setOpen(false);
              }}
            >
              {PLATFORM_LABELS[platform]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;

  return (
    <div
      className={`${styles.notice} ${notice.tone === 'error' ? styles.noticeError : styles.noticeSuccess}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      {notice.message}
    </div>
  );
}

export default function AdminPanelPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [authError, setAuthError] = useState('');
  const [authAttempt, setAuthAttempt] = useState(0);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState('');

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersLoadError, setUsersLoadError] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userEditorTab, setUserEditorTab] = useState<UserEditorTab>('create');
  const [userForm, setUserForm] = useState<UserFormState>(EMPTY_USER_FORM);
  const [userSaving, setUserSaving] = useState(false);
  const [userNotice, setUserNotice] = useState<Notice>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);
  const [userDeleting, setUserDeleting] = useState(false);

  const [mappings, setMappings] = useState<ManagedBrandMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(true);
  const [mappingsLoadError, setMappingsLoadError] = useState('');
  const [advertiserForm, setAdvertiserForm] = useState<AdvertiserFormState>(EMPTY_ADVERTISER_FORM);
  const [mappingEditorTab, setMappingEditorTab] = useState<MappingEditorTab>('create');
  const [selectedMappingId, setSelectedMappingId] = useState<string | null>(null);
  const [advertiserSaving, setAdvertiserSaving] = useState(false);
  const [advertiserNotice, setAdvertiserNotice] = useState<Notice>(null);
  const [mappingStatusTarget, setMappingStatusTarget] = useState<ManagedBrandMapping | null>(null);
  const [apiAccountNotice, setApiAccountNotice] = useState<Notice>(null);
  const [apiAccountBatchForm, setApiAccountBatchForm] = useState<ApiAccountBatchFormState>(EMPTY_API_ACCOUNT_BATCH_FORM);
  const [apiAccountBatchSaving, setApiAccountBatchSaving] = useState(false);

  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function validateSession() {
      setAuthState('checking');
      setAuthError('');
      setAuthUser(null);
      setAuthToken('');

      let token = '';
      try {
        const rawSession = localStorage.getItem(SESSION_STORAGE_KEY);
        if (rawSession) {
          const parsed = JSON.parse(rawSession) as { token?: unknown };
          if (typeof parsed.token === 'string') token = parsed.token;
        }
      } catch {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }

      if (!token) {
        router.replace('/login?from=/panel');
        return;
      }

      try {
        const confirmedUser = await apiRequest<AuthUser>('/auth/me', token);
        if (cancelled) return;

        if (confirmedUser.role !== 'ADMIN') {
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token, user: confirmedUser }));
          router.replace('/control');
          return;
        }

        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token, user: confirmedUser }));
        setAuthToken(token);
        setAuthUser(confirmedUser);
        setAuthState('ready');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
          localStorage.removeItem(SESSION_STORAGE_KEY);
          router.replace('/login?from=/panel');
          return;
        }

        setAuthError(error instanceof Error ? error.message : 'No se pudo validar la sesión');
        setAuthState('error');
      }
    }

    void validateSession();
    return () => {
      cancelled = true;
    };
  }, [authAttempt, router]);

  const request = useCallback(async function request<T>(path: string, options?: RequestInit): Promise<T> {
    try {
      return await apiRequest<T>(path, authToken, options);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setAuthUser(null);
        setAuthToken('');
        router.replace('/login?from=/panel');
      } else if (error instanceof ApiRequestError && error.status === 403) {
        setAuthUser(null);
        router.replace('/control');
      }
      throw error;
    }
  }, [authToken, router]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersLoadError('');
    try {
      const payload = await request<AuthUser[]>('/auth/users');
      setUsers(sortUsers(Array.isArray(payload) ? payload : []));
    } catch (error) {
      setUsersLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los usuarios');
    } finally {
      setUsersLoading(false);
    }
  }, [request]);

  const loadMappings = useCallback(async () => {
    setMappingsLoading(true);
    setMappingsLoadError('');
    try {
      const payload = await request<ManagedBrandMapping[]>('/brand-mapping/management');
      setMappings(sortMappings(Array.isArray(payload) ? payload : []));
    } catch (error) {
      setMappingsLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los anunciantes');
    } finally {
      setMappingsLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (authState !== 'ready' || !authToken) return;
    void Promise.all([loadUsers(), loadMappings()]);
  }, [authState, authToken, loadMappings, loadUsers]);

  useEffect(() => {
    if (!deleteTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !userDeleting) setDeleteTarget(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [deleteTarget, userDeleting]);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users]
  );

  const normalizedQuery = normalizeSearch(search);
  const filteredUsers = useMemo(() => {
    if (!normalizedQuery) return users;
    return users.filter((user) => normalizeSearch(
      `${user.name} ${user.email} ${user.role} ${ROLE_LABELS[user.role]}`
    ).includes(normalizedQuery));
  }, [normalizedQuery, users]);

  const filteredMappings = useMemo(() => {
    if (!normalizedQuery) return mappings;
    return mappings.filter((mapping) => normalizeSearch(
      `${mapping.cliente} ${mapping.marca}`
    ).includes(normalizedQuery));
  }, [mappings, normalizedQuery]);

  function handleLogout() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setAuthUser(null);
    setAuthToken('');
    router.replace('/login');
  }

  function beginCreateMapping() {
    setMappingEditorTab('create');
    setSelectedMappingId(null);
    setAdvertiserForm(EMPTY_ADVERTISER_FORM);
    setAdvertiserNotice(null);
  }

  function beginEditMapping(mapping: ManagedBrandMapping) {
    setMappingEditorTab('edit');
    setSelectedMappingId(mapping.id);
    setAdvertiserForm({ cliente: mapping.cliente, marca: mapping.marca });
    setAdvertiserNotice(null);
  }

  function beginCreateUser() {
    setUserEditorTab('create');
    setSelectedUserId(null);
    setUserForm(EMPTY_USER_FORM);
    setUserNotice(null);
    document.getElementById('user-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function beginEditUser(user: AuthUser) {
    setUserEditorTab('edit');
    setSelectedUserId(user.id);
    setUserForm({
      name: user.name,
      email: user.email,
      password: '',
      confirmPassword: '',
      role: user.role
    });
    setUserNotice(null);
    document.getElementById('user-editor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserNotice(null);

    const name = userForm.name.trim();
    const email = userForm.email.trim();
    const editing = Boolean(selectedUserId);

    if (!name || !email) {
      setUserNotice({ tone: 'error', message: 'Nombre y email son obligatorios.' });
      return;
    }
    if (!editing && !userForm.password) {
      setUserNotice({ tone: 'error', message: 'La contraseña es obligatoria para un usuario nuevo.' });
      return;
    }
    if (userForm.password && userForm.password.length < 6) {
      setUserNotice({ tone: 'error', message: 'La contraseña debe tener al menos 6 caracteres.' });
      return;
    }
    if (userForm.password !== userForm.confirmPassword) {
      setUserNotice({ tone: 'error', message: 'Las contraseñas no coinciden.' });
      return;
    }

    setUserSaving(true);
    try {
      const body = editing
        ? {
            name,
            email,
            role: userForm.role,
            ...(userForm.password ? { password: userForm.password } : {})
          }
        : {
            name,
            email,
            password: userForm.password,
            role: userForm.role
          };
      const saved = await request<AuthUser>(
        editing ? `/auth/users/${encodeURIComponent(selectedUserId as string)}` : '/auth/users',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify(body)
        }
      );

      setUsers((current) => sortUsers([
        ...current.filter((user) => user.id !== saved.id),
        saved
      ]));
      setUserEditorTab('edit');
      setSelectedUserId(saved.id);
      setUserForm({
        name: saved.name,
        email: saved.email,
        password: '',
        confirmPassword: '',
        role: saved.role
      });

      if (saved.id === authUser?.id) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: authToken, user: saved }));
        setAuthUser(saved);
        if (saved.role !== 'ADMIN') {
          router.replace('/control');
          return;
        }
      }

      setUserNotice({
        tone: 'success',
        message: editing ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.'
      });
    } catch (error) {
      setUserNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'No se pudo guardar el usuario.'
      });
    } finally {
      setUserSaving(false);
    }
  }

  async function confirmDeleteUser() {
    if (!deleteTarget) return;
    setUserDeleting(true);
    setUserNotice(null);

    try {
      await request<void>(`/auth/users/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      setUsers((current) => current.filter((user) => user.id !== deleteTarget.id));
      if (selectedUserId === deleteTarget.id) {
        setSelectedUserId(null);
        setUserForm(EMPTY_USER_FORM);
      }
      setUserNotice({ tone: 'success', message: `${deleteTarget.name} fue eliminado.` });
      setDeleteTarget(null);
    } catch (error) {
      setUserNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'No se pudo eliminar el usuario.'
      });
    } finally {
      setUserDeleting(false);
    }
  }

  async function saveAdvertiser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdvertiserNotice(null);

    const cliente = advertiserForm.cliente.trim();
    const marca = advertiserForm.marca.trim();
    if (!cliente || !marca) {
      setAdvertiserNotice({ tone: 'error', message: 'Anunciante y marca son obligatorios.' });
      return;
    }

    setAdvertiserSaving(true);
    try {
      const saved = await request<ManagedBrandMapping>('/brand-mapping', {
        method: 'POST',
        body: JSON.stringify({ cliente, marca })
      });
      setMappings((current) => sortMappings([
        ...current.filter((mapping) => mapping.id !== saved.id),
        saved
      ]));
      setMappingEditorTab('edit');
      setSelectedMappingId(saved.id);
      setAdvertiserForm({
        cliente: saved.cliente,
        marca: saved.marca
      });
      setAdvertiserNotice({
        tone: 'success',
        message: `${saved.cliente} / ${saved.marca} fue guardado correctamente.`
      });
    } catch (error) {
      setAdvertiserNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'No se pudo guardar el anunciante.'
      });
    } finally {
      setAdvertiserSaving(false);
    }
  }

  async function toggleMappingSuspension(mapping: ManagedBrandMapping) {
    const suspended = mapping.enabled !== false;
    setAdvertiserNotice(null);
    try {
      const updated = await request<ManagedBrandMapping>(
        `/brand-mapping/${encodeURIComponent(mapping.id)}/suspension`,
        { method: 'PATCH', body: JSON.stringify({ suspended }) }
      );
      setMappings((current) => current.map((item) => (
        item.id === mapping.id
          ? { ...item, enabled: updated.enabled, suspendedAt: updated.suspendedAt }
          : item
      )));
      setAdvertiserNotice({
        tone: 'success',
        message: suspended
          ? `${mapping.cliente} / ${mapping.marca} fue suspendido.`
          : `${mapping.cliente} / ${mapping.marca} fue reactivado.`
      });
    } catch (error) {
      setAdvertiserNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'No se pudo cambiar el estado de la relación.'
      });
    }
  }

  async function confirmMappingStatusChange() {
    if (!mappingStatusTarget) return;
    const target = mappingStatusTarget;
    setMappingStatusTarget(null);
    await toggleMappingSuspension(target);
  }

  async function saveApiAccountBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApiAccountNotice(null);
    const accountIds = apiAccountBatchForm.accountIds
      .split(/[\s,;]+/)
      .map((accountId) => accountId.trim())
      .filter(Boolean);
    if (accountIds.length === 0) {
      setApiAccountNotice({ tone: 'error', message: 'Pegue al menos un Account ID.' });
      return;
    }

    setApiAccountBatchSaving(true);
    try {
      const saved = await request<unknown[]>(`/brand-mapping/api-accounts/${apiAccountBatchForm.platform.toLowerCase() === 'meli' ? 'mercado-libre' : apiAccountBatchForm.platform.toLowerCase()}`, {
        method: 'POST',
        body: JSON.stringify({
          accountId: accountIds,
          ...(apiAccountBatchForm.accountName.trim() ? { accountName: apiAccountBatchForm.accountName.trim() } : {})
        })
      });
      setApiAccountBatchForm((current) => ({ ...current, accountIds: '' }));
      setApiAccountNotice({ tone: 'success', message: `${saved.length} cuenta${saved.length === 1 ? '' : 's'} cargada${saved.length === 1 ? '' : 's'} correctamente.` });
    } catch (error) {
      setApiAccountNotice({ tone: 'error', message: error instanceof Error ? error.message : 'No se pudieron cargar las cuentas.' });
    } finally {
      setApiAccountBatchSaving(false);
    }
  }

  if (authState === 'checking') {
    return (
      <main className={styles.authGate}>
        <BrandLoader label="Validando sesión" />
      </main>
    );
  }

  if (authState === 'error') {
    return (
      <main className={styles.authGate}>
        <section className={styles.authErrorCard} aria-labelledby="auth-error-title">
          <span className={styles.authErrorMark} aria-hidden="true">!</span>
          <h1 id="auth-error-title">No pudimos validar tu sesión</h1>
          <p>{authError}</p>
          <button type="button" onClick={() => setAuthAttempt((current) => current + 1)}>
            Reintentar
          </button>
        </section>

      </main>
    );
  }

  if (!authUser) return null;

  return (
    <AppSidebar user={authUser} activeItem="panel" onLogout={handleLogout}>
      <main className={styles.mainContent} id="main-content">
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Panel</p>
            <h1>Administración</h1>
          </div>

          <label className={styles.searchBox}>
            <span className={styles.visuallyHidden}>Buscar usuarios, anunciantes o cuentas</span>
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar en el panel..."
            />
          </label>

        </header>

        <DatabaseExport token={authToken} userId={authUser.id} />

        <div className={styles.usersGrid}>
          <section className={`${styles.card} ${styles.usersCard}`} aria-labelledby="users-title">
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon}><UsersIcon /></span>
              <div>
                <h2 id="users-title">Gestión de usuarios</h2>
                <p>Administre los accesos y roles del sistema.</p>
              </div>
              <button
                className={styles.refreshButton}
                type="button"
                onClick={() => void loadUsers()}
                disabled={usersLoading}
              >
                {usersLoading ? 'Cargando…' : 'Actualizar'}
              </button>
            </div>

            {usersLoadError ? (
              <div className={styles.loadError} role="alert">
                <span>{usersLoadError}</span>
                <button type="button" onClick={() => void loadUsers()}>Reintentar</button>
              </div>
            ) : null}

            <div className={styles.tableScroller}>
              <table className={styles.dataTable}>
                <caption className={styles.visuallyHidden}>Usuarios activos de MediaPulse</caption>
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Email</th>
                    <th scope="col">Rol</th>
                    <th scope="col" className={styles.actionsColumn}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className={selectedUserId === user.id ? styles.selectedRow : undefined}>
                      <td data-label="Nombre">{user.name}</td>
                      <td data-label="Email">{user.email}</td>
                      <td data-label="Rol">
                        <span className={`${styles.roleBadge} ${styles[`role${user.role}`]}`}>
                          {ROLE_LABELS[user.role]}
                        </span>
                      </td>
                      <td data-label="Acciones" className={styles.rowActions}>
                        <button
                          className={styles.iconButton}
                          type="button"
                          onClick={() => beginEditUser(user)}
                          aria-label={`Editar a ${user.name}`}
                          title="Editar usuario"
                        >
                          <EditIcon />
                        </button>
                        <button
                          className={`${styles.iconButton} ${styles.deleteIconButton}`}
                          type="button"
                          onClick={() => setDeleteTarget(user)}
                          aria-label={`Eliminar a ${user.name}`}
                          title="Eliminar usuario"
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!usersLoading && filteredUsers.length === 0 ? (
                    <tr>
                      <td className={styles.emptyCell} colSpan={4}>
                        {search ? 'No hay usuarios que coincidan con la búsqueda.' : 'No hay usuarios activos.'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className={styles.tableFooter} aria-live="polite">
              {usersLoading
                ? 'Cargando usuarios…'
                : `${filteredUsers.length} de ${users.length} ${users.length === 1 ? 'usuario' : 'usuarios'}`}
            </p>
          </section>

          <section className={`${styles.card} ${styles.editorCard}`} id="user-editor" aria-labelledby="user-editor-title">
            <div className={styles.userTabs} role="tablist" aria-label="Gestión de usuarios">
              <button
                className={userEditorTab === 'edit' ? styles.activeUserTab : undefined}
                type="button"
                role="tab"
                aria-selected={userEditorTab === 'edit'}
                onClick={() => setUserEditorTab('edit')}
              >
                Editar usuario
              </button>
              <button
                className={userEditorTab === 'create' ? styles.activeUserTab : undefined}
                type="button"
                role="tab"
                aria-selected={userEditorTab === 'create'}
                onClick={beginCreateUser}
              >
                Crear nuevo usuario
              </button>
            </div>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon}><UsersIcon /></span>
              <div>
                <h2 id="user-editor-title">{userEditorTab === 'edit' ? 'Editar usuario' : 'Crear usuario'}</h2>
                <p>{userEditorTab === 'edit' ? 'Actualice sus datos de acceso.' : 'Complete los datos del nuevo acceso.'}</p>
              </div>
            </div>

            {userEditorTab === 'edit' ? (
              <label className={styles.field}>
                <span>Usuario</span>
                <select
                  value={selectedUserId ?? ''}
                  onChange={(event) => {
                    const user = users.find((item) => item.id === event.target.value);
                    if (user) beginEditUser(user);
                  }}
                  disabled={userSaving || usersLoading}
                >
                  <option value="">Seleccione un usuario</option>
                  {users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}
                </select>
              </label>
            ) : null}

            <NoticeBanner notice={userNotice} />

            {userEditorTab === 'edit' && !selectedUser ? (
              <p className={styles.emptyEditor}>Seleccione un usuario para editar sus datos.</p>
            ) : (
            <form className={styles.form} onSubmit={saveUser}>
              <div className={styles.twoFields}>
                <label className={styles.field}>
                  <span>Nombre</span>
                  <input
                    type="text"
                    value={userForm.name}
                    onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ej: Juan López"
                    autoComplete="name"
                    maxLength={200}
                    required
                    disabled={userSaving}
                  />
                </label>
                <label className={styles.field}>
                  <span>Email</span>
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="usuario@empresa.com"
                    autoComplete="email"
                    required
                    disabled={userSaving}
                  />
                </label>
              </div>

              <div className={styles.twoFields}>
                <label className={styles.field}>
                  <span>Contraseña {selectedUser ? <small>(opcional)</small> : null}</span>
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder={selectedUser ? 'Dejar vacía para conservar' : 'Mínimo 6 caracteres'}
                    autoComplete="new-password"
                    minLength={6}
                    required={!selectedUser}
                    disabled={userSaving}
                  />
                </label>
                <label className={styles.field}>
                  <span>Confirmar contraseña</span>
                  <input
                    type="password"
                    value={userForm.confirmPassword}
                    onChange={(event) => setUserForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    placeholder="Repetir contraseña"
                    autoComplete="new-password"
                    required={!selectedUser || Boolean(userForm.password)}
                    disabled={userSaving}
                  />
                </label>
              </div>

              <label className={styles.field}>
                <span>Rol</span>
                <select
                  value={userForm.role}
                  onChange={(event) => setUserForm((current) => ({
                    ...current,
                    role: event.target.value as UserRole
                  }))}
                  disabled={userSaving}
                >
                  <option value="CLIENT">Client</option>
                  <option value="MEDIA">Media</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>

              <div className={styles.formActions}>
                <button className={styles.primaryButton} type="submit" disabled={userSaving}>
                  {userSaving ? 'Guardando…' : selectedUser ? 'Guardar cambios' : 'Crear usuario'}
                </button>
                {selectedUser ? (
                  <button className={styles.secondaryButton} type="button" onClick={beginCreateUser} disabled={userSaving}>
                    Cancelar edición
                  </button>
                ) : null}
                {selectedUser ? (
                  <button
                    className={styles.dangerButton}
                    type="button"
                    onClick={() => setDeleteTarget(selectedUser)}
                    disabled={userSaving}
                  >
                    <TrashIcon />
                    Eliminar usuario
                  </button>
                ) : null}
              </div>
            </form>
            )}
          </section>
        </div>

        <section className={`${styles.card} ${styles.advertisersCard}`} aria-labelledby="advertisers-title">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><BuildingIcon /></span>
            <div>
              <h2 id="advertisers-title">Anunciantes y marcas</h2>
              <p>Cree y administre las relaciones de anunciantes y marcas.</p>
            </div>
            <button
              className={styles.refreshButton}
              type="button"
              onClick={() => void loadMappings()}
              disabled={mappingsLoading}
            >
              {mappingsLoading ? 'Cargando…' : 'Actualizar'}
            </button>
          </div>

          <div className={styles.advertisersGrid}>
            <form className={`${styles.form} ${styles.advertiserForm}`} onSubmit={saveAdvertiser}>
              <div className={styles.userTabs} role="tablist" aria-label="Gestión de relaciones">
                <button
                  className={mappingEditorTab === 'edit' ? styles.activeUserTab : undefined}
                  type="button"
                  role="tab"
                  aria-selected={mappingEditorTab === 'edit'}
                  onClick={() => setMappingEditorTab('edit')}
                >
                  Editar relación
                </button>
                <button
                  className={mappingEditorTab === 'create' ? styles.activeUserTab : undefined}
                  type="button"
                  role="tab"
                  aria-selected={mappingEditorTab === 'create'}
                  onClick={beginCreateMapping}
                >
                  Crear relación
                </button>
              </div>
              <div className={styles.formHeading}>
                <h3>{mappingEditorTab === 'edit' ? 'Editar anunciante y marca' : 'Alta de anunciante y marca'}</h3>
                <p>{mappingEditorTab === 'edit' ? 'Actualice los datos de la relación.' : 'Complete los datos del nuevo anunciante.'}</p>
              </div>

              {mappingEditorTab === 'edit' ? (
                <label className={styles.field}>
                  <span>Relación</span>
                  <select
                    value={selectedMappingId ?? ''}
                    onChange={(event) => {
                      const mapping = mappings.find((item) => item.id === event.target.value);
                      if (mapping) beginEditMapping(mapping);
                    }}
                    disabled={advertiserSaving || mappingsLoading}
                  >
                    <option value="">Seleccione una relación</option>
                    {mappings.map((mapping) => (
                      <option key={mapping.id} value={mapping.id}>{mapping.cliente} · {mapping.marca}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              <NoticeBanner notice={advertiserNotice} />

              <div className={styles.twoFields}>
                <label className={styles.field}>
                  <span>Anunciante</span>
                  <input
                    type="text"
                    value={advertiserForm.cliente}
                    onChange={(event) => setAdvertiserForm((current) => ({
                      ...current,
                      cliente: event.target.value
                    }))}
                    placeholder="Ej: BINDER RULEMANES"
                    maxLength={200}
                    required
                    disabled={advertiserSaving}
                  />
                </label>
                <label className={styles.field}>
                  <span>Marca</span>
                  <input
                    type="text"
                    value={advertiserForm.marca}
                    onChange={(event) => setAdvertiserForm((current) => ({
                      ...current,
                      marca: event.target.value
                    }))}
                    placeholder="Ej: Binder"
                    maxLength={200}
                    required
                    disabled={advertiserSaving}
                  />
                </label>
              </div>

              <div className={styles.formActions}>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={advertiserSaving || (mappingEditorTab === 'edit' && !selectedMappingId)}
                >
                  {advertiserSaving ? 'Guardando…' : mappingEditorTab === 'edit' ? 'Guardar cambios' : 'Crear anunciante'}
                </button>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => {
                    beginCreateMapping();
                  }}
                  disabled={advertiserSaving}
                >
                  Limpiar
                </button>
              </div>
            </form>

            <div className={styles.relationshipsPanel}>
              <div className={styles.formHeading}>
                <h3>Anunciantes existentes</h3>
                <p>Administre el estado de cada anunciante y marca.</p>
              </div>

              {mappingsLoadError ? (
                <div className={styles.loadError} role="alert">
                  <span>{mappingsLoadError}</span>
                  <button type="button" onClick={() => void loadMappings()}>Reintentar</button>
                </div>
              ) : null}

              <div className={`${styles.tableScroller} ${styles.relationshipsScroller}`}>
                <table className={styles.dataTable}>
                  <caption className={styles.visuallyHidden}>Anunciantes y marcas</caption>
                  <thead>
                    <tr>
                      <th scope="col">Anunciante</th>
                      <th scope="col">Marca</th>
                      <th scope="col">Estado</th>
                      <th scope="col">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMappings.map((mapping) => (
                      <tr key={mapping.id}>
                        <td data-label="Anunciante">{mapping.cliente}</td>
                        <td data-label="Marca">{mapping.marca}</td>
                        <td data-label="Estado">
                          <span className={`${styles.statusBadge} ${mapping.enabled === false ? styles.statusSuspended : styles.statusActive}`}>
                            {mapping.enabled === false ? 'Suspendido' : 'Activo'}
                          </span>
                        </td>
                        <td data-label="Acción">
                          <button
                            className={styles.smallActionButton}
                            type="button"
                            onClick={() => setMappingStatusTarget(mapping)}
                          >
                            {mapping.enabled === false ? 'Reactivar' : 'Suspender'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!mappingsLoading && filteredMappings.length === 0 ? (
                      <tr>
                        <td className={styles.emptyCell} colSpan={4}>
                          {search ? 'No hay anunciantes que coincidan con la búsqueda.' : 'Todavía no hay anunciantes configurados.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p className={styles.tableFooter} aria-live="polite">
                {mappingsLoading
                  ? 'Cargando anunciantes…'
                  : `${filteredMappings.length} ${filteredMappings.length === 1 ? 'anunciante visible' : 'anunciantes visibles'}`}
              </p>
            </div>
          </div>
        </section>

        <section className={`${styles.card} ${styles.advertisersCard}`} aria-labelledby="api-accounts-title">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}><BuildingIcon /></span>
            <div>
              <h2 id="api-accounts-title">Plataformas</h2>
              <p>Suma el account_id de la plataforma correspondiente.</p>
            </div>
          </div>
          <form className={`${styles.form} ${styles.apiBatchForm}`} onSubmit={saveApiAccountBatch}>
            <div className={styles.twoFields}>
              <label className={styles.field}>
                <span>Selecciona la plataforma</span>
                <PlatformSelect
                  value={apiAccountBatchForm.platform}
                  onChange={(platform) => setApiAccountBatchForm((current) => ({ ...current, platform }))}
                  disabled={apiAccountBatchSaving}
                />
              </label>
              <label className={styles.field}>
                <span>Account ID</span>
                <input type="text" value={apiAccountBatchForm.accountIds} onChange={(event) => setApiAccountBatchForm((current) => ({ ...current, accountIds: event.target.value }))} placeholder="5076047907" required disabled={apiAccountBatchSaving} />
              </label>
            </div>
            <div className={styles.formActions}>
              <button className={styles.primaryButton} type="submit" disabled={apiAccountBatchSaving}>{apiAccountBatchSaving ? 'Cargando…' : 'Cargar ID'}</button>
              <button className={styles.secondaryButton} type="button" onClick={() => setApiAccountBatchForm(EMPTY_API_ACCOUNT_BATCH_FORM)} disabled={apiAccountBatchSaving}>Limpiar</button>
            </div>
            <NoticeBanner notice={apiAccountNotice} />
          </form>
        </section>
      </main>

      {deleteTarget ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !userDeleting) setDeleteTarget(null);
          }}
        >
          <section
            className={styles.confirmDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-user-title"
            aria-describedby="delete-user-description"
          >
            <span className={styles.dialogIcon}><TrashIcon /></span>
            <h2 id="delete-user-title">Eliminar usuario</h2>
            <p id="delete-user-description">
              ¿Confirma que desea eliminar a <strong>{deleteTarget.name}</strong>? Ya no podrá iniciar sesión.
            </p>
            <div className={styles.dialogActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={userDeleting}
                autoFocus
              >
                Cancelar
              </button>
              <button className={styles.dangerButton} type="button" onClick={() => void confirmDeleteUser()} disabled={userDeleting}>
                {userDeleting ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {mappingStatusTarget ? (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !advertiserSaving) setMappingStatusTarget(null);
          }}
        >
          <section
            className={styles.confirmDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="mapping-status-title"
            aria-describedby="mapping-status-description"
          >
            <span className={styles.dialogIcon}><BuildingIcon /></span>
            <h2 id="mapping-status-title">
              {mappingStatusTarget.enabled === false ? 'Reactivar anunciante' : 'Suspender anunciante'}
            </h2>
            <p id="mapping-status-description">
              ¿Confirma que desea {mappingStatusTarget.enabled === false ? 'reactivar' : 'suspender'} a <strong>{mappingStatusTarget.cliente} / {mappingStatusTarget.marca}</strong>?
            </p>
            <div className={styles.dialogActions}>
              <button className={styles.secondaryButton} type="button" onClick={() => setMappingStatusTarget(null)} disabled={advertiserSaving} autoFocus>
                Cancelar
              </button>
              <button className={mappingStatusTarget.enabled === false ? styles.primaryButton : styles.dangerButton} type="button" onClick={() => void confirmMappingStatusChange()} disabled={advertiserSaving}>
                {mappingStatusTarget.enabled === false ? 'Sí, reactivar' : 'Sí, suspender'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AppSidebar>
  );
}
