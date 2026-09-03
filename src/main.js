import L from 'leaflet';
import './style.css';
import { supabase } from './supabaseClient.js';
import { CATEGORIES } from './categories.js';

const BELFAST_CENTRE = [54.5973, -5.9301];

const map = L.map('map').setView(BELFAST_CENTRE, 16);

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
  const photo = report.photo_url ? `<br><img src="${report.photo_url}" style="max-width:200px" />` : '';
  marker.bindPopup(`<strong>${label}</strong><br>${when}${photo}`);
}

async function loadExistingReports() {
  const { data, error } = await supabase.from('reports').select('*').order('created_at');
  if (error) {
    console.error('Failed to load reports', error);
    return;
  }
  data.forEach(addPinToMap);
}

function subscribeToNewReports() {
  supabase
    .channel('reports-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'reports' },
      (payload) => addPinToMap(payload.new)
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

  const { error } = await supabase
    .from('reports')
    .insert({ lat, lng, category: selectedCategory, photo_url });

  if (error) {
    console.error('Failed to submit report', error);
    submitBtn.disabled = false;
    return;
  }

  cancelReportFlow();
}

reportBtn.addEventListener('click', startReportFlow);
cancelBtn.addEventListener('click', cancelReportFlow);
submitBtn.addEventListener('click', submitReport);

loadExistingReports();
subscribeToNewReports();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
