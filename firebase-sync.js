// ========== KARDIAL – Firebase Sync Module ==========
// Sincronización en tiempo real entre todos los usuarios
// =====================================================

// ============================================
// 🔧 CONFIGURACIÓN DE FIREBASE
// ============================================
// INSTRUCCIONES PARA CONFIGURAR:
// 1. Ve a https://console.firebase.google.com
// 2. Haz clic en "Agregar proyecto" → nombre: "kardial" → Crear
// 3. En el menú izquierdo: "Realtime Database" → "Crear base de datos"
//    Selecciona ubicación y "Iniciar en MODO DE PRUEBA"
// 4. En el menú: Configuración (⚙️) → Configuración del proyecto → 
//    "Tus apps" → ícono Web (</>) → Registrar app → Copia los valores
// 5. Pega los valores aquí abajo:

// La URL se leerá de la configuración del usuario en la app
const FIREBASE_CONFIG = {
  databaseURL: localStorage.getItem('kardial_firebase_url') || "",
};

// ============================================
// MOTOR DE SINCRONIZACIÓN
// ============================================

let _firebaseReady = false;
let _db = null;

// Cachés en memoria (poblados por Firebase listeners en tiempo real)
const _syncCache = {
  pending: [],
  reports: [],
  patients: [],
  users: null
};

// Callbacks para refrescar la UI automáticamente
const _syncCallbacks = {
  pending: null,
  reports: null,
  patients: null,
  users: null
};

// ---- INICIALIZACIÓN ----

function initFirebaseSync() {
  if (!FIREBASE_CONFIG.databaseURL) {
    console.warn('[Kardial Sync] ⚠️ Firebase no configurado.');
    _firebaseReady = false;
    updateSyncIndicator('needs_config');
    return false;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    _db = firebase.database();
    _firebaseReady = true;

    // Configurar listeners en tiempo real
    _setupListeners();

    console.log('[Kardial Sync] ✅ Firebase conectado. Datos sincronizados en tiempo real.');
    updateSyncIndicator('synced');
    return true;
  } catch (e) {
    console.error('[Kardial Sync] ❌ Error al conectar Firebase:', e);
    _firebaseReady = false;
    updateSyncIndicator('offline');
    return false;
  }
}

function isFirebaseReady() {
  return _firebaseReady;
}

// ---- LISTENERS EN TIEMPO REAL ----

function _setupListeners() {
  if (!_db) return;

  // Escuchar cambios en /pending
  _db.ref('pending').on('value', (snapshot) => {
    _syncCache.pending = [];
    snapshot.forEach(child => {
      const item = child.val();
      item._key = child.key;
      _syncCache.pending.push(item);
    });
    _syncCache.pending.sort((a, b) => (b.id || 0) - (a.id || 0));
    if (_syncCallbacks.pending) _syncCallbacks.pending();
    updateSyncIndicator('synced');
  });

  // Escuchar cambios en /reports
  _db.ref('reports').on('value', (snapshot) => {
    _syncCache.reports = [];
    snapshot.forEach(child => {
      const item = child.val();
      item._key = child.key;
      _syncCache.reports.push(item);
    });
    _syncCache.reports.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    if (_syncCallbacks.reports) _syncCallbacks.reports();
    updateSyncIndicator('synced');
  });

  // Escuchar cambios en /patients
  _db.ref('patients').on('value', (snapshot) => {
    _syncCache.patients = [];
    snapshot.forEach(child => {
      const item = child.val();
      item._key = child.key;
      _syncCache.patients.push(item);
    });
    if (_syncCallbacks.patients) _syncCallbacks.patients();
  });

  // Escuchar cambios en /users
  _db.ref('users').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data && Array.isArray(data)) {
      _syncCache.users = data;
    } else if (data) {
      _syncCache.users = Object.values(data);
    } else {
      _syncCache.users = null;
    }
    if (_syncCallbacks.users) _syncCallbacks.users();
  });
}

// ============================================
// FUNCIONES CRUD – PENDIENTES (ECG por informar)
// ============================================

function syncGetPending() {
  if (_firebaseReady) return [..._syncCache.pending];
  return JSON.parse(localStorage.getItem('kardial_pending') || '[]');
}

async function syncSavePending(data, file) {
  const id = data.id || Date.now();
  data.id = id;

  // Convertir archivo a base64 si se proporciona
  if (file) {
    try {
      const base64 = await _fileToBase64(file);
      data._fileData = base64;
      data._fileType = file.type;
      data._fileName = file.name;
    } catch (e) {
      console.error('[Sync] Error convirtiendo archivo:', e);
    }
  }

  if (_firebaseReady) {
    updateSyncIndicator('syncing');
    try {
      const cleanData = JSON.parse(JSON.stringify(data));
      await _db.ref('pending/' + id).set(cleanData);
    } catch (err) {
      console.error('[Sync] Error en Firebase:', err);
      showNotif('❌ Error al guardar: el archivo es muy grande o hay un problema de conexión.', 'error');
    }
  } else {
    const pending = JSON.parse(localStorage.getItem('kardial_pending') || '[]');
    const idx = pending.findIndex(p => p.id === id);
    if (idx !== -1) pending[idx] = data;
    else pending.unshift(data);
    localStorage.setItem('kardial_pending', JSON.stringify(pending));
    if (file) await saveExamFile(id, file);
  }
}

async function syncDeletePending(id) {
  if (_firebaseReady) {
    updateSyncIndicator('syncing');
    await _db.ref('pending/' + id).remove();
  } else {
    let pending = JSON.parse(localStorage.getItem('kardial_pending') || '[]');
    pending = pending.filter(p => p.id !== id);
    localStorage.setItem('kardial_pending', JSON.stringify(pending));
  }
}

// ============================================
// FUNCIONES CRUD – REPORTES (ECG informados)
// ============================================

function syncGetReports() {
  if (_firebaseReady) return [..._syncCache.reports];
  return JSON.parse(localStorage.getItem('kardial_reports') || '[]');
}

async function syncSaveReport(data) {
  const id = data.id || Date.now();
  data.id = id;

  if (_firebaseReady) {
    updateSyncIndicator('syncing');
    try {
      const cleanData = JSON.parse(JSON.stringify(data));
      await _db.ref('reports/' + id).set(cleanData);
    } catch (err) {
      console.error('[Sync] Error en Firebase:', err);
      showNotif('❌ Error al guardar el informe en la nube.', 'error');
    }
  } else {
    const saved = JSON.parse(localStorage.getItem('kardial_reports') || '[]');
    saved.unshift(data);
    localStorage.setItem('kardial_reports', JSON.stringify(saved));
  }
}

async function syncDeleteReport(idx) {
  if (_firebaseReady) {
    const reports = syncGetReports();
    const r = reports[idx];
    if (r) {
      updateSyncIndicator('syncing');
      const key = r._key || r.id;
      if (key) await _db.ref('reports/' + key).remove();
    }
  } else {
    const saved = JSON.parse(localStorage.getItem('kardial_reports') || '[]');
    if (saved[idx] && saved[idx].id) deleteExamFile(saved[idx].id);
    saved.splice(idx, 1);
    localStorage.setItem('kardial_reports', JSON.stringify(saved));
  }
}

// ============================================
// FUNCIONES CRUD – PACIENTES
// ============================================

function syncGetPatients() {
  if (_firebaseReady) return [..._syncCache.patients];
  return JSON.parse(localStorage.getItem('kardial_patients') || '[]');
}

async function syncSavePatient(patient, idx) {
  if (_firebaseReady) {
    updateSyncIndicator('syncing');
    try {
      const cleanData = JSON.parse(JSON.stringify(patient));
      if (idx !== null && _syncCache.patients[idx] && _syncCache.patients[idx]._key) {
        await _db.ref('patients/' + _syncCache.patients[idx]._key).set(cleanData);
      } else {
        await _db.ref('patients').push(cleanData);
      }
    } catch (err) {
      console.error('[Sync] Error en Firebase:', err);
    }
  } else {
    let saved = JSON.parse(localStorage.getItem('kardial_patients') || '[]');
    if (idx !== null) saved[idx] = patient;
    else saved.push(patient);
    localStorage.setItem('kardial_patients', JSON.stringify(saved));
  }
}

async function syncDeletePatient(idx) {
  if (_firebaseReady) {
    const p = _syncCache.patients[idx];
    if (p && p._key) {
      updateSyncIndicator('syncing');
      await _db.ref('patients/' + p._key).remove();
    }
  } else {
    let saved = JSON.parse(localStorage.getItem('kardial_patients') || '[]');
    saved.splice(idx, 1);
    localStorage.setItem('kardial_patients', JSON.stringify(saved));
  }
}

// ============================================
// FUNCIONES CRUD – USUARIOS
// ============================================

function syncGetUsers() {
  if (_firebaseReady && _syncCache.users && _syncCache.users.length > 0) {
    return _syncCache.users;
  }
  return null;
}

async function syncSaveUsers(users) {
  if (_firebaseReady) {
    updateSyncIndicator('syncing');
    try {
      const cleanData = JSON.parse(JSON.stringify(users));
      await _db.ref('users').set(cleanData);
    } catch (err) {
      console.error('[Sync] Error en Firebase:', err);
    }
  }
  localStorage.setItem('kardial_users', JSON.stringify(users));
}

// ============================================
// FUNCIONES DE ARCHIVOS
// ============================================

async function syncGetFile(id) {
  if (_firebaseReady) {
    // Buscar en caché de pendientes
    const pending = _syncCache.pending.find(p => String(p.id) === String(id));
    if (pending && pending._fileData) {
      return _base64ToFile(pending._fileData, pending._fileName || 'examen', pending._fileType || 'application/pdf');
    }
    // Buscar en caché de reportes
    const report = _syncCache.reports.find(r => String(r.id) === String(id));
    if (report && report._fileData) {
      return _base64ToFile(report._fileData, report._fileName || 'examen', report._fileType || 'application/pdf');
    }
    return null;
  }
  // Fallback a IndexedDB
  return await getExamFile(id);
}

// ============================================
// UTILIDADES
// ============================================

function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _base64ToFile(base64, name, type) {
  try {
    const arr = base64.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : type;
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], name, { type: mime });
  } catch (e) {
    console.error('[Sync] Error convirtiendo base64 a archivo:', e);
    return null;
  }
}

function updateSyncIndicator(state) {
  const el = document.getElementById('syncIndicator');
  if (!el) return;
  if (state === 'synced') {
    el.innerHTML = '🟢 Sincronizado';
    el.style.color = '#10b981';
    el.style.cursor = 'default';
    el.onclick = null;
  } else if (state === 'syncing') {
    el.innerHTML = '🔄 Sincronizando...';
    el.style.color = '#f59e0b';
    el.style.cursor = 'default';
    el.onclick = null;
    setTimeout(() => { if(_firebaseReady) updateSyncIndicator('synced'); }, 1500);
  } else if (state === 'needs_config') {
    el.innerHTML = '🔴 Nube Desconectada (Clic para configurar)';
    el.style.color = '#ef4444';
    el.style.cursor = 'pointer';
    el.onclick = promptFirebaseConfig;
  } else {
    el.innerHTML = '⚪ Local';
    el.style.color = '#9ca3af';
  }
}

function promptFirebaseConfig() {
  const url = prompt("Para activar la sincronización, pega aquí la URL de tu base de datos de Firebase Realtime Database (ejemplo: https://mi-proyecto-default-rtdb.firebaseio.com):", localStorage.getItem('kardial_firebase_url') || "");
  if (url !== null && url.trim() !== "") {
    localStorage.setItem('kardial_firebase_url', url.trim());
    alert("URL guardada. La página se recargará para aplicar los cambios.");
    window.location.reload();
  }
}

// ---- Migrar datos locales a Firebase ----
async function migrateLocalToFirebase() {
  if (!_firebaseReady) return;
  // REMOVIDO: if (localStorage.getItem('kardial_migrated') === 'true') return;

  let migratedAny = false;
  let totalLocal = 0;

  // Migrar pendientes
  const localPending = JSON.parse(localStorage.getItem('kardial_pending') || '[]');
  if (localPending.length > 0) {
    console.log('[Sync] Migrando', localPending.length, 'pendientes locales a Firebase...');
    for (const p of localPending) {
      // Intentar obtener el archivo de IndexedDB
      const file = await getExamFile(p.id);
      if (file) {
        try {
          p._fileData = await _fileToBase64(file);
          p._fileType = file.type;
          p._fileName = file.name;
        } catch (e) { /* ignore */ }
      }
      await _db.ref('pending/' + p.id).set(p);
    }
    migratedAny = true;
  }

  // Migrar reportes
  const localReports = JSON.parse(localStorage.getItem('kardial_reports') || '[]');
  if (localReports.length > 0) {
    console.log('[Sync] Migrando', localReports.length, 'reportes locales a Firebase...');
    for (const r of localReports) {
      const id = r.id || Date.now() + Math.random();
      r.id = id;
      const file = await getExamFile(id);
      if (file) {
        try {
          r._fileData = await _fileToBase64(file);
          r._fileType = file.type;
          r._fileName = file.name;
        } catch (e) { /* ignore */ }
      }
      await _db.ref('reports/' + id).set(r);
    }
    migratedAny = true;
  }

  // Migrar pacientes
  const localPatients = JSON.parse(localStorage.getItem('kardial_patients') || '[]');
  if (localPatients.length > 0) {
    console.log('[Sync] Migrando', localPatients.length, 'pacientes locales a Firebase...');
    for (const p of localPatients) {
      await _db.ref('patients').push(p);
    }
    migratedAny = true;
  }

  // Migrar usuarios (sólo si no hay en firebase ya)
  const localUsers = JSON.parse(localStorage.getItem('kardial_users') || '[]');
  if (localUsers.length > 0 && (!_syncCache.users || _syncCache.users.length === 0)) {
    console.log('[Sync] Migrando usuarios locales a Firebase...');
    await _db.ref('users').set(localUsers);
    migratedAny = true;
  }

  const localPendingCount = localPending.length;
  const localReportsCount = localReports.length;

  if (migratedAny) {
    showNotif('✅ Datos locales antiguos sincronizados a la nube (' + localPendingCount + ' pendientes, ' + localReportsCount + ' informados)');
  } else if (localPendingCount === 0 && localReportsCount === 0) {
    showNotif('ℹ️ Tu navegador no tiene informes locales guardados para recuperar.', 'info');
  }
  
  // localStorage.setItem('kardial_migrated', 'true');
}

// ---- Registrar callbacks de UI ----
function registerSyncCallbacks(callbacks) {
  if (callbacks.pending) _syncCallbacks.pending = callbacks.pending;
  if (callbacks.reports) _syncCallbacks.reports = callbacks.reports;
  if (callbacks.patients) _syncCallbacks.patients = callbacks.patients;
  if (callbacks.users) _syncCallbacks.users = callbacks.users;
}
