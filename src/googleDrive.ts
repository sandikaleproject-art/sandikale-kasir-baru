/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Google Drive Integration for SANDIKALE POS & SPK Sablon
// Uses configured OAuth Client ID: 170177693152-rli63gks9bqu2s1j6l3n8m842ssii0s8.apps.googleusercontent.com

const GOOGLE_CLIENT_ID = '170177693152-rli63gks9bqu2s1j6l3n8m842ssii0s8.apps.googleusercontent.com';
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive'
].join(' ');

let tokenClient: any = null;
let currentAccessToken: string | null = null;
let driveUserInfo: { email?: string; name?: string; picture?: string } | null = null;

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
  webViewLink?: string;
}

// 1. Initialize Google Identity Services
export function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve();
    if ((window as any).google?.accounts?.oauth2) {
      return resolve();
    }
    const existingScript = document.getElementById('gsi-client-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.id = 'gsi-client-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Gagal memuat Google Identity Services'));
    document.head.appendChild(script);
  });
}

// 2. Request Google Drive OAuth Token via Popup
export async function requestGoogleDriveAuth(): Promise<string> {
  await loadGisScript();

  return new Promise((resolve, reject) => {
    try {
      const google = (window as any).google;
      if (!google?.accounts?.oauth2) {
        throw new Error('Google Identity Services belum siap');
      }

      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPES,
        callback: async (response: any) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          currentAccessToken = response.access_token;
          try {
            sessionStorage.setItem('sandikale_gdrive_token', currentAccessToken || '');
            // Fetch basic profile info
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${currentAccessToken}` }
            });
            if (userRes.ok) {
              driveUserInfo = await userRes.json();
              sessionStorage.setItem('sandikale_gdrive_user', JSON.stringify(driveUserInfo));
            }
          } catch (e) {
            console.warn('Gagal memuat profil pengguna Google:', e);
          }
          resolve(currentAccessToken!);
        }
      });

      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      reject(err);
    }
  });
}

export function getGoogleDriveSession(): { isConnected: boolean; token: string | null; user: any } {
  if (typeof window === 'undefined') return { isConnected: false, token: null, user: null };
  const token = currentAccessToken || sessionStorage.getItem('sandikale_gdrive_token');
  let user = driveUserInfo;
  if (!user) {
    try {
      const stored = sessionStorage.getItem('sandikale_gdrive_user');
      if (stored) user = JSON.parse(stored);
    } catch {}
  }
  return {
    isConnected: !!token,
    token,
    user
  };
}

export function disconnectGoogleDrive() {
  currentAccessToken = null;
  driveUserInfo = null;
  sessionStorage.removeItem('sandikale_gdrive_token');
  sessionStorage.removeItem('sandikale_gdrive_user');
}

// Helper: Ensure valid token or prompt user
async function ensureToken(): Promise<string> {
  const session = getGoogleDriveSession();
  if (session.token) {
    return session.token;
  }
  return await requestGoogleDriveAuth();
}

// 3. Find or Create a Directory Folder in Google Drive
async function findOrCreateDriveFolder(folderName: string, token: string): Promise<string> {
  // Check if exists
  const q = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  const res = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (res.ok) {
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });

  if (!createRes.ok) {
    throw new Error('Gagal membuat folder di Google Drive');
  }

  const folder = await createRes.json();
  return folder.id;
}

// 4. Upload JSON Backup to Google Drive
export async function uploadBackupToGoogleDrive(backupData: any): Promise<{
  fileId: string;
  name: string;
  webViewLink?: string;
}> {
  const token = await ensureToken();
  const folderId = await findOrCreateDriveFolder('SANDIKALE_POS_BACKUP', token);

  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `Backup_SANDIKALE_${dateStr}.json`;
  const fileContent = JSON.stringify(backupData, null, 2);

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    parents: [folderId],
    description: 'Cadangan data sistem SANDIKALE POS (Katalog, Pengaturan, Staf, Transaksi, Shift)'
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    fileContent +
    closeDelimiter;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    }
  );

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`Gagal upload backup ke Google Drive: ${errorText}`);
  }

  const result = await uploadRes.json();
  return {
    fileId: result.id,
    name: result.name,
    webViewLink: result.webViewLink
  };
}

// 5. List Backups from Google Drive
export async function listGoogleDriveBackups(): Promise<DriveFileItem[]> {
  const token = await ensureToken();
  const q = `name contains 'Backup_SANDIKALE' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&orderBy=createdTime desc&fields=files(id,name,mimeType,createdTime,size,webViewLink)&pageSize=20`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gagal membaca daftar file dari Google Drive: ${errorText}`);
  }

  const data = await res.json();
  return data.files || [];
}

// 6. Download Backup from Google Drive
export async function downloadBackupFromGoogleDrive(fileId: string): Promise<any> {
  const token = await ensureToken();
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    throw new Error('Gagal mengunduh file cadangan dari Google Drive');
  }

  const jsonData = await res.json();
  return jsonData;
}

// 7. Upload SPK or Receipt PDF to Google Drive
export async function uploadSpkPdfToGoogleDrive(
  fileName: string,
  pdfBlob: Blob,
  meta?: { invoiceNumber?: string; customerName?: string }
): Promise<{ fileId: string; webViewLink?: string }> {
  const token = await ensureToken();
  const folderId = await findOrCreateDriveFolder('SANDIKALE_SPK_SABLON', token);

  const metadata = {
    name: fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`,
    mimeType: 'application/pdf',
    parents: [folderId],
    description: `SPK Sablon / Nota SANDIKALE #${meta?.invoiceNumber || ''} - ${meta?.customerName || ''}`
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', pdfBlob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: form
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gagal menyimpan SPK ke Google Drive: ${errText}`);
  }

  const result = await res.json();
  return {
    fileId: result.id,
    webViewLink: result.webViewLink
  };
}

// Expose on window for easy access from bundle components
if (typeof window !== 'undefined') {
  (window as any).GoogleDriveIntegration = {
    loadGisScript,
    requestGoogleDriveAuth,
    getGoogleDriveSession,
    disconnectGoogleDrive,
    uploadBackupToGoogleDrive,
    listGoogleDriveBackups,
    downloadBackupFromGoogleDrive,
    uploadSpkPdfToGoogleDrive
  };
}
