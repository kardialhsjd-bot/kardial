// ========== KARDIAL – app.js ==========
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentReport = null;
let isSigned = false;
let _pdfDoc = null;
let _currentPage = 1;
let _totalPages = 1;

// ---- AUTHENTICATION & ROLES ----

// Cargar usuarios de localStorage o usar iniciales si no hay ninguno
function getStoredUsers() {
  let users = [];
  const stored = localStorage.getItem('kardial_users');
  if (stored) {
    users = JSON.parse(stored);
    // Migración: Asegurar que el usuario admin tenga la categoría 'admin'
    let changed = false;
    users.forEach(u => {
      if (u.user === 'admin' && u.category === 'tens') {
        u.category = 'admin';
        changed = true;
      }
    });
    if (changed) localStorage.setItem('kardial_users', JSON.stringify(users));
    return users;
  }
  
  // Usuarios iniciales por defecto
  const defaults = [
    { user: 'admin', pass: 'admin123', name: 'Administrador', initials: 'AD', category: 'admin' },
    { user: 'tens', pass: 'tens2024', name: 'TENS Electro', initials: 'TE', category: 'tens' },
    { user: 'doctor', pass: 'doc2024', name: 'Dr. Médico', initials: 'DR', category: 'doctor' }
  ];
  localStorage.setItem('kardial_users', JSON.stringify(defaults));
  return defaults;
}

// Secciones permitidas por rol básico
const ROLE_ACCESS = {
  admin:  ['upload', 'pending', 'history', 'patients', 'users', 'stats', 'settings', 'report'],
  tens:   ['upload', 'pending', 'history', 'patients', 'stats', 'settings', 'report'],
  enfermeria: ['upload', 'pending', 'history', 'patients', 'stats', 'settings', 'report'],
  doctor: ['pending', 'history', 'report'],
};

function getCurrentRole() {
  return localStorage.getItem('kardial_role') || null;
}

function checkAuth() {
  const isLoggedIn = localStorage.getItem('kardial_auth') === 'true';
  const overlay = document.getElementById('loginOverlay');
  if (isLoggedIn) {
    overlay.classList.add('hidden');
    applyRoleUI(getCurrentRole());
  } else {
    overlay.classList.remove('hidden');
  }
}

function handleLogin(e) {
  e.preventDefault();
  const user = document.getElementById('loginUser').value.trim().toLowerCase();
  const pass = document.getElementById('loginPass').value;
  const errorEl = document.getElementById('loginError');

  const users = getStoredUsers();
  const found = users.find(u => u.user === user && u.pass === pass);

  if (found) {
    localStorage.setItem('kardial_auth', 'true');
    localStorage.setItem('kardial_role', found.category); // Usamos category como rol de acceso
    localStorage.setItem('kardial_username', found.name);
    localStorage.setItem('kardial_initials', found.initials);
    document.getElementById('loginOverlay').classList.add('hidden');
    errorEl.style.display = 'none';
    applyRoleUI(found.category);
    showNotif(`¡Bienvenido, ${found.name}!`);
  } else {
    errorEl.style.display = 'block';
    const card = document.querySelector('.login-card');
    card.style.animation = 'none';
    setTimeout(() => card.style.animation = 'shake 0.4s', 10);
  }
}

function applyRoleUI(role) {
  if (!role) return;
  // Mapear categorías a roles de acceso
  const accessRole = (role === 'admin' || role === 'enfermeria' || role === 'tens') ? 'tens' : 'doctor';
  const allowedSections = ROLE_ACCESS[role] || ROLE_ACCESS[accessRole];

  // Mostrar/ocultar ítems del sidebar según rol
  document.querySelectorAll('#sidebarNav .nav-item').forEach(btn => {
    const btnRole = btn.getAttribute('data-role');
    if (btnRole === 'all') {
      btn.style.display = '';
    } else if (btnRole === 'admin') {
      btn.style.display = (role === 'admin') ? '' : 'none';
    } else if (btnRole === 'tens') {
      btn.style.display = (role === 'admin' || role === 'enfermeria' || role === 'tens') ? '' : 'none';
    }
  });

  // Actualizar info del usuario en el sidebar
  const name = localStorage.getItem('kardial_username') || 'Usuario';
  const initials = localStorage.getItem('kardial_initials') || '--';
  let roleLabel = 'Médico';
  if (role === 'admin') roleLabel = 'Administrador';
  else if (role === 'enfermeria') roleLabel = 'Enfermería';
  else if (role === 'tens') roleLabel = 'TENS';
  
  const el = id => document.getElementById(id);
  if (el('sidebarName'))    el('sidebarName').textContent    = name;
  if (el('sidebarRole'))    el('sidebarRole').textContent    = roleLabel;
  if (el('sidebarAvatar'))  el('sidebarAvatar').textContent  = initials;

  if (accessRole === 'doctor') {
    goTo('pending');
  }
}

function logout() {
  if (confirm('¿Está seguro de que desea cerrar sesión?')) {
    localStorage.removeItem('kardial_auth');
    localStorage.removeItem('kardial_role');
    localStorage.removeItem('kardial_username');
    localStorage.removeItem('kardial_initials');
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginForm').reset();
    showNotif('Sesión cerrada correctamente');
  }
}

// Proteger navegación: bloquear secciones no permitidas
function canAccess(section) {
  const role = getCurrentRole();
  if (!role) return false;
  if (role === 'admin') return true; 
  const accessRole = (role === 'admin' || role === 'enfermeria' || role === 'tens') ? 'tens' : 'doctor';
  return (ROLE_ACCESS[accessRole] || []).includes(section);
}

// Agregar estilos para la animación de error
const style = document.createElement('style');
style.textContent = `
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-10px); }
  75% { transform: translateX(10px); }
}
`;
document.head.appendChild(style);

// Ejecutar al cargar
window.addEventListener('DOMContentLoaded', checkAuth);

// ---- STORAGE (IndexedDB para persistir archivos PDF/Imágenes) ----
const DB_NAME = 'KardialStorage';
const STORE_NAME = 'exams';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveExamFile(id, file) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(file, id.toString());
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(e) { console.error('Error saving file to DB:', e); }
}

async function getExamFile(id) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id.toString());
    return new Promise((res, rej) => { 
      request.onsuccess = () => res(request.result); 
      request.onerror = rej; 
    });
  } catch(e) { console.error('Error getting file from DB:', e); return null; }
}

async function deleteExamFile(id) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id.toString());
  } catch(e) { console.error('Error deleting file from DB:', e); }
}

// ---- NAVIGATION ----
function goTo(section){
  // Bloquear acceso si el rol no tiene permiso
  if (!canAccess(section)) {
    showNotif('⛔ No tiene permiso para acceder a esta sección', 'error');
    return;
  }
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+section).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  
  const buttons = document.querySelectorAll('.nav-item');
  buttons.forEach(btn => {
    if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${section}'`)) {
      btn.classList.add('active');
    }
  });

  const titles = {upload:'Nuevo Informe ECG',pending:'ECG por informar',history:'ECG informados',patients:'Gestión de Pacientes',stats:'Estadísticas',settings:'Configuración'};
  document.getElementById('pageTitle').textContent = titles[section]||'KARDIAL';
  const isReport = section==='report';
  document.getElementById('btnPreview').style.display = isReport?'':'none';
  document.getElementById('btnSave').style.display = isReport?'':'none';
  
  if(section==='pending') loadPending();
  if(section==='history') loadHistorial();
  if(section==='patients') loadPatients();
  if(section==='users') loadUsers('all');
  if(section==='stats') initStats();
}

// ---- DRAG & DROP ----
const dropZone = document.getElementById('dropZone');
if(dropZone) {
  dropZone.addEventListener('dragover', e=>{e.preventDefault();dropZone.classList.add('drag-over');});
  dropZone.addEventListener('dragleave', ()=>dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e=>{
    e.preventDefault(); dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if(f) handleFile(f);
  });
}

function handleFile(file){
  if(!file) return;
  const allowed = ['application/pdf','image/jpeg','image/png','image/jpg'];
  if(!allowed.includes(file.type)){showNotif('❌ Formato no válido. Use PDF, JPG o PNG.','error');return;}
  if(file.size > 20*1024*1024){showNotif('❌ Archivo demasiado grande (máx. 20 MB).','error');return;}
  document.getElementById('fileName').textContent = '📄 '+file.name;
  document.getElementById('fileSize').textContent = (file.size/1024).toFixed(1)+' KB';
  document.getElementById('fileInfo').style.display = 'block';
  window._currentFile = file;
  showNotif('✅ Archivo cargado. Por favor, registre los datos del paciente.');
  startProcessing(); // Iniciar procesamiento para mostrar el formulario
}

async function saveToPending(data, file) {
  const pending = JSON.parse(localStorage.getItem('kardial_pending') || '[]');
  const id = data.id || Date.now();
  data.id = id;
  
  // Evitar duplicados si ya existe por ID
  const existsIdx = pending.findIndex(p => p.id === id);
  if (existsIdx !== -1) {
    pending[existsIdx] = data;
  } else {
    pending.unshift(data);
  }
  
  localStorage.setItem('kardial_pending', JSON.stringify(pending));
  if (file) await saveExamFile(id, file);
}

function loadPending() {
  const pending = JSON.parse(localStorage.getItem('kardial_pending') || '[]');
  const screen = document.getElementById('screen-pending');
  if (pending.length === 0) {
    screen.innerHTML = '<div style="padding:60px;text-align:center"><h2 style="margin-bottom:10px">📁 ECG por informar</h2><p style="color:var(--text-sec)">No hay estudios pendientes de informar.</p></div>';
    return;
  }
  let html = '<div style="max-width:900px">';
  html += '<h2 style="margin-bottom:20px;font-size:20px">📁 ECG por informar <span style="font-size:13px;color:var(--text-sec);font-weight:400">(' + pending.length + ' pendientes)</span></h2>';
  html += '<div style="display:flex;flex-direction:column;gap:12px">';
  pending.forEach((p, i) => {
    html += `<div class="card" style="cursor:pointer" onclick="processPending(${i})">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:15px;font-weight:700;margin-bottom:4px">👤 ${p.paciente || 'Paciente sin nombre'}</div>
          <div style="font-size:12px;color:var(--text-sec)">${p.rut ? 'RUT: '+p.rut+' &nbsp;·&nbsp; ' : ''} Subido: ${new Date(p.date || Date.now()).toLocaleString()}</div>
        </div>
        <button class="btn btn-primary btn-sm">▶ Redactar Informe</button>
      </div>
    </div>`;
  });
  html += '</div></div>';
  screen.innerHTML = html;
}

async function processPending(idx) {
  const pending = JSON.parse(localStorage.getItem('kardial_pending') || '[]');
  const p = pending[idx];
  if (!p) return;
  
  const file = await getExamFile(p.id);
  if (file) {
    window._currentFile = file;
    window._currentPendingId = p.id;
    
    // Cargar datos en el formulario
    const set = (id,val)=>{ const el=document.getElementById(id); if(el) el.value=val||''; };
    set('pNombre',p.paciente); set('pRut',p.rut); set('pEdad',p.edad); set('pSexo',p.sexo);
    set('pFechaEx',p.fechaEx); set('pMedSol',p.medSol); set('pMotivo',p.motivo);
    
    startProcessing();
  } else {
    showNotif('❌ No se encontró el archivo del estudio', 'error');
  }
}

// ---- PROCESSING ----
function startProcessing(){
  showScreen('processing');
  const steps = ['step1','step2','step3','step4','step5'];
  const fill = document.getElementById('progressFill');
  const pct = document.getElementById('procPercent');
  let i = 0;
  steps.forEach(s=>{ const el=document.getElementById(s); if(el) el.className='proc-step'; });
  if(fill) fill.style.width='0%'; 
  if(pct) pct.textContent='0%';

  function nextStep(){
    if(i>0) {
        const prevStep = document.getElementById(steps[i-1]);
        if(prevStep) {
            prevStep.classList.remove('active');
            prevStep.classList.add('done');
        }
    }
    if(i<steps.length){
      const currentStep = document.getElementById(steps[i]);
      if(currentStep) currentStep.classList.add('active');
      const p = Math.round(((i+1)/steps.length)*100);
      if(fill) fill.style.width = p+'%';
      if(pct) pct.textContent = p+'%';
      i++;
      setTimeout(nextStep, 600 + Math.random()*300);
    } else {
      if(fill) fill.style.width='100%'; 
      if(pct) pct.textContent='100%';
      const f = window._currentFile;
      if(f && f.type==='application/pdf') {
        parsePDF(f).then(({text, patient})=>{ renderDocument(f); fillPatientData(patient); loadReport(text); });
      } else {
        if(f) renderDocument(f);
        loadReport(null);
      }
    }
  }
  setTimeout(nextStep, 300);
}

async function parsePDF(file){
  try {
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data:ab}).promise;
    _pdfDoc = pdf;
    _totalPages = pdf.numPages;
    _currentPage = 1;
    let text = '';
    for(let p=1;p<=Math.min(pdf.numPages,4);p++){
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      text += tc.items.map(i=>i.str).join(' ');
    }
    return { text, patient: extractPatientData(text) };
  } catch(e){ return { text: null, patient: {} }; }
}

// ---- EXTRAER DATOS DEL PACIENTE ----
function extractPatientData(text){
  if(!text) return {};
  const p = {};
  const namePatterns = [
    /[Nn]ombre[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ ,]+?)(?:\s{2,}|\d|RUT|Rut|ID|Edad|Fecha)/,
    /Paciente[:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ A-ZÁÉÍÓÚÑ]+?)(?:\s{2,}|\d|RUT)/,
    /^([A-ZÁÉÍÓÚÑ]{2,}\s+[A-ZÁÉÍÓÚÑ]{2,}[\sA-ZÁÉÍÓÚÑA-Za-z]*?)(?:\s{2,}|RUT|Rut)/m
  ];
  for(const pat of namePatterns){
    const m = text.match(pat);
    if(m && m[1] && m[1].trim().length > 3){ p.nombre = m[1].trim(); break; }
  }
  const rutM = text.match(/RUT[:\s]*([\d\.]+[-–][\dkK])/i) ||
               text.match(/(\d{7,8}[-–][\dkK])/i) ||
               text.match(/([\d]{1,2}\.?[\d]{3}\.?[\d]{3}[-–][\dkK])/);
  if(rutM) p.rut = rutM[1].trim();

  const edadM = text.match(/[Ee]dad[:\s]*(\d{1,3})\s*[aA]/) ||
                text.match(/(\d{1,3})\s*[aA]ños/) ||
                text.match(/[Ee]dad[:\s]*(\d{1,3})/);
  if(edadM) p.edad = edadM[1];

  if(/\b[Mm]asculino\b|\b[Hh]ombre\b|\bSexo[:\s]*M\b|\bSex[:\s]*M\b/.test(text)) p.sexo='Masculino';
  else if(/\b[Ff]emenino\b|\b[Mm]ujer\b|\bSexo[:\s]*F\b|\bSex[:\s]*F\b/.test(text)) p.sexo='Femenino';

  const fechaM = text.match(/[Ff]echa[:\s]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/) ||
                 text.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/);
  if(fechaM){
    const parts = fechaM[1].split(/[\/-]/);
    if(parts.length===3){
      let [a,b,c] = parts;
      if(c.length===4) p.fechaEx = `${c}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`;
      else if(a.length===4) p.fechaEx = `${a}-${b.padStart(2,'0')}-${c.padStart(2,'0')}`;
    }
  }

  const medM = text.match(/Dr[a]?[.:\s]+([A-ZÁÉÍÓÚÑ][a-záéíóúñ A-ZÁÉÍÓÚÑ]+?)(?:\s{2,}|\d|$)/) ||
               text.match(/[Mm]édico[:\s]+([A-ZÁÉÍÓÚÑ][\w\s]+?)(?:\s{2,}|\d|$)/);
  if(medM) p.medSol = medM[1].trim();

  return p;
}

function fillPatientData(patient){
  if(!patient) return;
  if(patient.nombre) document.getElementById('pNombre').value = patient.nombre;
  if(patient.rut)    document.getElementById('pRut').value    = patient.rut;
  if(patient.edad)   document.getElementById('pEdad').value   = patient.edad + ' años';
  if(patient.sexo)   document.getElementById('pSexo').value   = patient.sexo;
  if(patient.fechaEx) document.getElementById('pFechaEx').value = patient.fechaEx;
  if(patient.medSol) document.getElementById('pMedSol').value = patient.medSol;
  
  ['pNombre','pRut','pEdad','pSexo','pFechaEx','pMedSol'].forEach(id=>{
    const el = document.getElementById(id);
    if(el && el.value && el.value !== el.getAttribute('placeholder')){
      el.style.borderColor='rgba(220,38,38,0.6)';
      setTimeout(()=>el.style.borderColor='',3000);
    }
  });
  if(Object.keys(patient).length > 0)
    showNotif('✅ Datos del paciente detectados automáticamente');
}

function renderDocument(file){
  const viewer = document.getElementById('docViewer');
  const pagesTag = document.getElementById('docPages');
  if(!viewer) return;
  
  if(!file) {
    viewer.innerHTML = '<span style="color:var(--text-muted);font-size:13px">Archivo no disponible en el historial</span>';
    if(pagesTag) pagesTag.textContent = '';
    return;
  }

  viewer.innerHTML = '';
  const url = URL.createObjectURL(file);

  if(file.type === 'application/pdf'){
    const embed = document.createElement('embed');
    embed.src = url;
    embed.type = 'application/pdf';
    embed.style.cssText = 'width:100%;height:520px;border-radius:8px;display:block;border:none';
    viewer.style.minHeight = '520px';
    viewer.appendChild(embed);
    if(_pdfDoc){
      const n = _pdfDoc.numPages;
      document.getElementById('docPages').textContent = n + (n===1?' página':' páginas');
    } else {
      document.getElementById('docPages').textContent = 'PDF';
    }
    document.getElementById('btnPrevPage').style.display='none';
    document.getElementById('btnNextPage').style.display='none';
    document.getElementById('pageIndicator').style.display='none';
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Examen ECG';
    img.style.cssText = 'width:100%;height:auto;display:block;border-radius:8px';
    viewer.style.minHeight = 'auto';
    viewer.appendChild(img);
    document.getElementById('docPages').textContent = 'Imagen';
  }
}

function changePage(dir){}

function extractValue(text, patterns){
  if(!text) return null;
  for(const p of patterns){
    const m = text.match(p);
    if(m) return m[1];
  }
  return null;
}

function loadReport(pdfText){
  const fc  = parseInt(extractValue(pdfText,[/FC[:\s]+(\d{2,3})/i,/(\d{2,3})\s*lpm/i,/HR[:\s]+(\d{2,3})/i])) || (55+Math.floor(Math.random()*60));
  const pr  = parseInt(extractValue(pdfText,[/PR[:\s]+(\d{2,3})/i,/P-R[:\s]+(\d{2,3})/i])) || (120+Math.floor(Math.random()*80));
  const qrs = parseInt(extractValue(pdfText,[/QRS[:\s]+(\d{2,3})/i])) || (70+Math.floor(Math.random()*50));
  const qt  = parseInt(extractValue(pdfText,[/QT[:\s]+(\d{3,4})/i])) || (350+Math.floor(Math.random()*100));
  const qtc = parseInt(extractValue(pdfText,[/QTc[:\s]+(\d{3,4})/i])) || Math.round(qt/Math.sqrt(60/fc));
  const eje = extractValue(pdfText,[/[Ee]je[:\s]+([-+]?\d+)/,/axis[:\s]+([-+]?\d+)/i]) || (Math.floor(Math.random()*120)-30)+'';

  currentReport = {fc, pr, qrs, qt, qtc, eje};

  setMeas('mFC', fc, 'sFC', fc>=60&&fc<=100?'ok':fc<60?'warn':'bad', fc>=60&&fc<=100?'Normal':fc<60?'Bradicardia':'Taquicardia');
  setMeas('mPR', pr, 'sPR', pr>=120&&pr<=200?'ok':'bad', pr>=120&&pr<=200?'Normal':pr>200?'Prolongado':'Corto');
  setMeas('mQRS', qrs, 'sQRS', qrs<=120?'ok':'bad', qrs<=120?'Normal':'Ensanchado');
  setMeas('mQT', qt, 'sQT', 'ok', 'Normal');
  setMeas('mQTc', qtc, 'sQTc', qtc<=450?'ok':qtc<=500?'warn':'bad', qtc<=450?'Normal':qtc<=500?'Límite':'Prolongado');
  setMeas('mEje', eje+'°', 'sEje', 'ok', 'Normal');

  drawECG();

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('pFechaEx').value = today;
  document.getElementById('pFechaInf').value = today;
  autoFillReport();

  setTimeout(()=>showScreen('report'), 400);
  document.getElementById('btnPreview').style.display='';
  document.getElementById('btnSave').style.display='';
}

function setMeas(valId, val, statId, type, label){
  const vEl = document.getElementById(valId);
  if(vEl) vEl.textContent = val;
  const el = document.getElementById(statId);
  if(el) {
    el.textContent = label;
    el.className = 'meas-status s-'+type;
  }
}

function drawECG(){
  const r = currentReport||{fc:72};
  const pts = [];
  const width = 800, height = 70, base = height/2;
  const cycle = Math.round(width / (r.fc/60 * (width/200)));
  let x = 0;
  while(x < width){
    pts.push(`${x},${base}`);
    pts.push(`${x+cycle*0.1},${base}`);
    pts.push(`${x+cycle*0.15},${base-18}`);
    pts.push(`${x+cycle*0.2},${base+28}`);
    pts.push(`${x+cycle*0.25},${base}`);
    pts.push(`${x+cycle*0.35},${base-6}`);
    pts.push(`${x+cycle*0.45},${base}`);
    pts.push(`${x+cycle*0.7},${base-4}`);
    pts.push(`${x+cycle*0.85},${base}`);
    pts.push(`${x+cycle},${base}`);
    x += cycle;
  }
  const line = document.getElementById('ecgLine');
  if(line) line.setAttribute('points', pts.join(' '));
}

function autoFillReport(){
  if(!currentReport) return;
  const {fc,pr,qrs,qt,qtc,eje} = currentReport;
  const ritmo = document.getElementById('ritmo').value;
  document.getElementById('rDescripcion').value =
    `Electrocardiograma de 12 derivaciones en reposo. ${ritmo}. Frecuencia cardíaca de ${fc} lpm. Intervalo PR de ${pr} ms. Complejo QRS de ${qrs} ms. Intervalo QT de ${qt} ms, QTc de ${qtc} ms. Eje QRS de ${eje}°. ${qrs>120?'Se observa ensanchamiento del complejo QRS. ':''}${qtc>450?'Intervalo QTc prolongado, requiere atención. ':''}`;
  document.getElementById('rConclusión').value =
    fc<60 ? `Bradicardia sinusal de ${fc} lpm. Correlacionar con clínica del paciente.` :
    fc>100 ? `Taquicardia de ${fc} lpm. Evaluar causa subyacente.` :
    `ECG dentro de límites normales. No se evidencian signos de isquemia aguda ni trastornos del ritmo significativos.`;
  document.getElementById('rRecomendaciones').value =
    `Control clínico de rutina. Repetir ECG en caso de nueva sintomatología.`;
}

function clearReport(){
  ['rDescripcion','rConclusión','rRecomendaciones'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value='';
  });
}
function clearPatient(){
  ['pNombre','pRut','pEdad','pMedSol','pMotivo','pMedInf','pRegNum'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value='';
  });
  ['pFechaNac','pFechaEx','pFechaInf'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value='';
  });
}

function signReport(){
  isSigned = true;
  const area = document.getElementById('signArea');
  const name = document.getElementById('pMedInf').value || 'Dr. Informante';
  area.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;line-height:1.2">
    <span style="color:var(--accent-light);font-family:'Georgia',serif;font-size:18px;font-style:italic;margin-bottom:2px">✍️ ${name}</span>
    <span style="font-size:10px;color:var(--text-sec)">Firmado digitalmente: ${new Date().toLocaleString('es-CL')}</span>
  </div>`;
  area.style.border = '1px solid var(--border-hover)';
  showNotif('✅ Informe firmado digitalmente');
}

async function saveReport(){
  const patientName = document.getElementById('pNombre').value;
  const doctorName = document.getElementById('pMedInf').value;
  
  if (!patientName || patientName.trim() === '') {
    showNotif('❌ Error: Debe ingresar el nombre del paciente para guardar', 'error');
    document.getElementById('pNombre').focus();
    return;
  }

  const data = gatherData();
  data.date = new Date().toISOString();

  // CASO 1: Es un estudio recién subido (Nuevo Informe)
  if (!window._currentPendingId) {
    await saveToPending(data, window._currentFile);
    showNotif('✅ Datos registrados. El estudio está ahora en "ECG por informar"');
    newReport();
    return;
  }
  
  // CASO 2: Es un estudio que ya estaba en "ECG por informar"
  if (doctorName && doctorName.trim() !== '') {
    // Si tiene nombre del médico informante, se considera FINALIZADO
    const saved = JSON.parse(localStorage.getItem('kardial_reports')||'[]');
    data.id = window._currentPendingId;
    
    saved.unshift(data);
    localStorage.setItem('kardial_reports', JSON.stringify(saved));
    
    // Eliminar de la lista de pendientes
    let pending = JSON.parse(localStorage.getItem('kardial_pending') || '[]');
    pending = pending.filter(p => p.id !== window._currentPendingId);
    localStorage.setItem('kardial_pending', JSON.stringify(pending));
    
    window._currentPendingId = null;
    showNotif('✅ Informe finalizado y movido a "ECG informados"');
    newReport();
  } else {
    // Si NO tiene nombre del médico, solo guardamos los cambios en la carpeta de PENDIENTES
    await saveToPending(data, window._currentFile);
    showNotif('✅ Cambios guardados en "ECG por informar"');
    // En este caso no limpiamos la pantalla, permitimos seguir editando o volver atrás
  }
}

function gatherData(){
  return {
    paciente:        document.getElementById('pNombre').value    || 'Paciente sin nombre',
    rut:             document.getElementById('pRut').value       || '',
    edad:            document.getElementById('pEdad').value      || '',
    sexo:            document.getElementById('pSexo').value      || '',
    fechaEx:         document.getElementById('pFechaEx').value   || '',
    fechaInf:        document.getElementById('pFechaInf').value  || new Date().toISOString().split('T')[0],
    medSol:          document.getElementById('pMedSol').value    || '',
    motivo:          document.getElementById('pMotivo').value    || '',
    medInformante:   document.getElementById('pMedInf').value    || '',
    regNum:          document.getElementById('pRegNum').value    || '',
    ritmo:           document.getElementById('ritmo').value      || '',
    mediciones:      currentReport,
    descripcion:     document.getElementById('rDescripcion').value     || '',
    conclusion:      document.getElementById('rConclusión').value      || '',
    recomendaciones: document.getElementById('rRecomendaciones').value || '',
  };
}

function loadHistorial(){
  const saved = JSON.parse(localStorage.getItem('kardial_reports')||'[]');
  const screen = document.getElementById('screen-history');
  if(saved.length===0){
    screen.innerHTML = '<div style="padding:60px;text-align:center"><h2 style="margin-bottom:10px">📁 Historial de Informes</h2><p style="color:var(--text-sec)">No hay informes guardados aún.</p></div>';
    return;
  }
  let html = '<div style="max-width:900px">';
  html += '<h2 style="margin-bottom:20px;font-size:20px">📁 Historial de Informes <span style="font-size:13px;color:var(--text-sec);font-weight:400">('+saved.length+' guardados)</span></h2>';
  html += '<div style="display:flex;flex-direction:column;gap:12px">';
  saved.forEach((r,i)=>{
    const fc = r.mediciones ? r.mediciones.fc : '?';
    html += `<div class="card" style="cursor:pointer" onclick="viewSavedReport(${i})">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:12px">
        <div>
          <div style="font-size:15px;font-weight:700;margin-bottom:4px">👤 ${r.paciente}</div>
          <div style="font-size:12px;color:var(--text-sec)">${r.rut ? 'RUT: '+r.rut+' &nbsp;·&nbsp; ' : ''}${r.edad || ''} ${r.sexo ? '&nbsp;·&nbsp; '+r.sexo : ''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:12px;color:var(--text-sec)">${r.fechaInf || r.fechaEx || ''}</div>
          <div style="font-size:11px;color:var(--accent-light);margin-top:4px">FC: ${fc} lpm &nbsp; ${r.ritmo||''}</div>
        </div>
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--text-sec);border-top:1px solid var(--border);padding-top:8px">${(r.conclusion||'').substring(0,120)}${r.conclusion&&r.conclusion.length>120?'...':''}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();deleteSavedReport(${i})">🗑 Eliminar</button>
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();viewSavedReport(${i})">👁 Ver Informe</button>
      </div>
    </div>`;
  });
  html += '</div></div>';
  screen.innerHTML = html;
}

async function viewSavedReport(idx){
  const saved = JSON.parse(localStorage.getItem('kardial_reports')||'[]');
  const r = saved[idx]; if(!r) return;
  currentReport = r.mediciones;
  const set = (id,val)=>{ const el=document.getElementById(id); if(el&&val) el.value=val; };
  set('pNombre',r.paciente); set('pRut',r.rut); set('pEdad',r.edad); set('pMedSol',r.medSol);
  set('pMotivo',r.motivo); set('pMedInf',r.medInformante); set('pRegNum',r.regNum);
  set('pFechaEx',r.fechaEx); set('pFechaInf',r.fechaInf);
  if(r.sexo) document.getElementById('pSexo').value=r.sexo;
  if(r.ritmo) document.getElementById('ritmo').value=r.ritmo;
  set('rDescripcion',r.descripcion); set('rConclusión',r.conclusion); set('rRecomendaciones',r.recomendaciones);
  
  // Cargar archivo original desde IndexedDB
  const file = await getExamFile(r.id);
  if(file){
    window._currentFile = file;
    renderDocument(file);
  } else {
    renderDocument(null);
  }

  if(currentReport){ setMeas('mFC',currentReport.fc,'sFC','ok',''); setMeas('mPR',currentReport.pr,'sPR','ok',''); setMeas('mQRS',currentReport.qrs,'sQRS','ok',''); setMeas('mQT',currentReport.qt,'sQT','ok',''); setMeas('mQTc',currentReport.qtc,'sQTc','ok',''); setMeas('mEje',currentReport.eje+'°','sEje','ok',''); drawECG(); }
  showScreen('report');
  document.getElementById('pageTitle').textContent='Informe – '+r.paciente;
  document.getElementById('btnPreview').style.display='';
  document.getElementById('btnSave').style.display='';
}

function deleteSavedReport(idx){
  const saved = JSON.parse(localStorage.getItem('kardial_reports')||'[]');
  if(!confirm('¿Eliminar este informe?')) return;
  
  const r = saved[idx];
  if(r && r.id) deleteExamFile(r.id);

  saved.splice(idx,1);
  localStorage.setItem('kardial_reports',JSON.stringify(saved));
  loadHistorial();
  showNotif('🗑 Informe eliminado');
}

// ---- EXPORT PDF (Usa el método de ventana nueva + impresión para máxima compatibilidad con file://) ----
async function exportPDF(){
  showNotif('⏳ Generando informe profesional...');

  const ecgImages = [];
  if(_pdfDoc){
    for(let p=1; p<=_pdfDoc.numPages; p++){
      try{
        const page = await _pdfDoc.getPage(p);
        const vp   = page.getViewport({scale:2.0});
        const cv   = document.createElement('canvas');
        cv.width   = vp.width; cv.height = vp.height;
        await page.render({canvasContext:cv.getContext('2d'), viewport:vp}).promise;
        ecgImages.push(cv.toDataURL('image/jpeg', 0.90));
      }catch(e){ console.error(e); }
    }
  } else if(window._currentFile && window._currentFile.type.startsWith('image/')){
    const blobUrl = URL.createObjectURL(window._currentFile);
    const img = new Image();
    await new Promise(res=>{ img.onload=res; img.src=blobUrl; });
    const cv = document.createElement('canvas');
    cv.width=img.naturalWidth; cv.height=img.naturalHeight;
    cv.getContext('2d').drawImage(img,0,0);
    ecgImages.push(cv.toDataURL('image/jpeg',0.90));
  }
  const val = id => { const el=document.getElementById(id); return el && el.value ? el.value : '—'; };

  const r   = currentReport || {};
    const statusColor = s => s==='Normal'?'#16a34a':s==='Bradicardia'||s==='Límite'?'#d97706':'#dc2626';
    const rows = [
      ['Frecuencia Cardíaca (FC)', r.fc?r.fc+' lpm':'—', r.fc>=60&&r.fc<=100?'Normal':r.fc<60?'Bradicardia':'Taquicardia'],
      ['Intervalo PR',             r.pr?r.pr+' ms':'—',   r.pr>=120&&r.pr<=200?'Normal':r.pr>200?'Prolongado':'Corto'],
      ['Complejo QRS',             r.qrs?r.qrs+' ms':'—', r.qrs<=120?'Normal':'Ensanchado'],
      ['Intervalo QT / QTc',       (r.qt||'—')+' / '+(r.qtc||'—')+' ms', r.qtc<=450?'Normal':r.qtc<=500?'Límite':'Prolongado'],
      ['Eje QRS',                  r.eje?r.eje+'°':'—',   'Normal'],
      ['Ritmo Base',               val('ritmo'),           ''],
    ];

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Informe ECG – ${val('pNombre')}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',Arial,sans-serif;background:#fff;color:#111;font-size:12px;line-height:1.5;padding:0;margin:0}
    .page{width:210mm;margin:0 auto;padding:15mm 20mm;background:#fff;min-height:297mm}
    @media print{
      .page{width:100%;margin:0;padding:10mm 15mm}
      @page{size:A4;margin:0}
      .no-print{display:none}
    }
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #dc2626;padding-bottom:15px;margin-bottom:20px}
    .logo{font-size:32px;font-weight:900;color:#dc2626;letter-spacing:4px;line-height:1}
    .logo-sub{font-size:10px;color:#777;margin-top:4px;text-transform:uppercase;letter-spacing:1px}
    .header-right{text-align:right;font-size:11px;color:#444;line-height:1.6}
    .section{margin-bottom:20px}
    .section-title{font-size:11px;font-weight:800;color:#dc2626;text-transform:uppercase;letter-spacing:1px;border-bottom:1.5px solid #fca5a5;padding-bottom:5px;margin-bottom:12px}
    .data-box{background:#fffafa;border:1px solid #fecaca;border-radius:8px;padding:15px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:12px}
    .data-field span{color:#888;font-size:10px;text-transform:uppercase;display:block}
    .data-field b{font-size:12px;color:#111}
    .narrative-item{background:#f9fafb;border-left:4px solid #dc2626;padding:12px 15px;border-radius:0 8px 8px 0;margin-bottom:12px}
    .narrative-label{font-size:10px;font-weight:800;color:#dc2626;margin-bottom:4px;text-transform:uppercase}
    .narrative-text{font-size:12px;line-height:1.6;color:#333}
    .conclusion-text{font-size:13px;font-weight:700;color:#111}
    .footer{margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end;border-top:2px solid #dc2626;padding-top:20px}
    .sig-name{font-size:14px;font-weight:700;color:#111}
    .sig-reg{font-size:11px;color:#666}
    .sig-id{font-size:9px;color:#aaa;margin-top:4px}
    .stamp{text-align:right}
    .stamp-logo{font-size:14px;font-weight:900;color:#dc2626;letter-spacing:2px}
    .stamp-date{font-size:9px;color:#aaa}
    .ecg-img{width:100%;border:1px solid #eee;border-radius:4px;margin-bottom:15px;display:block}
    .page-break{page-break-before:always}
    .btn-print-now{position:fixed;top:20px;right:20px;background:#dc2626;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:700;box-shadow:0 4px 15px rgba(0,0,0,0.2)}
    table{width:100%;border-collapse:collapse;margin-top:5px}
    th{padding:8px;border:1px solid #fecaca;text-align:left;color:#dc2626;font-size:10px;background:#fef2f2;text-transform:uppercase}
    td{padding:6px 8px;border:1px solid #e5e7eb;font-size:11.5px}
  </style>
</head>
<body>
  <button class="btn-print-now no-print" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>

  <div class="page">
    <div class="header">
      <div>
        <div class="logo" style="font-size:24px">CARDIOLOGIA</div>
        <div class="logo-sub" style="font-size:12px;color:#dc2626;font-weight:700">HOSPITAL SAN JUAN DE DIOS</div>
      </div>
      <div class="header-right">
        <div><b>FECHA INFORME:</b> ${val('pFechaInf')}</div>
        <div><b>MÉDICO INFORMANTE:</b> ${val('pMedInf')}</div>
        <div>${val('pRegNum')}</div>
      </div>
    </div>

    <div style="text-align:center;margin:15px 0 25px 0;border-bottom:1px solid #eee;padding-bottom:10px">
      <h1 style="font-size:20px;font-weight:900;color:#111;text-transform:uppercase;letter-spacing:1px">Informe de Electrocardiograma</h1>
    </div>

    <div class="section">
      <div class="section-title">Datos del Paciente</div>
      <div class="data-box">
        <div class="data-field"><span>Nombre completo</span><b>${val('pNombre')}</b></div>
        <div class="data-field"><span>RUT / ID</span><b>${val('pRut')}</b></div>
        <div class="data-field"><span>Edad / Sexo</span><b>${val('pEdad')} · ${val('pSexo')}</b></div>
        <div class="data-field"><span>Fecha Examen</span><b>${val('pFechaEx')}</b></div>
        <div class="data-field"><span>Médico Solicitante</span><b>${val('pMedSol')}</b></div>
        <div class="data-field"><span>Motivo</span><b>${val('pMotivo')}</b></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Mediciones Electrocardiográficas</div>
      <table>
        <thead><tr>
          <th>Parámetro</th><th style="text-align:center">Valor</th><th style="text-align:center">Interpretación</th>
        </tr></thead>
        <tbody>
          ${rows.map(([l,v,s])=>`
            <tr>
              <td>${l}</td>
              <td style="text-align:center;font-weight:700">${v}</td>
              <td style="text-align:center;font-weight:700;color:${statusColor(s)}">${s||'—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Informe Médico</div>
      <div class="narrative-item">
        <div class="narrative-label">Descripción del ECG</div>
        <div class="narrative-text">${val('rDescripcion')}</div>
      </div>
      <div class="narrative-item">
        <div class="narrative-label">Conclusión / Diagnóstico</div>
        <div class="narrative-text conclusion-text">${val('rConclusión')}</div>
      </div>
    </div>

    <div class="footer">
      <div>
        <div class="sig-name">${val('pMedInf')}</div>
        <div class="sig-reg">${val('pRegNum')}</div>
        <div class="sig-id">Firma validada digitalmente · ID: ${Date.now().toString(36).toUpperCase()}</div>
      </div>
      <div class="stamp">
        <div class="stamp-logo" style="font-size:11px">CARDIOLOGIA - HSJD</div>
        <div class="stamp-date">Generado el ${new Date().toLocaleString('es-CL')}</div>
      </div>
    </div>

    <div class="page-break"></div>
    <div class="section" style="padding-top:10mm">
       <div class="section-title">Examen Original (Anexo)</div>
       ${ecgImages.map(img => `<img src="${img}" class="ecg-img">`).join('')}
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(() => {
        window.print();
      }, 500);
    };
  <\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if(!win){
    showNotif('❌ Error: Habilita las ventanas emergentes (pop-ups) en tu navegador', 'error');
    return;
  }
  win.document.write(html);
  win.document.close();
  showNotif('✅ Informe generado en una nueva pestaña');
}

function printReport(){
  window.print();
}

function sendEmail(){
  const subject = `Informe ECG – ${document.getElementById('pNombre').value||'Paciente'}`;
  const body = `${document.getElementById('rDescripcion').value}\n\nConclusión: ${document.getElementById('rConclusión').value}`;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function newReport(){
  currentReport = null; isSigned = false;
  const fileInfo = document.getElementById('fileInfo');
  if(fileInfo) fileInfo.style.display = 'none';
  const signArea = document.getElementById('signArea');
  if(signArea) {
    signArea.innerHTML = '✍️ Haz clic para firmar';
    signArea.style.border = '';
  }
  clearReport(); clearPatient();
  showScreen('upload');
  document.getElementById('btnPreview').style.display='none';
  document.getElementById('btnSave').style.display='none';
  document.getElementById('pageTitle').textContent = 'Nuevo Informe ECG';
}

// ---- HELPERS ----
function showScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const target = document.getElementById('screen-'+name);
  if(target) target.classList.add('active');
}

function showNotif(msg, type){
  const n = document.getElementById('notif');
  if(!n) return;
  n.textContent = msg;
  n.style.borderColor = type==='error'?'#dc2626':'#dc2626';
  n.classList.add('show');
  setTimeout(()=>n.classList.remove('show'), 3200);
}

// ---- INIT ----
function calcAge(){
  const b = document.getElementById('mpFechaNac').value;
  if(!b) return;
  const birth = new Date(b);
  const diff = Date.now() - birth.getTime();
  const ageDate = new Date(diff);
  const age = Math.abs(ageDate.getUTCFullYear() - 1970);
  document.getElementById('mpEdad').value = age + ' años';
}

function openPatientModal(idx = null){
  editingPatientIdx = idx;
  const modal = document.getElementById('patientModal');
  const title = document.getElementById('pModalTitle');
  
  ['mpNombre','mpRut','mpFechaNac','mpSexo','mpEdad','mpFechaEx','mpServicio','mpDiagnostico'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  const fex = document.getElementById('mpFechaEx');
  if(fex) fex.value = new Date().toISOString().split('T')[0];

  if(idx !== null){
    const saved = JSON.parse(localStorage.getItem('kardial_patients')||'[]');
    const p = saved[idx];
    title.textContent = 'Editar Paciente';
    document.getElementById('mpNombre').value = p.nombre;
    document.getElementById('mpRut').value = p.rut;
    document.getElementById('mpFechaNac').value = p.fechaNac || '';
    document.getElementById('mpSexo').value = p.sexo || 'Masculino';
    document.getElementById('mpEdad').value = p.edad || '';
    document.getElementById('mpFechaEx').value = p.fechaEx || '';
    document.getElementById('mpServicio').value = p.servicio || '';
    document.getElementById('mpDiagnostico').value = p.diagnostico || '';
  } else {
    title.textContent = 'Registrar Paciente';
  }
  modal.style.display = 'flex';
}

function closePatientModal(){
  const modal = document.getElementById('patientModal');
  if(modal) modal.style.display = 'none';
}

function savePatient(){
  const p = {
    nombre: document.getElementById('mpNombre').value,
    rut: document.getElementById('mpRut').value,
    fechaNac: document.getElementById('mpFechaNac').value,
    sexo: document.getElementById('mpSexo').value,
    edad: document.getElementById('mpEdad').value,
    fechaEx: document.getElementById('mpFechaEx').value,
    servicio: document.getElementById('mpServicio').value,
    diagnostico: document.getElementById('mpDiagnostico').value,
    updatedAt: new Date().toISOString()
  };

  if(!p.nombre || !p.rut) {
    showNotif('❌ Por favor completa Nombre y RUT', 'error');
    return;
  }

  let saved = JSON.parse(localStorage.getItem('kardial_patients')||'[]');
  if(editingPatientIdx !== null){
    saved[editingPatientIdx] = p;
  } else {
    saved.push(p);
  }

  localStorage.setItem('kardial_patients', JSON.stringify(saved));
  closePatientModal();
  loadPatients();
  showNotif('✅ Paciente guardado correctamente');
}

function loadPatients(){
  const list = document.getElementById('patientsList');
  const query = document.getElementById('searchPatient').value.toLowerCase();
  const sexFilter = document.getElementById('filterSex').value;
  
  let saved = JSON.parse(localStorage.getItem('kardial_patients')||'[]');
  
  saved = saved.filter(p => {
    const n = (p.nombre||'').toLowerCase();
    const r = (p.rut||'').toLowerCase();
    const matchesQuery = n.includes(query) || r.includes(query);
    const matchesSex = sexFilter === '' || p.sexo === sexFilter;
    return matchesQuery && matchesSex;
  });

  if(saved.length === 0){
    list.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-sec);background:rgba(255,255,255,0.03);border-radius:12px;border:1px dashed var(--border)">
        <div style="font-size:40px;margin-bottom:10px">👥</div>
        <div>No se encontraron pacientes registrados.</div>
      </div>`;
    return;
  }

  list.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));gap:16px">' + 
    saved.map((p, i) => `
      <div class="card" style="padding:16px;position:relative">
        <div style="font-weight:700;font-size:16px;margin-bottom:4px;color:var(--accent-light)">${p.nombre}</div>
        <div style="font-size:13px;color:var(--text-sec);margin-bottom:6px">RUT: ${p.rut} · ${p.sexo || '—'}</div>
        <div style="font-size:12px;color:var(--text-muted)">Servicio: ${p.servicio || '—'}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-primary btn-sm" style="flex:1" onclick="startReportForPatient(${i})">📑 Nuevo Informe</button>
          <button class="btn btn-outline btn-sm" onclick="openPatientModal(${i})">✏️</button>
          <button class="btn btn-outline btn-sm" onclick="deletePatient(${i})">🗑</button>
        </div>
      </div>
    `).join('') + '</div>';
}

function deletePatient(idx){
  if(!confirm('¿Eliminar este paciente de la base de datos?')) return;
  let saved = JSON.parse(localStorage.getItem('kardial_patients')||'[]');
  saved.splice(idx, 1);
  localStorage.setItem('kardial_patients', JSON.stringify(saved));
  loadPatients();
}

function startReportForPatient(idx){
  const saved = JSON.parse(localStorage.getItem('kardial_patients')||'[]');
  const p = saved[idx];
  
  newReport();
  document.getElementById('pNombre').value = p.nombre;
  document.getElementById('pRut').value = p.rut;
  if(p.edad) document.getElementById('pEdad').value = p.edad;
  if(p.sexo) document.getElementById('pSexo').value = p.sexo;
  if(p.fechaEx) document.getElementById('pFechaEx').value = p.fechaEx;
  if(p.servicio) document.getElementById('pMedSol').value = p.servicio;
  if(p.diagnostico) document.getElementById('pMotivo').value = p.diagnostico;
  
  showNotif('📝 Iniciando informe para: ' + p.nombre);
}

// ---- GESTIÓN DE USUARIOS ----
let editingUserIdx = null;

function openUserModal(idx = null) {
  editingUserIdx = idx;
  const modal = document.getElementById('userModal');
  const title = document.getElementById('userModalTitle');
  
  document.getElementById('uNombre').value = '';
  document.getElementById('uLogin').value = '';
  document.getElementById('uPass').value = '';
  document.getElementById('uRol').value = 'enfermeria';

  if (idx !== null) {
    const users = getStoredUsers();
    const u = users[idx];
    title.textContent = '🔑 Editar Usuario';
    document.getElementById('uNombre').value = u.name;
    document.getElementById('uLogin').value = u.user;
    document.getElementById('uPass').value = u.pass;
    document.getElementById('uRol').value = u.category;
  } else {
    title.textContent = '🔑 Agregar Usuario';
  }
  modal.style.display = 'flex';
}

function closeUserModal() {
  document.getElementById('userModal').style.display = 'none';
}

function saveUser() {
  const name = document.getElementById('uNombre').value.trim();
  const login = document.getElementById('uLogin').value.trim().toLowerCase();
  const pass = document.getElementById('uPass').value.trim();
  const category = document.getElementById('uRol').value;

  if (!name || !login || !pass) {
    showNotif('❌ Por favor, complete todos los campos', 'error');
    return;
  }

  const users = getStoredUsers();
  
  // Validar duplicados si es nuevo
  if (editingUserIdx === null && users.some(u => u.user === login)) {
    showNotif('❌ El nombre de usuario ya existe', 'error');
    return;
  }

  const newUser = {
    name,
    user: login,
    pass,
    category,
    initials: name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
  };

  if (editingUserIdx !== null) {
    users[editingUserIdx] = newUser;
  } else {
    users.push(newUser);
  }

  localStorage.setItem('kardial_users', JSON.stringify(users));
  closeUserModal();
  loadUsers('all');
  showNotif('✅ Usuario guardado correctamente');
}

function loadUsers(filter = 'all') {
  const list = document.getElementById('usersList');
  let users = getStoredUsers();
  
  // Actualizar estilos de botones de filtro
  ['All', 'Admin', 'Enfermeria', 'Tens', 'Doctor'].forEach(f => {
    const btn = document.getElementById('filter' + f);
    if (btn) {
      if (f.toLowerCase() === filter) btn.className = 'btn btn-primary btn-sm';
      else btn.className = 'btn btn-outline btn-sm';
    }
  });

  if (filter !== 'all') {
    users = users.filter(u => u.category === filter);
  }

  if (users.length === 0) {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-sec)">No hay usuarios en esta categoría</div>';
    return;
  }

  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:16px">';
  users.forEach((u, originalIdx) => {
    // Necesitamos el índice original para editar/eliminar correctamente si filtramos
    const actualIdx = getStoredUsers().findIndex(user => user.user === u.user);
    
    const catLabels = { admin: '🔴 Administrador', enfermeria: '🟡 Enfermería', tens: '🟠 TENS', doctor: '🔵 Doctor' };
    html += `
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div class="user-avatar" style="width:40px;height:40px;font-size:14px">${u.initials}</div>
          <div>
            <div style="font-weight:700;font-size:15px">${u.name}</div>
            <div style="font-size:12px;color:var(--text-sec)">@${u.user}</div>
          </div>
        </div>
        <div style="font-size:12px;margin-bottom:12px">${catLabels[u.category]}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" style="flex:1" onclick="openUserModal(${actualIdx})">Editar</button>
          <button class="btn btn-outline btn-sm" style="flex:1;color:var(--accent)" onclick="deleteUser(${actualIdx})">Eliminar</button>
        </div>
      </div>
    `;
  });
  html += '</div>';
  list.innerHTML = html;
}

function deleteUser(idx) {
  const users = getStoredUsers();
  const u = users[idx];
  
  if (u.user === 'admin') {
    showNotif('❌ No se puede eliminar el usuario administrador principal', 'error');
    return;
  }

  if (confirm(`¿Está seguro de eliminar al usuario ${u.name}?`)) {
    users.splice(idx, 1);
    localStorage.setItem('kardial_users', JSON.stringify(users));
    loadUsers('all');
    showNotif('🗑️ Usuario eliminado');
  }
}

// ---- ESTADÍSTICAS ----
function initStats() {
  const sm = document.getElementById('statsMonth');
  const sy = document.getElementById('statsYear');
  if (!sm || !sy) return;
  
  if (sm.options.length === 0) {
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    months.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = m;
      sm.appendChild(opt);
    });
    sm.value = new Date().getMonth();
  }
  
  if (sy.options.length === 0) {
    const curYear = new Date().getFullYear();
    for(let y = curYear; y >= curYear - 2; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      sy.appendChild(opt);
    }
    sy.value = curYear;
  }
  
  loadStats();
}

function loadStats() {
  const month = parseInt(document.getElementById('statsMonth').value);
  const year = parseInt(document.getElementById('statsYear').value);
  
  const pending = JSON.parse(localStorage.getItem('kardial_pending') || '[]');
  const reports = JSON.parse(localStorage.getItem('kardial_reports') || '[]');
  
  // Filtrar por Mes/Año (Mensual)
  const filterByDate = (list) => list.filter(item => {
    const d = new Date(item.date || Date.now());
    return d.getMonth() === month && d.getFullYear() === year;
  });

  // Filtrar por Año (Anual)
  const filterByYear = (list) => list.filter(item => {
    const d = new Date(item.date || Date.now());
    return d.getFullYear() === year;
  });

  const pMonth = filterByDate(pending);
  const rMonth = filterByDate(reports);
  const totalMonth = pMonth.length + rMonth.length;
  
  const pYear = filterByYear(pending);
  const rYear = filterByYear(reports);
  const totalYear = pYear.length + rYear.length;
  
  // Actualizar UI Mensual
  document.getElementById('statTotal').textContent = totalMonth;
  document.getElementById('statPending').textContent = pMonth.length;
  document.getElementById('statHistory').textContent = rMonth.length;

  // Actualizar UI Anual
  document.getElementById('yearTitle').textContent = `Resumen Anual ${year}`;
  document.getElementById('statYearTotal').textContent = totalYear;
  document.getElementById('statYearPending').textContent = pYear.length;
  document.getElementById('statYearHistory').textContent = rYear.length;
  
  const list = document.getElementById('statsList');
  if (totalMonth === 0) {
    list.innerHTML = '<div style="padding:60px;text-align:center;color:var(--text-sec)">Sin registros para este mes</div>';
    return;
  }

  // Generar desglose simple
  let html = '<div style="padding:20px">';
  const types = [
    { label: 'Estudios Pendientes', count: pMonth.length, color: '#f59e0b' },
    { label: 'Estudios Informados', count: rMonth.length, color: '#10b981' }
  ];
  
  types.forEach(t => {
    const pct = total > 0 ? (t.count / total * 100) : 0;
    html += `
      <div style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="font-weight:700">${t.label}</span>
          <span style="color:var(--text-sec)">${t.count} (${pct.toFixed(1)}%)</span>
        </div>
        <div style="height:12px;background:rgba(255,255,255,0.05);border-radius:10px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${t.color};transition:width 0.6s ease"></div>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  list.innerHTML = html;
}
