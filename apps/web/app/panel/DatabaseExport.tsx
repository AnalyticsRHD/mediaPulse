'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './panel.module.css';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3333';

export function DatabaseExport({ token, userId }: { token: string; userId: string }) {
  const [busy, setBusy] = useState(false);
  const [backupId, setBackupId] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const running = useRef(false);
  const key = `mediapulse-backup-${userId}`;

  useEffect(() => {
    try { setBackupId(localStorage.getItem(key) || ''); } catch { /* Recovery remains available during this session. */ }
  }, [key]);

  async function download(response: Response) {
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.message || `No se pudo completar la operación (${response.status}).`);
    }
    const blob = await response.blob();
    const name = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1];
    const month = new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' }).format(new Date()).toUpperCase();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name || `Media-pulse-${month}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function exportDatabase() {
    if (running.current) return;
    running.current = true;
    setBusy(true); setFailed(false); setMessage('Generando el respaldo y limpiando los datos antiguos…');
    const id = crypto.randomUUID();
    setBackupId(id);
    try {
      // Persist before sending a destructive request so a page reload does not lose recovery information.
      localStorage.setItem(key, id);
      const response = await fetch(`${API_BASE}/maintenance/backups/${id}/cleanup`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      await download(response);
      setMessage('Excel generado y limpieza completada. Se inició la descarga; conservamos una copia para volver a descargarla.');
    } catch (error) {
      setFailed(true);
      setMessage(`${error instanceof Error ? error.message : 'No se pudo completar la operación.'} Consultá el estado antes de iniciar otra exportación.`);
    } finally { running.current = false; setBusy(false); }
  }

  async function recover() {
    if (running.current || !backupId) return;
    running.current = true;
    setBusy(true); setFailed(false);
    try {
      const response = await fetch(`${API_BASE}/maintenance/backups/${backupId}`, { headers: { Authorization: `Bearer ${token}` } });
      const status = await response.json();
      if (!response.ok) throw new Error(status.message || 'Todavía no hay un respaldo confirmado. Si la operación sigue en curso, esperá y consultá nuevamente.');
      await download(await fetch(`${API_BASE}/maintenance/backups/${backupId}/download`, { headers: { Authorization: `Bearer ${token}` } }));
      setFailed(status.status !== 'completed');
      setMessage(status.status === 'completed' ? 'Limpieza completada. Se inició otra descarga del respaldo.' : 'Respaldo recuperado. El resultado del borrado no está confirmado; revisalo antes de iniciar otra exportación.');
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : 'No se pudo recuperar el respaldo.');
    } finally { running.current = false; setBusy(false); }
  }

  return (
    <section className={styles.databaseExport} aria-labelledby="database-export-title">
      <div>
        <h2 id="database-export-title">Respaldo de datos</h2>
        <p>Exporta todos los registros de las tablas de metricas a Excel. Después elimina los registros antiguos y conserva el mes actual y los dos anteriores.</p>
      </div>
      <div className={styles.exportActions}>
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void exportDatabase()}>
          {busy ? 'Procesando…' : 'Exportar Base de datos'}
        </button>
        {backupId && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void recover()}>Consultar y descargar respaldo</button>}
      </div>
      {message && <p className={failed ? styles.loadError : styles.exportMessage} role={failed ? 'alert' : 'status'}>{message}</p>}
    </section>
  );
}
