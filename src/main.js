import L from 'leaflet';
import './style.css';
import { supabase } from './supabaseClient.js';
import { CATEGORIES } from './categories.js';
import { initNavigation, cancelNavigation } from './navigation.js';

const BELFAST_CENTRE = [54.5973, -5.9301];

const map = L.map('map').setView(BELFAST_CENTRE, 16);

const reportsStore = [];
const markersById = new Map();

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

function iconFor(category) {
  const { emoji, color } = CATEGORIES[category] ?? { emoji: '📍', color: '#333' };
  return L.divIcon({
    html: `<div style="background:${color}" class="pin"><span class="pin-emoji">${emoji}</span></div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

function addPinToMap(report) {
  const marker = L.marker([report.lat, report.lng], { icon: iconFor(report.category) }).addTo(map);
  const label = CATEGORIES[report.category]?.label ?? report.category;
  const when = new Date(report.created_at).toLocaleString();
  const photo = report.photo_url ? `<br><img src="${report.photo_url}" class="popup-photo" />` : '';
  const isOwn = getOwnReportIds().includes(report.id);
  const deleteBtn = isOwn
    ? `<br><button class="delete-report-btn" data-id="${report.id}">Delete my report</button>`
    : '';
  marker.bindPopup(`<strong>${label}</strong><br>${when}${photo}${deleteBtn}`, { maxWidth: 220 });

  marker.on('popupopen', () => {
    const popupEl = marker.getPopup().getElement();
    const img = popupEl?.querySelector('img');
    if (img && !img.complete) {
      img.addEventListener('load', () => marker.getPopup().update());
    }
    const delBtn = popupEl?.querySelector('.delete-report-btn');
    delBtn?.addEventListener('click', () => deleteReport(report.id));
  });

  markersById.set(report.id, marker);
}

function removePinFromMap(id) {
  const marker = markersById.get(id);
  if (marker) {
    map.removeLayer(marker);
    markersById.delete(id);
  }
  const idx = reportsStore.findIndex((r) => r.id === id);
  if (idx !== -1) reportsStore.splice(idx, 1);
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
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'reports' },
      (payload) => removePinFromMap(payload.old.id)
    )
    .subscribe();
}

// --- Report flow ---

const reportBtn = document.getElementById('report-btn');
const reportPanel = document.getElementById('report-panel');
const cancelBtn = document.getElementById('cancel-btn');
const submitBtn = document.getElementById('submit-btn');
const photoInput = document.getElementById('photo-input');
const categoryButtons = document.querySelectorAll('#category-picker button');

let draftMarker = null;
let selectedCategory = null;

function startReportFlow() {
  cancelNavigation();
  reportPanel.classList.remove('hidden');
  selectedCategory = null;
  submitBtn.disabled = true;
  categoryButtons.forEach((b) => b.classList.remove('selected'));

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
  map.panTo(latlng);
}

function enableTapToPlace() {
  document.getElementById('pin-hint').textContent = 'Tap the map to place your pin.';
  map.once('click', (e) => placeDraftMarker([e.latlng.lat, e.latlng.lng]));
}

function cancelReportFlow() {
  reportPanel.classList.add('hidden');
  if (draftMarker) {
    map.removeLayer(draftMarker);
    draftMarker = null;
  }
  photoInput.value = '';
}

categoryButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    categoryButtons.forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedCategory = btn.dataset.category;
    submitBtn.disabled = !draftMarker;
  });
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
  cancelReportFlow();
}

reportBtn.addEventListener('click', startReportFlow);
cancelBtn.addEventListener('click', cancelReportFlow);
submitBtn.addEventListener('click', submitReport);

loadExistingReports();
subscribeToReportChanges();
initNavigation(map, () => reportsStore, cancelReportFlow);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
