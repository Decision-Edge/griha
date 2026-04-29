/**
 * GRIHA CLOUDFLARE WORKER — v3
 * ============================
 * ENDPOINTS:
 *   POST /validate-photo      — quick room photo validation (is it a room?)
 *   POST /analyze-room        — detailed room analysis (light, beams, electrical, style)
 *   POST /analyze-masterplan  — compass zone reading from floor plan
 *   POST /generate-render     — surfaces-only AI render (walls/ceiling/floor, no furniture)
 *   POST /suggest-changes     — conversational chat (Claude)
 *   GET  /health              — status check
 *   GET  /test-render         — test AI binding
 *
 * SECRETS: ANTHROPIC_API_KEY
 * BINDINGS: AI (Workers AI)
 */

const ALLOWED_ORIGIN      = '*';
const AI_MODEL            = 'claude-opus-4-6';
const IMAGE_MODEL_IMG2IMG = '@cf/runwayml/stable-diffusion-v1-5-img2img';
const IMAGE_MODEL_TXT2IMG = '@cf/stabilityai/stable-diffusion-xl-base-1.0';

// ── Surface-only render prompts (NO furniture, NO lighting fixtures) ────────
// Each prompt tells SD to change ONLY walls, ceiling, and floor.
// Furniture and objects in the uploaded photo are preserved by low strength.
const RENDER_STYLE_PROMPTS = {
  contemporary_indian:
    'repaint walls in warm terracotta and kaolin cream, Indian hand-block print wallpaper border near ceiling, exposed brick accent panel, warm sand-coloured smooth plaster ceiling, polished stone floor tiles in warm beige, subtle brass wall sconce glow on walls, NO furniture changes, surfaces only',
  minimalist_modern:
    'repaint walls pure linen white with soft grey accent wall, smooth white ceiling with recessed cove, large-format light grey porcelain floor tiles, clean shadow gaps where walls meet ceiling, NO furniture changes, surfaces only, minimalist architectural finish',
  traditional_heritage:
    'repaint walls in deep ochre and rich burgundy, traditional Indian jali carved stucco wall panel, ornate plaster ceiling medallion, dark teak herringbone wood floor, aged copper wall patina, decorative dado rail with traditional motifs, NO furniture changes, surfaces only',
  boho_chic:
    'repaint walls sage green with warm wheat accent wall, raw exposed plaster texture on feature wall, bamboo reed ceiling panels, terracotta encaustic cement floor tiles, hand-painted botanical wall mural detail, NO furniture changes, surfaces only',
  industrial_modern:
    'exposed raw concrete walls, sealed polished concrete floor, dark steel-grey painted ceiling with visible ductwork, large industrial warehouse windows painted black, brick feature wall, NO furniture changes, surfaces only',
  art_deco_indian:
    'walls in deep teal with gold geometric Art Deco stencil border, glossy cream ceiling with ornate cornice, black and gold geometric marble floor tiles, dramatic wall sconce shadow lines, NO furniture changes, surfaces only',
  japandi:
    'walls in soft warm grey with natural washi texture, exposed wood beam ceiling in pale oak, wide plank light ash wood floor, Shoji screen shadow lines on walls, wabi-sabi plaster imperfect finish, NO furniture changes, surfaces only',
  coastal_indian:
    'walls in soft aquamarine and bleached white limewash finish, whitewashed ceiling with exposed cane matting, pale weathered teak floor, nautical rope texture dado, NO furniture changes, surfaces only'
};

// ── Palette colour descriptors for render prompts ───────────────────────────
const PALETTE_RENDER_DESCS = {
  warm_earthen:    'warm terracotta #C47040, kaolin clay #EAE1D5, teak brown #8E6D4E',
  sage_serenity:   'sage green #779971, pale moss #B5CDAC, morning mist #E8EEE6',
  terracotta_dawn: 'fired clay #C47040, brick spice #9A4820, pale peach #F5ECE1',
  cloud_white:     'linen white #F5F0E8, warm ivory #EDE8DC, greige #C8BC9F',
  monsoon_blue:    'cerulean blue #5B8FAE, deep navy #2E5F82, arctic mist #EBF0F5',
  golden_hour:     'warm gold #B07D20, amber #D4960A, champagne #F4EAD5',
  forest_deep:     'forest green #2B4D25, deep fern #4E7848, pale sage #E8EEE6',
  blush_rose:      'dusty rose #D4927B, muted blush #ECC4B8, warm cream #FAF0EA',
  midnight_charcoal:'charcoal #2C2C2A, dark slate #3D3D3B, warm grey #8C8C8A',
  coastal_sand:    'coastal sand #DED3B8, driftwood #B09070, sea foam #E8EDE6'
};

// ── Photo validation prompt (fast, cheap — only 100 tokens needed) ──────────
const VALIDATE_PROMPT = `Look at this photo. Is it an interior room photo suitable for home interior design analysis?
Return ONLY this JSON, no other text:
{
  "is_valid_room": true,
  "room_type_detected": "bedroom",
  "confidence": "high",
  "reason": null
}
Rules:
- is_valid_room: true ONLY if this is clearly an interior room of a building (bedroom, living room, kitchen, bathroom, balcony, etc.)
- false if: outdoor photo, person/pet photo, food, product, document, selfie, or non-room image
- room_type_detected: what type of room if valid, null if not valid
- confidence: "high", "medium", or "low"
- reason: null if valid, short reason string if invalid (e.g. "This appears to be a photo of a dog, not a room")
Respond with ONLY the JSON.`;

// ── Detailed room analysis prompt ────────────────────────────────────────────
const ROOM_ANALYSIS_PROMPT = `You are an expert interior design analyst and building inspector specialising in Indian homes.
Carefully examine every part of this room photo and return ONLY valid JSON — no text, no markdown, no code fences.

{
  "room_identified": true,
  "confidence": "high",
  "error": null,
  "observations": {
    "estimated_sqft": 160,
    "ceiling_height": "standard",
    "ceiling_type": "flat",
    "window_count": 2,
    "window_positions": ["north_wall", "east_wall"],
    "light_direction": "east",
    "light_quality": "bright",
    "natural_light_assessment": "good morning light from east-facing windows",
    "overhead_beams_detected": false,
    "beam_count": 0,
    "beam_positions": "not_applicable",
    "electrical_points_visible": 3,
    "electrical_point_positions": ["bedhead_wall_right", "opposite_wall_centre", "near_door"],
    "switch_boards_visible": 2,
    "ac_unit_visible": false,
    "existing_furniture": ["double_bed", "wardrobe", "side_table"],
    "wall_colours_existing": ["off_white", "cream"],
    "flooring_type": "vitrified_tile",
    "flooring_colour": "beige",
    "ceiling_colour": "white",
    "wall_condition": "good",
    "style_detected": ["contemporary_indian"],
    "vastu_observations": {
      "main_door_direction_visible": "unknown",
      "sleeping_head_direction_visible": "south",
      "mirror_facing_bed": false,
      "heavy_furniture_zone": "south_west"
    }
  }
}

Be very precise and observant:
- Count electrical points carefully — look for plug sockets, switches, AC points near floor/ceiling
- Check ceiling for beams, cracks, pendants, fans, AC vents
- Estimate sqft based on visible room proportions and furniture scale
- ceiling_height: "low" (<8ft), "standard" (8-10ft), "high" (>10ft)
- ceiling_type: "flat", "pop_ceiling", "coffered", "beam_exposed", "false_ceiling"
- light_direction: which compass direction do the windows face (north/south/east/west/unknown)
- flooring_type: "marble", "vitrified_tile", "ceramic_tile", "wood", "laminate", "granite", "mosaic", "cement"
- wall_condition: "excellent", "good", "needs_work", "poor"
- If unclear or dark: set confidence to "low" or "medium" and error to "image_unclear" or "too_dark"
Respond with ONLY the JSON.`;

const MASTERPLAN_PROMPT = `You are an expert architect reading an Indian builder floor plan image.
Return ONLY valid JSON — no text, no markdown, no code fences.

{
  "plan_identified": true,
  "confidence": "high",
  "error": null,
  "direction_confidence": "high",
  "direction_clarity_note": null,
  "building": {
    "total_sqft": 1200,
    "bhk_type": "2BHK",
    "floors": 1
  },
  "orientation": {
    "north_direction": "top",
    "north_source": "compass_rose",
    "main_entrance_direction": "east"
  },
  "rooms": [
    { "name": "master bedroom", "compass_zone": "SW", "approximate_sqft": 180, "has_window": true, "window_direction": "east" },
    { "name": "kitchen",        "compass_zone": "SE", "approximate_sqft": 90,  "has_window": true, "window_direction": "south" }
  ]
}

CRITICAL — direction_confidence assessment:
- "high":   A compass rose or north arrow is clearly visible in the image. You are certain of orientation.
- "medium": No compass rose, but orientation can be inferred from road labels, sun direction markers, or standard Indian convention (main entrance often faces east/north).
- "low":    No compass indicators at all. Orientation is a guess. Vastu zone mapping will be unreliable.

direction_clarity_note: 
- If "high": null
- If "medium": Short explanation of how you inferred direction, e.g. "No compass rose visible. North inferred from entrance facing convention."
- If "low": Clear explanation of what is missing, e.g. "No north arrow, compass rose, or orientation markers found in this floor plan. Vastu zone assignment is approximate only."

north_source: one of "compass_rose", "north_arrow", "road_label_inference", "entrance_convention", "unknown"

If the image is not a floor plan: plan_identified false, error "not_a_floorplan"
If the image is too blurry to read: plan_identified false, error "image_unclear"

Respond with ONLY the JSON.`;

const CHAT_SYSTEM = `You are Griha's AI interior design assistant specialising in Vastu-compliant Indian interiors.
Help users understand their room's Vastu compliance and surface design (walls, ceiling, flooring).
Keep responses concise (3-5 sentences max), specific, and actionable.
Always mention the Vastu rationale. Reference Asian Paints or Berger paint codes where possible.
When asked about surface changes: describe wall colours, paint finishes, wallpaper, ceiling treatment, flooring.
Do NOT recommend furniture or lighting (that is handled separately).
Be warm and conversational.`;

// ── Main handler ────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    const cors = { ...corsHeaders, 'Content-Type': 'application/json' };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/health') {
        return json({ status:'ok', model:AI_MODEL, ai_binding:!!(env.AI), version:'v3', cors_fix:'preflight-204' }, 200, cors);
      }

      if (url.pathname === '/test-render' && request.method === 'GET') {
        if (!env.AI) return json({ ok:false, error:'AI binding missing' }, 503, cors);
        try {
          const r = await env.AI.run(IMAGE_MODEL_TXT2IMG, { prompt:'a plain white room interior, walls only, no furniture', num_steps:4, width:256, height:256 });
          const buf = await new Response(r).arrayBuffer();
          return new Response(new Uint8Array(buf), { headers:{ ...corsHeaders, 'Content-Type':'image/png' } });
        } catch(e) { return json({ ok:false, error:e.message }, 500, cors); }
      }

      if (request.method !== 'POST') return json({ error:'Use POST' }, 405, cors);

      if (url.pathname === '/validate-photo')     return validatePhoto(request, env, cors);
      if (url.pathname === '/analyze-room')       return analyzeRoom(request, env, cors);
      if (url.pathname === '/analyze-masterplan') return analyzeMasterplan(request, env, cors);
      if (url.pathname === '/generate-render')    return generateRender(request, env, cors);
      if (url.pathname === '/suggest-changes')    return suggestChanges(request, env, cors);

      return json({ error:'Not found' }, 404, cors);
    } catch(err) {
      console.error('Worker error:', err);
      return json({ error:'Internal error', detail:err.message }, 500, cors);
    }
  }
};

// ── /validate-photo ─────────────────────────────────────────────────────────
async function validatePhoto(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);
  const { imageBase64, mimeType } = await request.json();
  if (!imageBase64) return json({ error:'imageBase64 required' }, 400, cors);

  const ai = await callClaude({
    env,
    messages: [{
      role:'user',
      content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text', text:VALIDATE_PROMPT }
      ]
    }],
    max_tokens: 200  // fast and cheap
  });

  if (!ai.ok) return json({ error:ai.error }, 502, cors);
  return json(safeJSON(ai.text), 200, cors);
}

// ── /analyze-room ────────────────────────────────────────────────────────────
async function analyzeRoom(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);
  const { imageBase64, mimeType, roomLabel } = await request.json();
  if (!imageBase64) return json({ error:'imageBase64 required' }, 400, cors);

  const prompt = roomLabel
    ? `Room type confirmed by user: "${roomLabel}"\n\n${ROOM_ANALYSIS_PROMPT}`
    : ROOM_ANALYSIS_PROMPT;

  const ai = await callClaude({
    env,
    messages:[{
      role:'user',
      content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text', text:prompt }
      ]
    }]
  });

  if (!ai.ok) return json({ error:ai.error }, 502, cors);
  return json(safeJSON(ai.text), 200, cors);
}

// ── /analyze-masterplan ──────────────────────────────────────────────────────
async function analyzeMasterplan(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);
  const { imageBase64, mimeType } = await request.json();
  if (!imageBase64) return json({ error:'imageBase64 required' }, 400, cors);

  const ai = await callClaude({
    env,
    messages:[{
      role:'user',
      content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text', text:MASTERPLAN_PROMPT }
      ]
    }]
  });

  if (!ai.ok) return json({ error:ai.error }, 502, cors);
  return json(safeJSON(ai.text), 200, cors);
}

// ── /generate-render (surfaces only — no furniture) ──────────────────────────
async function generateRender(request, env, cors) {
  if (!env.AI) {
    return json({ ok:false, error:'Workers AI binding missing. Cloudflare → griha-worker → Settings → Bindings → Add → Workers AI → name "AI" → Save and Deploy.' }, 503, cors);
  }

  let body;
  try { body = await request.json(); }
  catch(e) { return json({ ok:false, error:'Invalid request body' }, 400, cors); }

  const { room_type, design_style_id, compass_zone, room_sqft, palette_id, palette_desc, roomImageBase64, roomMimeType } = body;

  const stylePrompt  = RENDER_STYLE_PROMPTS[design_style_id] || RENDER_STYLE_PROMPTS.contemporary_indian;
  const palDesc      = PALETTE_RENDER_DESCS[palette_id] || palette_desc || '';
  const roomLabel    = (room_type||'room').replace(/_/g,' ');
  const zoneCtx      = compass_zone && compass_zone!=='unknown' ? `, ${compass_zone}-facing ${roomLabel}` : ` ${roomLabel}`;
  const palCtx       = palDesc ? `, exact colours: ${palDesc}` : '';

  // Surface-only prompt — explicitly exclude furniture changes
  const fullPrompt   = `Interior design surface transformation${zoneCtx}. ${stylePrompt}${palCtx}. Transform ONLY walls ceiling and floor. Preserve all existing furniture objects and layout exactly. Ultra realistic professional interior photography. Highly detailed surfaces. No people.`;
  const negPrompt    = 'people, person, furniture change, new furniture, added objects, cartoon, anime, sketch, watermark, text, blurry, low quality, deformed';

  try {
    let result;

    if (roomImageBase64) {
      // IMG2IMG: apply surface transformation to actual uploaded room photo
      const binaryStr  = atob(roomImageBase64);
      const imageBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) imageBytes[i] = binaryStr.charCodeAt(i);

      result = await env.AI.run(IMAGE_MODEL_IMG2IMG, {
        prompt:          fullPrompt,
        negative_prompt: negPrompt,
        image:           [...imageBytes],
        strength:        0.55,   // preserves room structure, changes surfaces
        num_steps:       20,
        guidance:        9.0,    // high guidance = strictly follows surface-only prompt
      });
    } else {
      // TXT2IMG fallback
      result = await env.AI.run(IMAGE_MODEL_TXT2IMG, {
        prompt:          `Empty ${roomLabel} interior, ${stylePrompt}${palCtx}, no people, no furniture, walls ceiling floor only, ultra realistic`,
        negative_prompt: negPrompt,
        num_steps:       20,
        guidance:        7.5,
        width:           768,
        height:          512,
      });
    }

    // Stream → base64
    const arrayBuffer = await new Response(result).arrayBuffer();
    const uint8Array  = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize));
    }

    return json({
      ok:           true,
      image_base64: btoa(binary),
      mime_type:    'image/png',
      mode:         roomImageBase64 ? 'img2img' : 'txt2img',
      prompt_used:  fullPrompt
    }, 200, cors);

  } catch(err) {
    const msg    = err.message||String(err);
    const detail = msg.includes('timeout') ? 'Timed out — try again. If persistent, the photo may be too large (try under 1MB).'
                 : msg.includes('model')   ? 'AI model error — check AI binding is named "AI".'
                 : msg;
    return json({ ok:false, error:`Render failed: ${detail}` }, 500, cors);
  }
}

// ── /suggest-changes ────────────────────────────────────────────────────────
async function suggestChanges(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);
  const { userMessage, currentAnalysis, conversationHistory=[] } = await request.json();
  if (!userMessage) return json({ error:'userMessage required' }, 400, cors);

  let ctx = userMessage;
  if (currentAnalysis) {
    const parts = [];
    if (currentAnalysis.room_type)       parts.push(`Room: ${currentAnalysis.room_type}`);
    if (currentAnalysis.zone)            parts.push(`Vastu zone: ${currentAnalysis.zone}`);
    if (currentAnalysis.vastu?.score !== undefined) parts.push(`Vastu score: ${currentAnalysis.vastu.score}/100`);
    if (currentAnalysis.selected_style)  parts.push(`Design style: ${currentAnalysis.selected_style}`);
    if (currentAnalysis.selected_palette)parts.push(`Palette: ${currentAnalysis.selected_palette}`);
    if (parts.length) ctx = `[Context: ${parts.join(' | ')}]\n\nUser: ${userMessage}`;
  }

  const ai = await callClaude({
    env,
    system:   CHAT_SYSTEM,
    messages: [...conversationHistory.slice(-10), { role:'user', content:ctx }],
    max_tokens: 600
  });

  if (!ai.ok) return json({ error:ai.error }, 502, cors);
  return json({ ok:true, reply:ai.text }, 200, cors);
}

// ── Claude helper ────────────────────────────────────────────────────────────
async function callClaude({ env, messages, system=null, max_tokens=1024 }) {
  const body = { model:AI_MODEL, max_tokens, messages };
  if (system) body.system = system;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
    body:    JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    return { ok:false, error:err.error?.message||`Anthropic API error ${res.status}` };
  }
  const data = await res.json();
  return { ok:true, text:data.content?.[0]?.text||'' };
}

function safeJSON(text) {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return { error:'parse_failed', raw:text.slice(0,200) };
  }
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}
function missingKey(cors) {
  return json({ error:'ANTHROPIC_API_KEY not set. Worker Settings → Variables and Secrets → Add ANTHROPIC_API_KEY' }, 503, cors);
}
