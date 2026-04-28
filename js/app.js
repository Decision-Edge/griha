/**
 * GRIHA APP ORCHESTRATOR
 * ======================
 * Ties together all modules and drives the UI.
 * This file handles state management and user interactions.
 *
 * MODULE DEPENDENCIES (all independently replaceable):
 *   — AIAnalyzer      → js/ai-analyzer.js
 *   — VastuEngine     → js/vastu-engine.js
 *   — PaletteEngine   → js/palette-engine.js
 *   — ProductCatalog  → js/product-catalog.js
 *
 * DATA DEPENDENCIES:
 *   — data/vastu-rules.json
 *   — data/palettes.json
 *
 * TO IMPROVE:
 *   — Add user accounts: replace STATE.rooms with a Supabase-backed store
 *   — Add PDF report export: add a generateReport() function
 *   — Add room comparison: track multiple analyses in STATE.history
 */

import { AIAnalyzer }    from './ai-analyzer.js';
import { VastuEngine }   from './vastu-engine.js';
import { PaletteEngine } from './palette-engine.js';
import { ProductCatalog } from './product-catalog.js';

// ─── STATE ────────────────────────────────────────────────────────────────────
const STATE = {
  rooms:        [],          // Array of { label, file, analysis, vastu, palettes, products }
  activeRoom:   null,        // Currently displayed room index
  masterplan:   null,        // Parsed masterplan data
  chatHistory:  [],          // Conversation history for /suggest-changes
  modules: {
    ai:       null,
    vastu:    null,
    palettes: null,
    catalog:  null
  }
};

// ─── INITIALISE ───────────────────────────────────────────────────────────────

async function init() {
  try {
    // Load data files
    const [vastuData, paletteData] = await Promise.all([
      fetch('../data/vastu-rules.json').then(r => r.json()),
      fetch('../data/palettes.json').then(r => r.json())
    ]);

    // Instantiate modules
    STATE.modules.ai       = new AIAnalyzer();
    STATE.modules.vastu    = new VastuEngine(vastuData);
    STATE.modules.palettes = new PaletteEngine(paletteData);
    STATE.modules.catalog  = new ProductCatalog();

    setupEventListeners();
    console.log('Griha modules initialised ✓');
  } catch (err) {
    console.error('Init failed:', err);
    showGlobalError('Failed to load Griha. Please refresh the page.');
  }
}

// ─── ANALYSIS PIPELINE ────────────────────────────────────────────────────────

/**
 * Core pipeline: file → AI → Vastu → Products + Palettes → UI
 * Each step is independent — if one fails, it degrades gracefully.
 */
async function analyzeRoom(file, roomLabel, roomIndex) {
  const room = STATE.rooms[roomIndex];

  // Step 1: AI image analysis
  setRoomStatus(roomIndex, 'analysing', 'Analysing your photo with AI...');
  const aiResult = await STATE.modules.ai.analyzeRoom(file, roomLabel);

  if (!aiResult.ok) {
    setRoomStatus(roomIndex, 'error', aiResult.error);
    return;
  }

  room.analysis = aiResult;

  // Step 2: Vastu engine — uses masterplan zone if available
  setRoomStatus(roomIndex, 'analysing', 'Running Vastu analysis...');
  const compass_zone = getMasterplanZone(roomLabel);
  const vastuResult  = STATE.modules.vastu.analyzeRoom({
    room_type:       normaliseRoomType(roomLabel),
    compass_zone:    compass_zone,
    ai_observations: aiResult.observations || {},
  });
  room.vastu = vastuResult;

  // Step 3: Palette recommendations
  setRoomStatus(roomIndex, 'analysing', 'Selecting colour palettes...');
  const palettes = STATE.modules.palettes.recommend({
    zone:        compass_zone,
    room_type:   normaliseRoomType(roomLabel),
    style_tags:  aiResult.observations?.style_detected || [],
    max_results: 3
  });
  room.palettes = palettes;

  // Step 4: Product recommendations
  setRoomStatus(roomIndex, 'analysing', 'Finding products for your space...');
  const products = await STATE.modules.catalog.getRecommendations({
    room_type:   normaliseRoomType(roomLabel),
    vastu_zone:  compass_zone,
    style_tags:  aiResult.observations?.style_detected || [],
    max_results: 6
  });
  room.products = products;

  // Step 5: Update UI
  room.status = 'done';
  renderRoomResults(roomIndex);
  setRoomStatus(roomIndex, 'done', '');
}

/**
 * Conversational refinement — handles "make it cheaper", "more traditional" etc.
 */
async function handleUserRequest(userMessage) {
  if (!userMessage.trim()) return;

  const activeRoom = STATE.rooms[STATE.activeRoom];
  appendChatMessage('user', userMessage);

  const input = document.getElementById('chatInput');
  if (input) input.value = '';

  appendChatMessage('assistant', '...', true); // loading

  const body = {
    userMessage,
    currentAnalysis: activeRoom ? {
      vastu:    activeRoom.vastu,
      analysis: activeRoom.analysis,
      products: activeRoom.products?.slice(0,3)
    } : null,
    conversationHistory: STATE.chatHistory
  };

  try {
    const workerUrl = STATE.modules.ai.workerUrl;
    const res = await fetch(`${workerUrl}/suggest-changes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    const data = await res.json();
    const reply = data.reply || 'I could not generate a response. Please try again.';

    // Update loading message
    updateLastChatMessage(reply);

    STATE.chatHistory.push(
      { role: 'user',      content: userMessage },
      { role: 'assistant', content: reply }
    );

    // Keep conversation history bounded (last 10 turns)
    if (STATE.chatHistory.length > 20) STATE.chatHistory = STATE.chatHistory.slice(-20);

  } catch (err) {
    updateLastChatMessage('Could not reach the AI. Please check your connection and try again.');
  }
}

// ─── MASTERPLAN ───────────────────────────────────────────────────────────────

async function processMasterplan(file) {
  showMasterplanStatus('Analysing your masterplan...');
  const result = await STATE.modules.ai.analyzeMasterplan(file);

  if (!result.ok) {
    showMasterplanStatus(result.error, 'error');
    return;
  }

  STATE.masterplan = result;
  showMasterplanStatus(`✓ ${result.building?.bhk_type || 'Home'} · ${result.building?.total_sqft || '?'} sqft · ${result.rooms?.length || 0} rooms detected`, 'success');
  renderMasterplanRooms(result);
}

function getMasterplanZone(roomLabel) {
  if (!STATE.masterplan?.rooms) return 'unknown';
  const normalised = roomLabel.toLowerCase();
  const match = STATE.masterplan.rooms.find(r =>
    r.name.toLowerCase().includes(normalised.split(' ')[0])
  );
  return match?.compass_zone || 'unknown';
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────

function setupEventListeners() {
  // Masterplan upload
  const masterplanInput = document.getElementById('masterplanInput');
  if (masterplanInput) {
    masterplanInput.addEventListener('change', e => {
      if (e.target.files[0]) processMasterplan(e.target.files[0]);
    });
  }

  // Room upload
  const roomInput = document.getElementById('roomInput');
  if (roomInput) {
    roomInput.addEventListener('change', e => {
      Array.from(e.target.files).forEach(file => addRoom(file));
    });
  }

  // Drag and drop
  const dropZone = document.getElementById('dropZone');
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      Array.from(e.dataTransfer.files).forEach(f => {
        if (f.type.startsWith('image/')) addRoom(f);
      });
    });
  }

  // Chat input
  const chatInput = document.getElementById('chatInput');
  const chatSend  = document.getElementById('chatSend');
  if (chatInput && chatSend) {
    chatSend.addEventListener('click', () => handleUserRequest(chatInput.value));
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleUserRequest(chatInput.value);
      }
    });
  }
}

function addRoom(file) {
  const label   = promptRoomLabel();
  const index   = STATE.rooms.length;
  const preview = URL.createObjectURL(file);

  STATE.rooms.push({ label, file, preview, status: 'pending', analysis: null, vastu: null, palettes: [], products: [] });
  renderRoomTab(index);
  selectRoom(index);
  analyzeRoom(file, label, index);
}

function promptRoomLabel() {
  const options = ['Master bedroom', 'Living room', 'Kitchen', 'Washroom', 'Balcony', 'Pooja room', 'Kids bedroom', 'Guest bedroom', 'Study', 'Dining room'];
  // In the real app this is a dropdown — for now return the most common
  // The app.html UI handles this with a proper select element
  return window._selectedRoomLabel || 'Living room';
}

function selectRoom(index) {
  STATE.activeRoom = index;
  document.querySelectorAll('.room-tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === index);
  });
  const room = STATE.rooms[index];
  if (room?.status === 'done') {
    renderRoomResults(index);
  }
}

// ─── RENDER FUNCTIONS ─────────────────────────────────────────────────────────

function renderRoomTab(index) {
  const room   = STATE.rooms[index];
  const tabs   = document.getElementById('roomTabs');
  if (!tabs) return;

  const tab = document.createElement('div');
  tab.className = 'room-tab';
  tab.innerHTML = `
    <img src="${room.preview}" alt="${room.label}">
    <span>${room.label}</span>
    <div class="room-tab-status pending"></div>
  `;
  tab.addEventListener('click', () => selectRoom(index));
  tabs.appendChild(tab);
}

function renderRoomResults(index) {
  const room    = STATE.rooms[index];
  const results = document.getElementById('resultsPanel');
  if (!results || !room) return;

  const vastu = room.vastu;
  const obs   = room.analysis?.observations || {};

  results.innerHTML = `
    <div class="results-header">
      <div class="results-room-info">
        <h2>${room.label}</h2>
        <div class="results-meta">
          ${obs.estimated_sqft ? `${obs.estimated_sqft} sqft · ` : ''}
          ${obs.light_direction ? `${obs.light_direction.charAt(0).toUpperCase() + obs.light_direction.slice(1)}-facing · ` : ''}
          ${STATE.masterplan ? `Zone: ${getMasterplanZone(room.label)}` : 'Upload masterplan for zone analysis'}
        </div>
      </div>
      <div class="vastu-score" style="--score-colour:${vastu?.grade?.colour || '#888'}">
        <div class="score-num">${vastu?.score ?? '--'}</div>
        <div class="score-label">${vastu?.grade?.label || 'Vastu score'}</div>
      </div>
    </div>

    <!-- Insights strip -->
    <div class="insights-strip">
      ${renderInsightCard('Light', obs.light_direction || 'Unknown', obs.light_quality || '')}
      ${renderInsightCard('Electrical', obs.electrical_points_visible != null ? `${obs.electrical_points_visible} points` : 'Unknown', (obs.electrical_point_positions || []).join(', '))}
      ${renderInsightCard('Ceiling', obs.ceiling_height || 'Unknown', obs.overhead_beams_detected ? '⚠ Beam detected' : 'No beams')}
      ${renderInsightCard('Style', (obs.style_detected || ['Unknown'])[0], obs.flooring_type ? `${obs.flooring_type} floor` : '')}
    </div>

    <!-- Vastu rules -->
    <div class="section-block">
      <div class="section-block-title">Vastu compliance</div>
      ${renderVastuRules(vastu)}
    </div>

    <!-- Recommendations if any -->
    ${vastu?.recommendations?.length ? `
      <div class="section-block">
        <div class="section-block-title">Recommendations</div>
        <div class="recommendations-list">
          ${vastu.recommendations.map(r => `
            <div class="rec-item rec-${r.priority}">
              <div class="rec-dot"></div>
              <div>
                <div class="rec-text">${r.text}</div>
                <div class="rec-source">${r.source}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <!-- Products -->
    <div class="section-block">
      <div class="section-block-title">Recommended products</div>
      <div class="products-grid">
        ${(room.products || []).map(renderProductCard).join('')}
      </div>
    </div>

    <!-- Palettes -->
    <div class="section-block">
      <div class="section-block-title">Colour palettes</div>
      <div class="palettes-row">
        ${(room.palettes || []).map(renderPaletteCard).join('')}
      </div>
    </div>
  `;
}

function renderInsightCard(label, value, sub) {
  return `<div class="insight-card">
    <div class="insight-label">${label}</div>
    <div class="insight-val">${value}</div>
    ${sub ? `<div class="insight-sub">${sub}</div>` : ''}
  </div>`;
}

function renderVastuRules(vastu) {
  if (!vastu) return '<div class="vastu-empty">No Vastu data available.</div>';

  const groups = [
    { rules: vastu.violated_rules,  icon: '✗', cls: 'violated' },
    { rules: vastu.warning_rules,   icon: '!', cls: 'warning' },
    { rules: vastu.compliant_rules, icon: '✓', cls: 'compliant' },
  ];

  return groups.map(g =>
    (g.rules || []).map(r => `
      <div class="vastu-rule vastu-${g.cls}">
        <div class="vastu-rule-icon">${g.icon}</div>
        <div>
          <div class="vastu-rule-title">${r.title}</div>
          <div class="vastu-rule-desc">${r.message || r.user_explanation}</div>
          <div class="vastu-rule-source">${r.source}</div>
        </div>
      </div>
    `).join('')
  ).join('');
}

function renderProductCard(product) {
  return `
    <div class="product-card">
      <div class="product-emoji">${product.emoji || '🛋'}</div>
      <div class="product-platform product-platform-${(product.platform || '').toLowerCase().replace(/\s/g,'-')}">${product.platform}</div>
      <div class="product-info">
        <div class="product-name">${product.name}</div>
        <div class="product-brand">${product.brand}</div>
        ${product.vastu_note ? `<div class="product-vastu">✓ ${product.vastu_note.slice(0, 80)}...</div>` : ''}
        <div class="product-footer">
          <div class="product-price">₹${(product.price_inr || 0).toLocaleString('en-IN')}</div>
          ${product.affiliate_url ? `<a href="${product.affiliate_url}" target="_blank" rel="noopener" class="product-buy">Shop →</a>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderPaletteCard(palette) {
  const swatchHTML = (palette.swatches || []).map(s =>
    `<div class="swatch" style="background:${s.hex}" title="${s.name}"></div>`
  ).join('');

  return `
    <div class="palette-card">
      <div class="palette-swatches">${swatchHTML}</div>
      <div class="palette-meta">
        <div class="palette-name">${palette.name}</div>
        <div class="palette-vastu">${palette.vastu_rationale?.slice(0, 80)}...</div>
        <div class="palette-vendors">
          ${(palette.vendors || []).map(v =>
            `<a href="${v.url}" target="_blank" rel="noopener" class="palette-vendor-link">${v.name}</a>`
          ).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderMasterplanRooms(data) {
  const el = document.getElementById('masterplanRooms');
  if (!el) return;
  el.innerHTML = (data.rooms || []).map(r =>
    `<div class="mp-room-chip">
      <span class="mp-room-name">${r.name}</span>
      <span class="mp-room-zone">${r.compass_zone || '?'}</span>
    </div>`
  ).join('');
}

// ─── CHAT ─────────────────────────────────────────────────────────────────────

function appendChatMessage(role, text, isLoading = false) {
  const chat = document.getElementById('chatMessages');
  if (!chat) return;
  const msg = document.createElement('div');
  msg.className = `chat-msg chat-${role} ${isLoading ? 'loading' : ''}`;
  msg.textContent = text;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

function updateLastChatMessage(text) {
  const chat = document.getElementById('chatMessages');
  if (!chat) return;
  const last = chat.querySelector('.chat-msg.loading');
  if (last) { last.textContent = text; last.classList.remove('loading'); }
}

// ─── STATUS HELPERS ────────────────────────────────────────────────────────────

function setRoomStatus(index, status, message) {
  const tab = document.querySelectorAll('.room-tab')[index];
  if (tab) {
    const dot = tab.querySelector('.room-tab-status');
    if (dot) { dot.className = `room-tab-status ${status}`; }
  }
  const statusEl = document.getElementById('analysisStatus');
  if (statusEl && STATE.activeRoom === index) {
    statusEl.textContent = message;
    statusEl.style.display = message ? 'block' : 'none';
  }
}

function showMasterplanStatus(message, type = 'info') {
  const el = document.getElementById('masterplanStatus');
  if (el) { el.textContent = message; el.className = `masterplan-status ${type}`; }
}

function showGlobalError(message) {
  const el = document.getElementById('globalError');
  if (el) { el.textContent = message; el.style.display = 'block'; }
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function normaliseRoomType(label) {
  const map = {
    'master bedroom':    'master_bedroom',
    'bedroom':           'bedroom',
    'living room':       'living_room',
    'drawing room':      'drawing_room',
    'kitchen':           'kitchen',
    'washroom':          'washroom',
    'bathroom':          'bathroom',
    'balcony':           'balcony',
    'pooja room':        'pooja_room',
    'kids bedroom':      'kids_bedroom',
    'guest bedroom':     'guest_bedroom',
    'study':             'study',
    'dining room':       'dining_room',
  };
  return map[label.toLowerCase()] || label.toLowerCase().replace(/\s+/g, '_');
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

// Expose selectRoom for inline HTML handlers
window.selectRoom = selectRoom;
window.setSelectedRoomLabel = label => { window._selectedRoomLabel = label; };
