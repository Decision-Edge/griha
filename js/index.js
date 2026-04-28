/**
 * GRIHA CLOUDFLARE WORKER — v2
 * ============================
 * SECRETS NEEDED (Cloudflare dashboard → Worker → Settings → Variables → Add):
 *   ANTHROPIC_API_KEY  — console.anthropic.com
 *   OPENAI_API_KEY     — platform.openai.com/api-keys
 *
 * ENDPOINTS:
 *   POST /analyze-room            Claude vision: analyse room photo
 *   POST /analyze-masterplan      Claude vision: read floor plan
 *   POST /generate-designs        5 design concepts + DALL-E renders (parallel)
 *   POST /generate-carpenter-spec Carpenter BOM + material cost
 *   POST /suggest-changes         Conversational design refinement
 *   GET  /health                  Status check
 */

const ALLOWED_ORIGIN = '*';
const CLAUDE_MODEL   = 'claude-opus-4-6';
const DALLE_MODEL    = 'dall-e-3';
const DALLE_QUALITY  = 'standard';

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health')                  return json({ status: 'ok', version: 2 }, 200, cors);
      if (url.pathname === '/analyze-room')            return handleRoomAnalysis(request, env, cors);
      if (url.pathname === '/analyze-masterplan')      return handleMasterplan(request, env, cors);
      if (url.pathname === '/generate-designs')        return handleGenerateDesigns(request, env, cors);
      if (url.pathname === '/generate-carpenter-spec') return handleCarpenterSpec(request, env, cors);
      if (url.pathname === '/suggest-changes')         return handleSuggestChanges(request, env, cors);
      return json({ error: 'Not found' }, 404, cors);
    } catch (e) {
      return json({ error: e.message }, 500, cors);
    }
  }
};

// ─── ROOM ANALYSIS ────────────────────────────────────────────────────────────
async function handleRoomAnalysis(request, env, cors) {
  const { imageBase64, mimeType, roomLabel } = await request.json();
  if (!imageBase64) return json({ error: 'imageBase64 required' }, 400, cors);

  const prompt = `${roomLabel ? `Room label: "${roomLabel}"\n\n` : ''}You are an expert Indian interior design analyst. Analyse this room photo and return ONLY valid JSON with no other text.
{
  "room_identified": true,
  "confidence": "high",
  "error": null,
  "observations": {
    "estimated_sqft": 180,
    "ceiling_height": "standard",
    "window_count": 1,
    "light_direction": "east",
    "light_quality": "bright",
    "overhead_beams_detected": false,
    "beam_positions": "not_applicable",
    "electrical_points_visible": 3,
    "electrical_point_positions": ["bedhead_wall","opposite_wall"],
    "existing_furniture": ["bed","wardrobe"],
    "wall_colours_existing": ["cream"],
    "flooring_type": "tile",
    "style_detected": ["contemporary_indian"]
  }
}
ceiling_height: "low"(<8ft),"standard"(8-10ft),"high"(>10ft). light_direction: compass direction of windows.
style_detected array: "minimalist","traditional","contemporary_indian","modern","eclectic","boho","rajasthani","south_indian".
If unclear/not a room: room_identified=false, error="image_unclear"/"not_a_room"/"too_dark". Return ONLY JSON.`;

  const res = await claude(env, [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
    { type: 'text', text: prompt }
  ]}]);
  if (!res.ok) return json({ error: res.error }, 502, cors);
  return json(parseJSON(res.text), 200, cors);
}

// ─── MASTERPLAN ───────────────────────────────────────────────────────────────
async function handleMasterplan(request, env, cors) {
  const { imageBase64, mimeType } = await request.json();
  const prompt = `You are an expert Vastu architect. Analyse this floor plan. Return ONLY valid JSON.
{
  "plan_identified": true,
  "confidence": "high",
  "error": null,
  "building": { "total_sqft": 1200, "bhk_type": "2BHK", "floors": 1 },
  "orientation": { "north_direction": "top", "main_entrance_direction": "east" },
  "rooms": [
    { "name": "master bedroom", "compass_zone": "SW", "approximate_sqft": 180, "has_window": true, "window_direction": "east" }
  ]
}
compass_zone: NE,N,NW,E,W,SE,S,SW. If not a floor plan: plan_identified=false, error="not_a_floorplan". Return ONLY JSON.`;

  const res = await claude(env, [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
    { type: 'text', text: prompt }
  ]}]);
  if (!res.ok) return json({ error: res.error }, 502, cors);
  return json(parseJSON(res.text), 200, cors);
}

// ─── GENERATE DESIGNS (5 concepts + parallel DALL-E renders) ──────────────────
async function handleGenerateDesigns(request, env, cors) {
  const { roomType, zone, sqft, styleDetected, vastuViolations } = await request.json();

  if (!env.OPENAI_API_KEY) return json({
    error: 'OPENAI_API_KEY not set. Add it in Cloudflare → Worker → Settings → Variables.'
  }, 500, cors);

  const issues = (vastuViolations || []).map(r => r.title).join(', ') || 'none';
  const rt = roomType || 'living room';
  const z  = zone || 'unknown';
  const sq = sqft || 160;
  const st = styleDetected || 'mixed';

  const conceptsPrompt = `You are a senior Indian interior designer. Generate exactly 5 distinct Vastu-compliant design concepts.
Room: ${rt} | Vastu zone: ${z} | Size: ~${sq} sqft | Current style: ${st}
Vastu issues to address: ${issues}

Return ONLY valid JSON — no markdown, no explanation:
{
  "concepts": [
    {
      "id": "opt-1",
      "name": "Contemporary Indian",
      "style_tag": "contemporary_indian",
      "tagline": "Modern lines rooted in Indian craft",
      "description": "2 sentences describing this concept for this specific room.",
      "vastu_address": "1 sentence on how this design resolves the listed Vastu issues.",
      "primary_hex": "#C47040",
      "secondary_hex": "#F5ECE1",
      "accent_hex": "#B07D20",
      "wall_treatment": "Warm terracotta on south accent wall, warm ivory on remaining three walls",
      "key_materials": ["sheesham wood","handloom cotton","brass hardware"],
      "lighting_plan": "Warm white ambient ceiling light + SE corner floor lamp (Vastu Agni zone) + task lighting near workspace",
      "wallpaper_note": "Optional: linen-texture wallpaper on south feature wall only",
      "dalle_prompt": "Professional interior design photograph, ${rt}, Indian apartment, contemporary Indian style, warm terracotta feature wall, sheesham wood furniture with brass accents, handloom cotton cushions, natural morning light, no people, photorealistic, architectural digest quality",
      "style_tags": ["contemporary_indian","warm","wooden","brass"],
      "custom_pieces": ["wardrobe","tv_unit"],
      "estimated_total_inr": 145000
    }
  ]
}

The 5 concepts must be genuinely different:
1. Contemporary Indian — modern with Indian craft (sheesham, brass, handloom)
2. Minimalist Modern — white/grey palette, clean geometry, IKEA-friendly
3. Traditional Indian — rich jewel tones, carved wood, ornate textiles
4. Boho Eclectic — rattan, macramé, plants, mixed textiles
5. Scandinavian Comfort — white + pine, cosy textiles, warm lighting

Adapt each to the ${rt} room type and ${z} Vastu zone.
dalle_prompt: 40-60 words, photorealistic, specific materials, no people, no text.
Return ONLY the JSON object with "concepts" array containing exactly 5 items.`;

  const conceptsRes = await claude(env, [{ role: 'user', content: conceptsPrompt }], 3500);
  if (!conceptsRes.ok) return json({ error: conceptsRes.error }, 502, cors);

  const parsed = parseJSON(conceptsRes.text);
  if (!parsed.concepts || !Array.isArray(parsed.concepts)) {
    return json({ error: 'Could not parse design concepts', detail: conceptsRes.text.slice(0, 300) }, 500, cors);
  }

  // Generate all DALL-E images in parallel
  const imageResults = await Promise.all(
    parsed.concepts.map(c => generateImage(c.dalle_prompt, env).catch(() => ({ url: null })))
  );

  const concepts = parsed.concepts.map((c, i) => ({
    ...c,
    image_url: imageResults[i]?.url || null
  }));

  return json({ concepts }, 200, cors);
}

// ─── CARPENTER SPEC ───────────────────────────────────────────────────────────
async function handleCarpenterSpec(request, env, cors) {
  const { roomType, piece, sqft, styleName } = await request.json();
  if (!piece) return json({ error: 'piece name required' }, 400, cors);

  const prompt = `You are an expert Indian carpenter and joinery consultant in Bengaluru.
Generate a complete specification sheet for a custom ${piece} for a ${roomType || 'bedroom'}.
Room size: ~${sqft || 150} sqft. Style: ${styleName || 'contemporary Indian'}.

Return ONLY valid JSON — no markdown:
{
  "piece_name": "${piece}",
  "room_type": "${roomType}",
  "style": "${styleName}",
  "overall_dimensions": { "length_mm": 2400, "depth_mm": 600, "height_mm": 2100 },
  "components": [
    { "name": "Main carcass", "length_mm": 2400, "depth_mm": 580, "height_mm": 2100, "qty": 1, "material": "18mm BWR Grade Plywood (IS:710)", "finish": "White laminate (Merino 2050 or equivalent)" },
    { "name": "Shelves", "length_mm": 590, "depth_mm": 560, "height_mm": 18, "qty": 6, "material": "18mm BWR Plywood", "finish": "Same as carcass" },
    { "name": "Shutter doors", "length_mm": 600, "depth_mm": 18, "height_mm": 700, "qty": 4, "material": "18mm MDF", "finish": "2mm acrylic / PU paint" }
  ],
  "hardware": [
    { "item": "Soft-close hinges (Hettich or Hafele)", "qty": 12, "unit_cost_inr": 90, "total_inr": 1080 },
    { "item": "Telescopic channels (Hettich)", "qty": 4, "unit_cost_inr": 350, "total_inr": 1400 },
    { "item": "Cabinet handles (aluminium bar)", "qty": 8, "unit_cost_inr": 120, "total_inr": 960 },
    { "item": "Soft-close channels (drawer)", "qty": 2, "unit_cost_inr": 550, "total_inr": 1100 }
  ],
  "materials_cost": {
    "plywood_sheets": 8,
    "plywood_per_sheet_inr": 1800,
    "plywood_total_inr": 14400,
    "laminate_sqft": 120,
    "laminate_per_sqft_inr": 65,
    "laminate_total_inr": 7800,
    "hardware_total_inr": 4540,
    "miscellaneous_inr": 1200,
    "total_materials_inr": 27940
  },
  "labour": {
    "estimated_days": 4,
    "daily_rate_inr": 1800,
    "total_labour_inr": 7200
  },
  "grand_total_inr": 35140,
  "vastu_placement": "Place wardrobe on south or west wall. Keep NE corner of room free.",
  "carpenter_tips": [
    "Use BWR (Boiling Water Resistant) plywood — not MR (Moisture Resistant) — for longevity in Indian climate",
    "Pre-drill all hinge holes before assembly to avoid splitting",
    "Apply edge banding on all exposed plywood edges",
    "Leave 10mm clearance at top for ceiling variation"
  ],
  "brand_suggestions": {
    "plywood": "Century Ply Gold / GreenPly Gold / Kitply Gold",
    "laminates": "Merino / Sundek / Greenlam",
    "hardware": "Hettich / Hafele / Ebco"
  }
}
Return ONLY the JSON.`;

  const res = await claude(env, [{ role: 'user', content: prompt }], 2000);
  if (!res.ok) return json({ error: res.error }, 502, cors);
  return json(parseJSON(res.text), 200, cors);
}

// ─── SUGGEST CHANGES ──────────────────────────────────────────────────────────
async function handleSuggestChanges(request, env, cors) {
  const { userMessage, currentAnalysis, conversationHistory = [] } = await request.json();
  if (!userMessage) return json({ error: 'userMessage required' }, 400, cors);

  const context = currentAnalysis
    ? `Design context:\n${JSON.stringify(currentAnalysis, null, 2)}\n\nUser: ${userMessage}`
    : userMessage;

  const res = await claude(env,
    [...conversationHistory, { role: 'user', content: context }],
    800,
    'You are Griha\'s AI interior design assistant for Indian homes. Help users refine design choices. Be specific about materials, colours, dimensions, and Vastu rationale. Give prices in INR.'
  );
  if (!res.ok) return json({ error: res.error }, 502, cors);
  return json({ reply: res.text }, 200, cors);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function claude(env, messages, max_tokens = 1500, system = null) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };
  const body = { model: CLAUDE_MODEL, max_tokens, messages };
  if (system) body.system = system;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); return { ok: false, error: e.error?.message || `Claude ${res.status}` }; }
  const d = await res.json();
  return { ok: true, text: d.content?.[0]?.text || '' };
}

async function generateImage(prompt, env) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: DALLE_MODEL, prompt: prompt + ' No people. No text overlays.', n: 1, size: '1024x1024', quality: DALLE_QUALITY })
  });
  if (!res.ok) return { url: null };
  const d = await res.json();
  return { url: d.data?.[0]?.url || null };
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) try { return JSON.parse(m[0]); } catch { /**/ }
    return { error: 'parse_failed', raw: text.slice(0, 200) };
  }
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}
