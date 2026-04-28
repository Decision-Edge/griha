/**
 * GRIHA CARPENTER SPECIFICATION GENERATOR
 * ========================================
 * Generates a printable Bill of Quantities (BOQ) for custom carpentry
 * that a user can hand directly to a local carpenter.
 *
 * Produces: HTML that renders as a professional spec sheet and can be
 * saved as PDF via browser print → Save as PDF.
 *
 * TO IMPROVE:
 *   — Add more furniture types to FURNITURE_SPECS below
 *   — Add regional material cost adjustments (Mumbai vs Bengaluru vs Delhi)
 *   — Connect to a lumber price API for live material costs
 *   — Generate actual CAD drawings via a 3D library (long-term enhancement)
 */

// ─── Standard furniture spec templates ────────────────────────────────────────
// Dimensions scale with room sqft — a larger room gets proportionally larger pieces
const FURNITURE_SPECS = {
  wardrobe: {
    name: 'Sliding Door Wardrobe',
    description: 'Full-height wardrobe with sliding doors, internal fittings, and integrated lighting',
    default_dims: { w: 2400, d: 600, h: 2400 }, // mm
    min_wall_clearance: 200, // mm on each side
    sections: [
      { name: 'Carcass', material: null /* filled from style */, thickness: '18mm', note: 'Full back panel, floor, ceiling, side panels, and mid-shelf' },
      { name: 'Shelves', material: 'BWR Plywood', thickness: '12mm', note: '4× adjustable shelves per bay, on 32mm system shelf pins' },
      { name: 'Hanging rail', material: 'Aluminium 19mm dia', quantity: '1 per bay', note: 'Full-width, chrome or powder-coated finish' },
      { name: 'Shutters', material: null, thickness: '18mm', note: '2-door sliding system on aluminium track' },
    ],
    hardware: [
      { item: 'Sliding door track system (top + bottom)', brand_suggestion: 'Hettich Dynasoft / Hafele', qty: '1 set per pair of doors' },
      { item: 'Soft-close door damper', brand_suggestion: 'Hettich', qty: '1 per door' },
      { item: 'Handles (as per style)', brand_suggestion: 'Refer style spec', qty: '2 per shutter' },
      { item: 'Adjustable shelf pins', brand_suggestion: 'Any', qty: '16 per bay (4 shelves × 4 pins)' },
      { item: 'Mirror (optional, inside door)', brand_suggestion: '4mm float glass', qty: '1' },
    ],
    base_material_cost: { low: 18000, high: 28000 },
    labour_cost:        { low: 7000,  high: 10000 }
  },

  tv_unit: {
    name: 'Wall-Mounted TV Unit',
    description: 'Floating TV unit with open shelves, closed storage, and cable management',
    default_dims: { w: 2000, d: 400, h: 600 }, // mm — wall-mounted at 400mm height
    sections: [
      { name: 'Main carcass', material: null, thickness: '18mm', note: 'Wall-mounted with concealed brackets, floating appearance' },
      { name: 'Open shelves', material: null, thickness: '18mm', note: '2× open display shelves — 300mm height each' },
      { name: 'Closed storage', material: null, thickness: '18mm', note: '2× hinged shutter compartments with soft-close hinges' },
      { name: 'Back panel', material: 'Ribbed MDF / Cane webbing', thickness: '6mm', note: 'Decorative back — colour as per style' },
    ],
    hardware: [
      { item: 'Concealed wall brackets', brand_suggestion: 'Steel, 200mm depth', qty: '4 nos' },
      { item: 'Soft-close hinges', brand_suggestion: 'Hettich 165°', qty: '4 pairs' },
      { item: 'Handles', brand_suggestion: 'Refer style spec', qty: '4 nos' },
      { item: 'Cable management channel', brand_suggestion: 'Any', qty: '1 set' },
    ],
    base_material_cost: { low: 12000, high: 20000 },
    labour_cost:        { low: 5000,  high: 8000 }
  },

  bed_with_storage: {
    name: 'Queen Bed Frame with Hydraulic Storage',
    description: 'Platform bed with hydraulic lift-up storage, upholstered headboard, and side tables',
    default_dims: { w: 1680, d: 2000, h: 1200 }, // mm (Queen: 1520×2030mm mattress)
    sections: [
      { name: 'Platform base box', material: null, thickness: '18mm', note: 'Full perimeter box with hydraulic mechanism for lift storage' },
      { name: 'Headboard', material: 'MDF + foam + fabric', thickness: '75mm upholstered', note: 'Tufted or plain upholstered headboard — fabric as per style' },
      { name: 'Side tables', material: null, thickness: '18mm', note: '2× floating bedside tables, 500×400mm, with single drawer' },
      { name: 'Slat base', material: 'Sprung wood slats', thickness: '8mm', note: 'For mattress support — included or use solid platform' },
    ],
    hardware: [
      { item: 'Hydraulic gas lift mechanism', brand_suggestion: 'Hettich / Hafele 250N', qty: '2 nos (one each side)' },
      { item: 'Soft-close hinges (side tables)', brand_suggestion: 'Hettich', qty: '2 pairs' },
      { item: 'Bed leg levellers', brand_suggestion: 'Any', qty: '6 nos' },
      { item: 'Fabric for headboard', brand_suggestion: 'Refer style — linen / velvet / cotton', qty: '2.5 metres' },
    ],
    base_material_cost: { low: 22000, high: 38000 },
    labour_cost:        { low: 9000,  high: 14000 }
  },

  kitchen_cabinets: {
    name: 'Modular Kitchen (L-shape / Straight)',
    description: 'Base cabinets, wall cabinets, and loft units with stone countertop',
    default_dims: { linear_feet: 10 }, // priced per linear foot
    sections: [
      { name: 'Base cabinets', material: null, thickness: '18mm', note: 'Full base unit with drawer banks and hinged shutters, on adjustable legs' },
      { name: 'Wall cabinets', material: null, thickness: '18mm', note: 'Upper cabinets — 300mm depth, lift-up or hinged shutters' },
      { name: 'Loft unit (optional)', material: null, thickness: '18mm', note: 'Top storage above wall cabinets — access via step' },
      { name: 'Countertop', material: 'Quartz stone (20mm) or Granite', thickness: '20mm', note: 'Prefer Quartz (Kajaria / Surfaces) for durability and hygiene' },
      { name: 'Back splash', material: 'Ceramic tile or PU paint', thickness: '8mm tile', note: 'Easy-clean surface behind cooking area' },
    ],
    hardware: [
      { item: 'Soft-close drawer channels', brand_suggestion: 'Hettich Quadro / Hafele Matrix', qty: '1 set per drawer' },
      { item: 'Soft-close hinges', brand_suggestion: 'Hettich 110°', qty: '2 pairs per shutter' },
      { item: 'Handles', brand_suggestion: 'Refer style spec', qty: '1 per shutter / drawer' },
      { item: 'Sink mounting clip', brand_suggestion: 'Any', qty: '1 set' },
      { item: 'Adjustable legs (base cabinets)', brand_suggestion: 'Any 100-150mm', qty: '6 per linear metre' },
    ],
    base_material_cost: { low: 75000, high: 150000 }, // full kitchen
    labour_cost:        { low: 25000, high: 45000 }
  },

  study_unit: {
    name: 'Study Desk with Overhead Shelving',
    description: 'Wall-fixed study desk with hutch shelving, cable management, and task lighting provision',
    default_dims: { w: 1400, d: 550, h: 750 }, // desk dims; shelving above
    sections: [
      { name: 'Desk surface', material: null, thickness: '25mm', note: 'Solid surface desk on 18mm modesty panel base' },
      { name: 'Hutch shelves', material: null, thickness: '18mm', note: '3× fixed shelves above desk, 300mm height, 300mm depth' },
      { name: 'Drawer pedestal', material: null, thickness: '18mm', note: '3-drawer pedestal on castors (A4 size × 2 + shallow top drawer)' },
      { name: 'Back panel (hutch)', material: 'Pin-board / Chalkboard paint', thickness: '6mm', note: 'Functional back panel for notes and pinning' },
    ],
    hardware: [
      { item: 'Drawer channels', brand_suggestion: 'Hettich', qty: '3 pairs' },
      { item: 'Soft-close hinges (cupboard)', brand_suggestion: 'Hettich', qty: '2 pairs' },
      { item: 'Castor wheels (pedestal)', brand_suggestion: 'Any 50mm with lock', qty: '4 nos' },
      { item: 'Grommet for cables', brand_suggestion: 'Any 60mm dia', qty: '2 nos' },
    ],
    base_material_cost: { low: 14000, high: 24000 },
    labour_cost:        { low: 6000,  high: 10000 }
  }
};

// ─── CarpenterSpec class ───────────────────────────────────────────────────────

export class CarpenterSpec {

  /**
   * Generate a carpenter spec for selected furniture items.
   *
   * @param {object} params
   * @param {object}   params.design_brief   - from DesignGenerator._buildDesignBrief()
   * @param {string[]} params.furniture_ids  - keys from FURNITURE_SPECS e.g. ['wardrobe','tv_unit']
   * @param {string}   params.room_label     - "Master bedroom"
   * @param {number}   params.room_sqft      - from AI analysis
   * @returns {SpecSheet}
   */
  generate({ design_brief, furniture_ids = ['wardrobe', 'tv_unit'], room_label, room_sqft = 150 }) {
    const items = furniture_ids
      .filter(id => FURNITURE_SPECS[id])
      .map(id => this._buildItem(id, design_brief, room_sqft));

    const total_cost = items.reduce((sum, item) => ({
      low:  sum.low  + item.cost.materials.low  + item.cost.labour.low,
      high: sum.high + item.cost.materials.high + item.cost.labour.high
    }), { low: 0, high: 0 });

    return {
      meta: {
        project:      room_label,
        design_style: design_brief?.style_id || 'Contemporary Indian',
        vastu_zone:   design_brief?.compass_zone || 'unknown',
        room_sqft,
        generated_on: new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
      },
      material_spec: {
        carcass:  design_brief?.carpenter?.carcass_material  || '18mm BWR Grade Plywood',
        shutters: design_brief?.carpenter?.shutter_material  || '18mm MDF with veneer',
        hardware: design_brief?.carpenter?.hardware          || 'Hettich soft-close range',
        finish:   design_brief?.carpenter?.finish            || 'PU satin finish'
      },
      items,
      total_cost,
      notes: [
        'All plywood to be ISI marked. Insist on seeing the ISI stamp on each sheet.',
        'Hardware to be branded (Hettich / Hafele) — do not accept unmarked alternatives.',
        'Request a written quotation from the carpenter before work begins.',
        'Vastu note: place wardrobes on south or west walls only — never in the NE corner.',
        'Request site visit after carcass installation for quality check before shutters are fitted.'
      ]
    };
  }

  /**
   * Generates a printable HTML spec sheet and triggers browser download/print.
   */
  downloadHTML(spec) {
    const html = this._buildHTML(spec);
    const blob  = new Blob([html], { type: 'text/html' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href     = url;
    a.download = `Griha_CarpenterSpec_${spec.meta.project.replace(/\s/g,'_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  _buildItem(id, design_brief, room_sqft) {
    const spec   = FURNITURE_SPECS[id];
    const scale  = Math.max(0.8, Math.min(1.4, room_sqft / 150));
    const dims   = spec.default_dims;

    // Fill in material from design brief
    const sections = spec.sections.map(s => ({
      ...s,
      material: s.material || design_brief?.carpenter?.carcass_material || '18mm BWR Grade Plywood'
    }));

    return {
      id,
      name:        spec.name,
      description: spec.description,
      dimensions:  dims,
      sections,
      hardware:    spec.hardware,
      cost: {
        materials: {
          low:  Math.round(spec.base_material_cost.low  * scale / 1000) * 1000,
          high: Math.round(spec.base_material_cost.high * scale / 1000) * 1000
        },
        labour: {
          low:  Math.round(spec.labour_cost.low  * scale / 1000) * 1000,
          high: Math.round(spec.labour_cost.high * scale / 1000) * 1000
        }
      }
    };
  }

  _buildHTML(spec) {
    const itemsHTML = spec.items.map(item => `
      <div class="item-block">
        <h3>${item.name}</h3>
        <p class="desc">${item.description}</p>

        <div class="dims-row">
          ${item.dimensions.w ? `<div class="dim"><span>Width</span><strong>${item.dimensions.w}mm</strong></div>` : ''}
          ${item.dimensions.d ? `<div class="dim"><span>Depth</span><strong>${item.dimensions.d}mm</strong></div>` : ''}
          ${item.dimensions.h ? `<div class="dim"><span>Height</span><strong>${item.dimensions.h}mm</strong></div>` : ''}
          ${item.dimensions.linear_feet ? `<div class="dim"><span>Linear ft</span><strong>${item.dimensions.linear_feet} ft</strong></div>` : ''}
        </div>

        <table>
          <thead><tr><th>Component</th><th>Material</th><th>Thickness</th><th>Notes</th></tr></thead>
          <tbody>
            ${item.sections.map(s => `<tr><td>${s.name}</td><td>${s.material}</td><td>${s.thickness}</td><td>${s.note}</td></tr>`).join('')}
          </tbody>
        </table>

        <h4>Hardware schedule</h4>
        <table>
          <thead><tr><th>Item</th><th>Brand / Spec</th><th>Quantity</th></tr></thead>
          <tbody>
            ${item.hardware.map(h => `<tr><td>${h.item}</td><td>${h.brand_suggestion}</td><td>${h.qty}</td></tr>`).join('')}
          </tbody>
        </table>

        <div class="cost-row">
          <div class="cost-item"><span>Materials estimate</span><strong>₹${item.cost.materials.low.toLocaleString('en-IN')} – ₹${item.cost.materials.high.toLocaleString('en-IN')}</strong></div>
          <div class="cost-item"><span>Labour estimate</span><strong>₹${item.cost.labour.low.toLocaleString('en-IN')} – ₹${item.cost.labour.high.toLocaleString('en-IN')}</strong></div>
          <div class="cost-item total"><span>Item total</span><strong>₹${(item.cost.materials.low + item.cost.labour.low).toLocaleString('en-IN')} – ₹${(item.cost.materials.high + item.cost.labour.high).toLocaleString('en-IN')}</strong></div>
        </div>
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Griha Carpenter Spec — ${spec.meta.project}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#1A1714;padding:40px;max-width:900px;margin:0 auto;}
  .header{border-bottom:2px solid #C0502A;padding-bottom:20px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:flex-end;}
  .logo{font-size:28px;font-weight:300;color:#1A1714;letter-spacing:-0.02em;}
  .logo em{color:#C0502A;font-style:normal;}
  .meta{text-align:right;font-size:11px;color:#888;}
  .meta strong{display:block;font-size:13px;color:#1A1714;margin-bottom:2px;}
  .material-spec{background:#F6F1EB;border-radius:8px;padding:16px 20px;margin-bottom:24px;display:grid;grid-template-columns:1fr 1fr;gap:8px;}
  .spec-row{display:flex;flex-direction:column;gap:2px;}
  .spec-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#888;}
  .spec-val{font-size:13px;font-weight:500;color:#1A1714;}
  .item-block{border:1px solid #E0D8CF;border-radius:8px;padding:20px;margin-bottom:20px;}
  h3{font-size:16px;font-weight:500;color:#C0502A;margin-bottom:6px;}
  h4{font-size:12px;font-weight:500;margin:14px 0 6px;color:#555;}
  .desc{font-size:12px;color:#666;margin-bottom:14px;}
  .dims-row{display:flex;gap:12px;margin-bottom:14px;}
  .dim{background:#F6F1EB;padding:8px 14px;border-radius:6px;display:flex;flex-direction:column;gap:2px;}
  .dim span{font-size:10px;color:#888;text-transform:uppercase;}
  .dim strong{font-size:14px;font-weight:500;}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px;}
  th{background:#F6F1EB;padding:6px 10px;text-align:left;font-weight:500;font-size:11px;color:#555;border-bottom:1px solid #E0D8CF;}
  td{padding:7px 10px;border-bottom:1px solid #F0EAE2;vertical-align:top;}
  .cost-row{display:flex;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid #E0D8CF;}
  .cost-item{flex:1;background:#F6F1EB;padding:10px 14px;border-radius:6px;}
  .cost-item.total{background:#C0502A;color:#fff;}
  .cost-item span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;opacity:.7;margin-bottom:3px;}
  .cost-item strong{font-size:14px;font-weight:500;}
  .total-block{background:#1A1714;color:#fff;border-radius:8px;padding:20px;margin:24px 0;}
  .total-block .label{font-size:11px;opacity:.5;text-transform:uppercase;letter-spacing:.08em;}
  .total-block .amount{font-size:28px;font-weight:300;margin-top:4px;}
  .notes{background:#E1F5EE;border:1px solid #5DCAA5;border-radius:8px;padding:16px 20px;}
  .notes h4{color:#085041;margin-bottom:10px;}
  .notes li{color:#085041;font-size:12px;margin-left:16px;margin-bottom:5px;line-height:1.5;}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #E0D8CF;font-size:11px;color:#aaa;text-align:center;}
  @media print{body{padding:20px;}.item-block{page-break-inside:avoid;}}
</style>
</head>
<body>
<div class="header">
  <div class="logo">Gri<em>ha</em> <span style="font-size:14px;color:#888;font-weight:400;">Carpenter Specification Sheet</span></div>
  <div class="meta">
    <strong>${spec.meta.project}</strong>
    ${spec.meta.design_style} · Zone ${spec.meta.vastu_zone}<br>
    ${spec.meta.room_sqft} sqft · Generated ${spec.meta.generated_on}
  </div>
</div>

<div class="material-spec">
  <div class="spec-row"><div class="spec-label">Carcass material</div><div class="spec-val">${spec.material_spec.carcass}</div></div>
  <div class="spec-row"><div class="spec-label">Shutter / finish</div><div class="spec-val">${spec.material_spec.shutters}</div></div>
  <div class="spec-row"><div class="spec-label">Hardware</div><div class="spec-val">${spec.material_spec.hardware}</div></div>
  <div class="spec-row"><div class="spec-label">Overall finish</div><div class="spec-val">${spec.material_spec.finish}</div></div>
</div>

${itemsHTML}

<div class="total-block">
  <div class="label">Total project estimate (materials + labour)</div>
  <div class="amount">₹${spec.total_cost.low.toLocaleString('en-IN')} – ₹${spec.total_cost.high.toLocaleString('en-IN')}</div>
</div>

<div class="notes">
  <h4>Important notes for your carpenter</h4>
  <ul>${spec.notes.map(n => `<li>${n}</li>`).join('')}</ul>
</div>

<div class="footer">Generated by Griha · griha.design · Vastu-compliant interior design platform · Print this page or save as PDF</div>
</body>
</html>`;
  }
}
