import L from 'leaflet';
import './style.css';
import { supabase } from './supabaseClient.js';
import { CATEGORIES } from './categories.js';
import { initNavigation, cancelNavigation, startNavigationTo } from './navigation.js';

const BELFAST_CENTRE = [54.5973, -5.9301];

const map = L.map('map', { zoomControl: false }).setView(BELFAST_CENTRE, 16);

const reportsStore = [];
const markersById = new Map();
let activeFilter = 'all';

function getOwnReportIds() {
  try {
    return JSON.parse(localStorage.getItem('myReportIds') || '[]');
  } catch {
    return [];
  }
}

function rememberOwnReport(id) {
  const ids = getOwnReportIds();
  if (!ids.includes(id)) {
    ids.push(id);
    localStorage.setItem('myReportIds', JSON.stringify(ids));
  }
}

function forgetOwnReport(id) {
  localStorage.setItem('myReportIds', JSON.stringify(getOwnReportIds().filter((existingId) => existingId !== id)));
}

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

// --- Toast ---

const toastEl = document.getElementById('toast');
let toastTimer = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
}

// --- Map pins ---

function iconFor(category) {
  const meta = CATEGORIES[category] ?? { icon: 'place', color: '#333' };
  return L.divIcon({
    html: `<div style="background:${meta.color}" class="pin"><span class="material-symbols-outlined">${meta.icon}</span></div>`,
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });
}

function addPinToMap(report) {
  const marker = L.marker([report.lat, report.lng], { icon: iconFor(report.category) }).addTo(map);
  marker.on('click', () => openPinSheet(report));
  markersById.set(report.id, marker);
  applyFilterToMarker(report, marker);
}

function removePinFromMap(id) {
  const marker = markersById.get(id);
  if (marker) {
    map.removeLayer(marker);
    markersById.delete(id);
  }
  const idx = reportsStore.findIndex((r) => r.id === id);
  if (idx !== -1) reportsStore.splice(idx, 1);
  updateFilterCounts();
}

async function deleteReport(id) {
  const { error } = await supabase.from('reports').delete().eq('id', id);
  if (error) {
    console.error('Failed to delete report', error);
    return;
  }
  removePinFromMap(id);
  forgetOwnReport(id);
}

async function loadExistingReports() {
  const { data, error } = await supabase.from('reports').select('*').order('created_at');
  if (error) {
    console.error('Failed to load reports', error);
    return;
  }
  data.forEach((report) => {
    reportsStore.push(report);
    addPinToMap(report);
  });
  updateFilterCounts();
}

function subscribeToReportChanges() {
  supabase
    .channel('reports-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'reports' },
      (payload) => {
        reportsStore.push(payload.new);
        addPinToMap(payload.new);
        updateFilterCounts();
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'reports' },
      (payload) => removePinFromMap(payload.old.id)
    )
    .subscribe();
}

// --- Filter chips ---

const filterChipsEl = document.getElementById('filter-chips');

function buildFilterChips() {
  const allChip = document.createElement('button');
  allChip.className = 'filter-chip active';
  allChip.dataset.category = 'all';
  allChip.innerHTML = `<span class="material-symbols-outlined">apps</span><span data-count>All (0)</span>`;
  filterChipsEl.appendChild(allChip);

  Object.entries(CATEGORIES).forEach(([key, meta]) => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip';
    chip.dataset.category = key;
    chip.innerHTML = `<span class="material-symbols-outlined">${meta.icon}</span><span data-count>${meta.label} (0)</span>`;
    filterChipsEl.appendChild(chip);
  });

  filterChipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    activeFilter = chip.dataset.category;
    filterChipsEl.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
    reportsStore.forEach((report) => {
      const marker = markersById.get(report.id);
      if (marker) applyFilterToMarker(report, marker);
    });
  });
}

function applyFilterToMarker(report, marker) {
  const visible = activeFilter === 'all' || report.category === activeFilter;
  const el = marker.getElement();
  if (el) el.style.display = visible ? '' : 'none';
}

function updateFilterCounts() {
  const counts = { all: reportsStore.length };
  reportsStore.forEach((r) => {
    counts[r.category] = (counts[r.category] ?? 0) + 1;
  });
  filterChipsEl.querySelectorAll('.filter-chip').forEach((chip) => {
    const key = chip.dataset.category;
    const label = key === 'all' ? 'All' : CATEGORIES[key]?.label ?? key;
    chip.querySelector('[data-count]').textContent = `${label} (${counts[key] ?? 0})`;
  });
}

// --- Pin detail sheet ---

const pinSheet = document.getElementById('pin-sheet');
const pinSheetBadge = document.getElementById('pin-sheet-badge');
const pinSheetTime = document.getElementById('pin-sheet-time');
const pinSheetPhoto = document.getElementById('pin-sheet-photo');
const pinSheetRouteBtn = document.getElementById('pin-sheet-route-btn');
const pinSheetDeleteBtn = document.getElementById('pin-sheet-delete-btn');
const pinSheetResolveBtn = document.getElementById('pin-sheet-resolve-btn');

let activePinReport = null;

function openPinSheet(report) {
  activePinReport = report;
  const meta = CATEGORIES[report.category] ?? { label: report.category, icon: 'place', color: '#333', tint: '#eee' };

  pinSheetBadge.innerHTML = `<span class="material-symbols-outlined">${meta.icon}</span>${meta.label}`;
  pinSheetBadge.style.background = meta.tint;
  pinSheetBadge.style.color = meta.color;

  pinSheetTime.textContent = new Date(report.created_at).toLocaleString();

  if (report.photo_url) {
    pinSheetPhoto.src = report.photo_url;
    pinSheetPhoto.classList.remove('hidden');
  } else {
    pinSheetPhoto.classList.add('hidden');
  }

  const isOwn = getOwnReportIds().includes(report.id);
  pinSheetDeleteBtn.classList.toggle('hidden', !isOwn);
  pinSheetResolveBtn.classList.toggle('hidden', isOwn);

  pinSheet.classList.remove('hidden');
}

function closePinSheet() {
  pinSheet.classList.add('hidden');
  activePinReport = null;
}

document.getElementById('pin-sheet-close').addEventListener('click', closePinSheet);
document.getElementById('pin-sheet-close-btn').addEventListener('click', closePinSheet);

pinSheetRouteBtn.addEventListener('click', () => {
  if (!activePinReport) return;
  const dest = [activePinReport.lat, activePinReport.lng];
  closePinSheet();
  startNavigationTo(dest);
});

pinSheetDeleteBtn.addEventListener('click', () => {
  if (!activePinReport) return;
  deleteReport(activePinReport.id);
  closePinSheet();
});

// "Mark Resolved" has no backing schema/persistence yet — visual-only stub for crowd verification.
pinSheetResolveBtn.addEventListener('click', () => {
  showToast('Thanks! Marked as resolved (not yet saved).');
  closePinSheet();
});

// --- Bottom nav / stub panels ---

const stubPanel = document.getElementById('stub-panel');
const stubPanelTitle = document.getElementById('stub-panel-title');
const stubPanelBody = document.getElementById('stub-panel-body');
const STUB_COPY = {
  alerts: 'Personalized accessibility alerts for your saved routes are coming soon.',
  saved: 'Saving favorite routes and locations is coming soon.',
  profile: 'Account profiles aren’t part of this anonymous, no-login MVP yet.',
};

document.querySelectorAll('.nav-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const key = tab.dataset.tab;
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.toggle('active', t === tab));
    if (key === 'map') {
      stubPanel.classList.add('hidden');
      return;
    }
    stubPanelTitle.textContent = tab.querySelector('span:last-child').textContent + ' — Coming Soon';
    stubPanelBody.textContent = STUB_COPY[key] ?? "This section isn't built yet.";
    stubPanel.classList.remove('hidden');
  });
});

document.getElementById('stub-panel-close').addEventListener('click', () => {
  stubPanel.classList.add('hidden');
  document.querySelectorAll('.nav-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'map'));
});

// --- Search / hamburger (stubs, no backing feature) ---

document.getElementById('menu-btn').addEventListener('click', () => showToast('Menu coming soon'));
document.getElementById('search-btn').addEventListener('click', () => showToast('Search coming soon'));

// --- Map controls ---

document.getElementById('zoom-in-btn').addEventListener('click', () => map.zoomIn());
document.getElementById('zoom-out-btn').addEventListener('click', () => map.zoomOut());
document.getElementById('recenter-btn').addEventListener('click', () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 17),
      () => map.setView(BELFAST_CENTRE, 16)
    );
  } else {
    map.setView(BELFAST_CENTRE, 16);
  }
});

// --- Report wizard ---

const reportBtn = document.getElementById('report-btn');
const reportWizard = document.getElementById('report-wizard');
const cancelBtn = document.getElementById('cancel-btn');
const submitBtn = document.getElementById('submit-btn');
const submitBtnLabel = document.getElementById('submit-btn-label');
const wizardBackBtn = document.getElementById('wizard-back-btn');
const wizardStepText = document.getElementById('wizard-step-text');
const dots = document.querySelectorAll('.dot');
const wizardSteps = document.querySelectorAll('.wizard-step');
const pinHint = document.getElementById('pin-hint');
const locationSummary = document.getElementById('location-summary');
const locationCoords = document.getElementById('location-coords');
const categoryPicker = document.getElementById('category-picker');
const photoInput = document.getElementById('photo-input');
const summaryCategory = document.getElementById('summary-category');

const successPanel = document.getElementById('success-panel');
const successSummary = document.getElementById('success-summary');

let draftMarker = null;
let selectedCategory = null;
let wizardStep = 1;

Object.entries(CATEGORIES).forEach(([key, meta]) => {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'category-card';
  card.dataset.category = key;
  card.innerHTML = `
    <span class="material-symbols-outlined" style="color:${meta.color}">${meta.icon}</span>
    <span class="category-card-label">${meta.label}</span>
    <span class="category-card-desc">${meta.description}</span>
  `;
  categoryPicker.appendChild(card);
});
const categoryCards = document.querySelectorAll('.category-card');

function setWizardStep(step) {
  wizardStep = step;
  wizardSteps.forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === step));
  dots.forEach((d) => {
    const n = Number(d.dataset.dot);
    d.classList.toggle('active', n === step);
    d.classList.toggle('complete', n < step);
  });
  const labels = { 1: 'Location', 2: 'Category', 3: 'Photo & Review' };
  wizardStepText.textContent = `Step ${step} of 3: ${labels[step]}`;
  wizardBackBtn.classList.toggle('hidden', step === 1);
  submitBtnLabel.textContent = step === 3 ? 'Submit Report' : 'Continue';
  updateSubmitEnabled();
}

function updateSubmitEnabled() {
  if (wizardStep === 1) submitBtn.disabled = !draftMarker;
  else if (wizardStep === 2) submitBtn.disabled = !selectedCategory;
  else submitBtn.disabled = false;
}

function startReportFlow() {
  cancelNavigation();
  reportWizard.classList.remove('hidden');
  selectedCategory = null;
  categoryCards.forEach((c) => c.classList.remove('selected'));
  setWizardStep(1);
  pinHint.textContent = 'Getting your location…';
  locationSummary.classList.add('hidden');

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => placeDraftMarker([pos.coords.latitude, pos.coords.longitude]),
      () => enableTapToPlace()
    );
  } else {
    enableTapToPlace();
  }
}

function placeDraftMarker(latlng) {
  if (draftMarker) map.removeLayer(draftMarker);
  draftMarker = L.marker(latlng, { draggable: true }).addTo(map);
  draftMarker.on('dragend', () => updateLocationSummary());
  map.panTo(latlng);
  pinHint.textContent = 'Pin placed at your location.';
  updateLocationSummary();
  updateSubmitEnabled();
}

function updateLocationSummary() {
  if (!draftMarker) return;
  const { lat, lng } = draftMarker.getLatLng();
  locationCoords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  locationSummary.classList.remove('hidden');
}

function enableTapToPlace() {
  pinHint.textContent = 'Tap the map to place your pin.';
  map.once('click', (e) => placeDraftMarker([e.latlng.lat, e.latlng.lng]));
}

function cancelReportFlow() {
  reportWizard.classList.add('hidden');
  if (draftMarker) {
    map.removeLayer(draftMarker);
    draftMarker = null;
  }
  photoInput.value = '';
}

categoryCards.forEach((card) => {
  card.addEventListener('click', () => {
    categoryCards.forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedCategory = card.dataset.category;
    updateSubmitEnabled();
  });
});

photoInput.addEventListener('change', () => {
  const label = document.querySelector('.photo-dropzone-title');
  label.textContent = photoInput.files[0] ? photoInput.files[0].name : 'Tap to capture or upload photo';
});

async function uploadPhotoIfAny() {
  const file = photoInput.files[0];
  if (!file) return null;

  const path = `${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from('report-photos').upload(path, file);
  if (error) {
    console.error('Photo upload failed', error);
    return null;
  }
  const { data } = supabase.storage.from('report-photos').getPublicUrl(path);
  return data.publicUrl;
}

async function submitReport() {
  if (!draftMarker || !selectedCategory) return;

  submitBtn.disabled = true;
  const { lat, lng } = draftMarker.getLatLng();
  const photo_url = await uploadPhotoIfAny();

  const { data, error } = await supabase
    .from('reports')
    .insert({ lat, lng, category: selectedCategory, photo_url })
    .select()
    .single();

  if (error) {
    console.error('Failed to submit report', error);
    submitBtn.disabled = false;
    return;
  }

  rememberOwnReport(data.id);
  showSuccessPanel(data);
  cancelReportFlow();
}

function showSuccessPanel(report) {
  const meta = CATEGORIES[report.category] ?? { label: report.category, icon: 'place', color: '#333' };
  successSummary.innerHTML = `
    <span class="material-symbols-outlined" style="color:${meta.color}">${meta.icon}</span>
    <div>
      <p class="location-title">${meta.label}</p>
      <p class="muted">${new Date(report.created_at).toLocaleString()}</p>
    </div>
  `;
  successPanel.classList.remove('hidden');
}

document.getElementById('success-return-btn').addEventListener('click', () => {
  successPanel.classList.add('hidden');
});

document.getElementById('success-again-btn').addEventListener('click', () => {
  successPanel.classList.add('hidden');
  startReportFlow();
});

wizardBackBtn.addEventListener('click', () => {
  if (wizardStep > 1) setWizardStep(wizardStep - 1);
});

submitBtn.addEventListener('click', () => {
  if (wizardStep < 3) {
    setWizardStep(wizardStep + 1);
    if (wizardStep === 3) {
      summaryCategory.textContent = `${CATEGORIES[selectedCategory]?.label ?? selectedCategory} at ${locationCoords.textContent}`;
    }
  } else {
    submitReport();
  }
});

reportBtn.addEventListener('click', startReportFlow);
cancelBtn.addEventListener('click', cancelReportFlow);

buildFilterChips();
loadExistingReports();
subscribeToReportChanges();
initNavigation(map, () => reportsStore, cancelReportFlow);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
