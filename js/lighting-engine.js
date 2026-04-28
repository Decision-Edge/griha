/**
 * GRIHA LIGHTING ENGINE
 * =====================
 * Generates a specific lighting plan per room based on:
 *   — Room type and sqft (drives lumen requirements)
 *   — Vastu zone (drives placement and warm/cool preference)
 *   — Design style (drives fixture aesthetic)
 *   — Detected electrical points (from AI room analysis)
 *
 * TO IMPROVE:
 *   — Add more fixture types to FIXTURE_CATALOGUE below
 *   — Add electrical point position logic (when AI detects specific positions)
 *   — Connect to a lighting product API for live stock/price
 */

// ─── Lux requirements by room type ───────────────────────────────────────────
// Based on Bureau of Indian Standards SP 72 / NBC 2016
const LUX_REQUIREMENTS = {
  master_bedroom:  { ambient: 100, task: 300, accent: 50  },
  bedroom:         { ambient: 100, task: 300, accent: 50  },
  living_room:     { ambient: 150, task: 300, accent: 75  },
  drawing_room:    { ambient: 150, task: 300, accent: 75  },
  kitchen:         { ambient: 200, task: 500, accent: 0   },
  dining_room:     { ambient: 150, task: 250, accent: 75  },
  study:           { ambient: 150, task: 500, accent: 50  },
  washroom:        { ambient: 100, task: 300, accent: 0   },
  bathroom:        { ambient: 100, task: 300, accent: 0   },
  balcony:         { ambient: 50,  task: 0,   accent: 30  },
  pooja_room:      { ambient: 150, task: 0,   accent: 200 },  // high accent for the deity area
  kids_bedroom:    { ambient: 150, task: 400, accent: 50  },
  default:         { ambient: 150, task: 300, accent: 50  }
};

// ─── Vastu zone lighting preferences ─────────────────────────────────────────
const ZONE_LIGHTING = {
  NE: { colour_temp: '4000K cool white', note: 'NE (Ishanya) benefits from bright, clear light — use cool white to amplify the clarity of this zone' },
  N:  { colour_temp: '3500K neutral',    note: 'N zone (Kubera) should have steady, balanced light' },
  E:  { colour_temp: '4000K cool white', note: 'E zone (Indra) receives morning sun — complement with cool white to match natural light' },
  SE: { colour_temp: '2700K warm white', note: 'SE (Agni) fire zone — warm-toned light amplifies the fire element energy' },
  S:  { colour_temp: '2700K warm white', note: 'S zone (Yama) — warm, grounding light reinforces stability' },
  SW: { colour_temp: '2700K warm white', note: 'SW (Nairutya) earth zone — warm amber light is most harmonious' },
  W:  { colour_temp: '3000K warm white', note: 'W zone (Varuna) — soft warm light supports introspection and rest' },
  NW: { colour_temp: '3500K neutral',    note: 'NW (Vayu) air zone — neutral light supports movement and social activity' }
};

// ─── Fixture catalogue ────────────────────────────────────────────────────────
// Extend this list as you add lighting products to Airtable
const FIXTURE_CATALOGUE = {
  // Ambient
  recessed_led:     { name: 'Recessed LED Downlight (9W)',       use: 'ambient', sqft_per_fixture: 40, product_id: 'LT-001', cost_estimate: 800 },
  ceiling_batten:   { name: 'LED Batten Light (22W)',            use: 'ambient', sqft_per_fixture: 60, product_id: 'LT-002', cost_estimate: 650 },
  flush_mount:      { name: 'Flush Mount Ceiling Light (24W)',   use: 'ambient', sqft_per_fixture: 80, product_id: 'LT-003', cost_estimate: 2200 },

  // Task
  bedside_lamp:     { name: 'Bedside Table Lamp (E27)',          use: 'task',    rooms: ['master_bedroom','bedroom'], product_id: 'LT-004', cost_estimate: 1800, qty: 2 },
  study_lamp:       { name: 'Architect Desk Lamp (LED)',         use: 'task',    rooms: ['study'],                   product_id: 'LT-005', cost_estimate: 2500, qty: 1 },
  under_cabinet:    { name: 'Under-Cabinet LED Strip (5W/m)',    use: 'task',    rooms: ['kitchen'],                 product_id: 'LT-006', cost_estimate: 450, unit: 'per metre' },

  // Feature / pendant
  pendant_brass:    { name: 'Brass Pendant Light (E27)',         use: 'feature', style: ['contemporary_indian','traditional_heritage'], product_id: 'LT-007', cost_estimate: 3500 },
  pendant_rattan:   { name: 'Rattan Woven Pendant Light',        use: 'feature', style: ['boho_chic'],             product_id: 'LT-008', cost_estimate: 2800 },
  pendant_minimal:  { name: 'Slim Stem Pendant (Black, E27)',    use: 'feature', style: ['minimalist_modern'],     product_id: 'LT-009', cost_estimate: 2200 },
  chandelier:       { name: 'Antique Brass Chandelier (5-arm)',  use: 'feature', style: ['traditional_heritage'],  product_id: 'LT-010', cost_estimate: 12000 },

  // Accent
  floor_lamp_brass: { name: 'Tripod Floor Lamp, Brass (E27)',   use: 'accent',  style: ['contemporary_indian'],   product_id: 'LT-011', cost_estimate: 4500 },
  floor_lamp_rattan:{ name: 'Arc Floor Lamp, Rattan',           use: 'accent',  style: ['boho_chic'],             product_id: 'LT-012', cost_estimate: 3200 },
  wall_sconce:      { name: 'Brass Wall Sconce (G9)',            use: 'accent',  product_id: 'LT-013', cost_estimate: 2800, qty: 2 },
  led_strip:        { name: 'RGB LED Strip (under bed/sofa)',    use: 'accent',  product_id: 'LT-014', cost_estimate: 600,  unit: 'per 5m roll' },
  pooja_diya:       { name: 'Electric Diya LED Light (set of 2)',use: 'accent',  rooms: ['pooja_room'],            product_id: 'LT-015', cost_estimate: 550 }
};

export class LightingEngine {

  /**
   * Generate a complete lighting plan for a room.
   *
   * @param {object} params
   * @param {string} params.room_type
   * @param {number} params.sqft
   * @param {string} params.compass_zone
   * @param {string} params.design_style_id
   * @param {number} params.electrical_points  - from AI analysis
   * @param {string} params.ceiling_height     - 'low' | 'standard' | 'high'
   * @returns {LightingPlan}
   */
  plan({ room_type, sqft = 150, compass_zone = 'unknown', design_style_id, electrical_points = 2, ceiling_height = 'standard' }) {
    const lux          = LUX_REQUIREMENTS[room_type] || LUX_REQUIREMENTS.default;
    const zone_pref    = ZONE_LIGHTING[compass_zone] || { colour_temp: '3000K warm white', note: '' };
    const total_lumens = this._calculateLumens(sqft, lux);
    const fixtures     = this._selectFixtures(room_type, sqft, design_style_id, ceiling_height);
    const zones        = this._buildLightingZones(room_type, fixtures, zone_pref, sqft);
    const cost         = this._estimateCost(fixtures);
    const vastu_notes  = this._vastuLightingNotes(room_type, compass_zone);

    return {
      summary: {
        room_type,
        sqft,
        zone: compass_zone,
        colour_temp: zone_pref.colour_temp,
        total_lumens_required: total_lumens,
        electrical_points_available: electrical_points,
        electrical_points_needed: fixtures.filter(f => f.needs_point).length
      },
      zones,
      fixtures,
      vastu_notes,
      cost_estimate: cost
    };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _calculateLumens(sqft, lux) {
    // Simple lux × area calculation with a utilisation factor of 0.7
    const sqm = sqft * 0.0929;
    return Math.round((lux.ambient * sqm) / 0.7);
  }

  _selectFixtures(room_type, sqft, style_id, ceiling_height) {
    const selected = [];

    // Ambient layer — always needed
    if (ceiling_height === 'high') {
      // High ceilings: pendants + downlights
      const count = Math.max(2, Math.round(sqft / 50));
      selected.push({ ...FIXTURE_CATALOGUE.recessed_led, qty: count, needs_point: true });
    } else {
      // Standard/low: downlights or flush mount
      const count = Math.max(2, Math.round(sqft / 40));
      selected.push({ ...FIXTURE_CATALOGUE.recessed_led, qty: count, needs_point: false, note: 'Wire into existing ceiling rose' });
    }

    // Feature pendant — room-specific
    if (['living_room','drawing_room','dining_room'].includes(room_type)) {
      const pendant = style_id === 'traditional_heritage' ? FIXTURE_CATALOGUE.chandelier :
                      style_id === 'boho_chic'            ? FIXTURE_CATALOGUE.pendant_rattan :
                      style_id === 'minimalist_modern'     ? FIXTURE_CATALOGUE.pendant_minimal :
                                                             FIXTURE_CATALOGUE.pendant_brass;
      selected.push({ ...pendant, qty: 1, needs_point: true });
    }

    // Bedside lamps for bedrooms
    if (['master_bedroom','bedroom','guest_bedroom','kids_bedroom'].includes(room_type)) {
      selected.push({ ...FIXTURE_CATALOGUE.bedside_lamp, qty: 2, needs_point: false });
    }

    // Study lamp
    if (room_type === 'study') {
      selected.push({ ...FIXTURE_CATALOGUE.study_lamp, qty: 1, needs_point: false });
    }

    // Under-cabinet for kitchen
    if (room_type === 'kitchen') {
      selected.push({ ...FIXTURE_CATALOGUE.under_cabinet, qty: 1, unit: 'per metre', qty_metres: 3, needs_point: false });
    }

    // Accent floor lamp
    if (['living_room','master_bedroom'].includes(room_type)) {
      const floor = style_id === 'boho_chic' ? FIXTURE_CATALOGUE.floor_lamp_rattan : FIXTURE_CATALOGUE.floor_lamp_brass;
      selected.push({ ...floor, qty: 1, needs_point: false });
    }

    // Accent LED strip under bed/sofa
    if (['master_bedroom','living_room'].includes(room_type)) {
      selected.push({ ...FIXTURE_CATALOGUE.led_strip, qty: 1, needs_point: false });
    }

    // Pooja room diyas
    if (room_type === 'pooja_room') {
      selected.push({ ...FIXTURE_CATALOGUE.pooja_diya, qty: 1, needs_point: false });
    }

    return selected;
  }

  _buildLightingZones(room_type, fixtures, zone_pref, sqft) {
    return [
      {
        zone: 'Ambient (general)',
        colour_temp: zone_pref.colour_temp,
        description: 'Even base illumination across the whole room',
        fixtures: fixtures.filter(f => f.use === 'ambient')
      },
      {
        zone: 'Task (activity-specific)',
        colour_temp: '4000K cool white',
        description: 'Focused light for reading, cooking, or working',
        fixtures: fixtures.filter(f => f.use === 'task')
      },
      {
        zone: 'Feature / focal',
        colour_temp: zone_pref.colour_temp,
        description: 'Statement fixture that defines the room\'s character',
        fixtures: fixtures.filter(f => f.use === 'feature')
      },
      {
        zone: 'Accent / mood',
        colour_temp: '2700K warm white',
        description: 'Low-level atmospheric lighting — under bed, behind TV, floor lamps',
        fixtures: fixtures.filter(f => f.use === 'accent')
      }
    ].filter(z => z.fixtures.length > 0);
  }

  _estimateCost(fixtures) {
    const product_cost = fixtures.reduce((sum, f) => sum + (f.cost_estimate * (f.qty || 1)), 0);
    const installation  = Math.round(product_cost * 0.25 / 100) * 100; // ~25% of product cost
    return {
      products:     product_cost,
      installation: installation,
      total:        product_cost + installation
    };
  }

  _vastuLightingNotes(room_type, zone) {
    const notes = [];
    const zoneInfo = ZONE_LIGHTING[zone];
    if (zoneInfo) notes.push(zoneInfo.note);

    if (room_type === 'master_bedroom') {
      notes.push('Avoid harsh overhead lighting directly above the bed — bedside lamps are preferred per Vastu sleep principles');
      notes.push('Place floor lamp in the SE corner — Agni zone lighting supports the relationship between fire and earth elements');
    }
    if (room_type === 'kitchen') {
      notes.push('Ensure under-cabinet lighting over the cooking area — the cook facing east should have their work surface well lit from above, not casting shadows');
    }
    if (room_type === 'pooja_room') {
      notes.push('Warm devotional lighting (diyas, warm-white LEDs) in the NE corner amplifies the Ishanya zone\'s sacred energy');
      notes.push('Never use blue or cool-white light in the pooja room — warm amber tones are prescribed by classical Vastu texts');
    }
    if (room_type === 'living_room') {
      notes.push('Feature pendant should hang in the centre or slightly west of centre — never in the NE corner which must remain unobstructed');
    }
    return notes;
  }
}
