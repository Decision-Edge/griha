/**
 * GRIHA CLOUDFLARE WORKER — v4
 * ============================
 * ENDPOINTS:
 *   POST /validate-photo      — is this a room photo?
 *   POST /analyze-room        — detailed room analysis
 *   POST /analyze-masterplan  — compass zones from floor plan
 *   POST /generate-render     — surfaces-only AI render (img2img)
 *   POST /suggest-changes     — conversational chat
 *   GET  /health
 *   GET  /test-render         — test AI binding
 *
 * SECRETS: ANTHROPIC_API_KEY
 * BINDINGS: AI (Workers AI)
 */

const ALLOWED_ORIGIN      = '*';
const AI_MODEL            = 'claude-opus-4-6';
const IMAGE_MODEL_IMG2IMG = '@cf/runwayml/stable-diffusion-v1-5-img2img';
const IMAGE_MODEL_TXT2IMG = '@cf/stabilityai/stable-diffusion-xl-base-1.0';

// ── Surface-only render prompts ───────────────────────────────────────────────
const RENDER_STYLE_PROMPTS = {
  contemporary_indian:
    'warm terracotta accent wall, kaolin clay white walls, warm sand textured plaster ceiling, polished beige stone floor tiles, subtle Indian block-print wallpaper border, warm ambient wall glow',
  minimalist_modern:
    'pure linen white walls, smooth matte white ceiling with shadow gap cove, large-format light grey polished porcelain floor, clean architectural shadow lines',
  traditional_heritage:
    'deep ochre and rich burgundy walls, ornate plaster ceiling medallion with antique gold detail, dark teak herringbone wood floor, traditional Indian dado rail border',
  boho_chic:
    'sage green walls with warm wheat accent, raw exposed plaster feature wall texture, bamboo reed ceiling, terracotta encaustic cement floor tiles',
  industrial_modern:
    'exposed raw concrete walls, sealed polished concrete floor, dark anthracite painted ceiling, exposed brick feature wall in warm grey',
  art_deco_indian:
    'deep teal walls with gold geometric Art Deco stencil border, cream glossy ceiling with ornate cornice, black and gold geometric marble floor',
  japandi:
    'warm greige walls with washi paper texture, pale oak exposed ceiling beams, wide plank light ash wood floor, wabi-sabi imperfect plaster finish',
  coastal_indian:
    'soft aquamarine and bleached white limewash walls, whitewashed ceiling, pale weathered teak floor, natural rope texture dado'
};

const PALETTE_RENDER_DESCS = {
  warm_earthen:     'terracotta #C47040, kaolin clay #EAE1D5, teak brown #8E6D4E',
  sage_serenity:    'sage green #779971, pale moss #B5CDAC, morning mist #E8EEE6',
  terracotta_dawn:  'fired clay #C47040, brick spice #9A4820, pale peach #F5ECE1',
  cloud_white:      'linen white #F5F0E8, warm ivory #EDE8DC, greige #C8BC9F',
  monsoon_blue:     'cerulean #5B8FAE, deep navy #2E5F82, arctic mist #EBF0F5',
  golden_hour:      'warm gold #B07D20, amber #D4960A, champagne #F4EAD5',
  forest_deep:      'forest green #2B4D25, deep fern #4E7848, pale sage #E8EEE6',
  blush_rose:       'dusty rose #D4927B, muted blush #ECC4B8, warm cream #FAF0EA',
  midnight_charcoal:'charcoal #2C2C2A, dark slate #3D3D3B, warm grey #8C8C8A',
  coastal_sand:     'coastal sand #DED3B8, driftwood #B09070, sea foam #E8EDE6'
};

// ── Prompts ───────────────────────────────────────────────────────────────────
const VALIDATE_PROMPT = `Look at this image. Return ONLY this JSON with no other text:
{"is_valid_room":true,"room_type_detected":"bedroom","reason":null}
Rules:
- is_valid_room: true for ANY interior space (bedroom, living room, kitchen, bathroom, balcony, corridor, under-construction room, empty room)
- is_valid_room: false ONLY if clearly not a room: person photo, pet, food, vehicle, outdoor scene, document scan, product shot
- When in doubt: return true
- reason: null if valid, one short sentence if invalid`;

const ROOM_ANALYSIS_PROMPT = `You are an expert interior design analyst for Indian homes.
Carefully examine this room photo and return ONLY valid JSON — no markdown, no code fences, no other text.

Return exactly this structure:
{
  "room_identified": true,
  "confidence": "high",
  "error": null,
  "observations": {
    "estimated_sqft": 160,
    "ceiling_height": "standard",
    "ceiling_type": "flat",
    "window_count": 1,
    "light_direction": "east",
    "light_quality": "bright",
    "natural_light_assessment": "Good morning light from east window",
    "overhead_beams_detected": false,
    "beam_count": 0,
    "electrical_points_visible": 2,
    "electrical_point_positions": ["bedhead_wall", "opposite_wall"],
    "existing_furniture": ["bed", "wardrobe"],
    "wall_colours_existing": ["white", "cream"],
    "flooring_type": "vitrified_tile",
    "flooring_colour": "beige",
    "ceiling_colour": "white",
    "wall_condition": "good",
    "style_detected": ["contemporary_indian"],
    "vastu_observations": {
      "sleeping_head_direction_visible": "south",
      "mirror_facing_bed": false,
      "heavy_furniture_zone": "south_west"
    }
  }
}

Observe carefully:
- Count electrical sockets/switches visible on walls
- Check ceiling for beams, fans, AC units, false ceiling edges
- Estimate sqft from room proportions and furniture scale
- ceiling_height: "low" under 8ft, "standard" 8-10ft, "high" over 10ft
- light_direction: which wall has windows (north/south/east/west/unknown)
- flooring_type: marble/vitrified_tile/ceramic_tile/wood/laminate/granite/mosaic/cement
- wall_condition: excellent/good/needs_work/poor

Respond with ONLY the JSON object, nothing else.`;

const MASTERPLAN_PROMPT = `You are reading an Indian builder floor plan image.
Return ONLY valid JSON — no markdown, no code fences, no other text before or after.

{"plan_identified":true,"confidence":"high","direction_confidence":"high","direction_clarity_note":null,"building":{"total_sqft":1200,"bhk_type":"2BHK","floors":1},"orientation":{"north_direction":"top","north_source":"compass_rose","main_entrance_direction":"east"},"rooms":[{"name":"master bedroom","compass_zone":"SW","approximate_sqft":180},{"name":"kitchen","compass_zone":"SE","approximate_sqft":90},{"name":"living room","compass_zone":"N","approximate_sqft":220}]}

Rules:
- plan_identified: true if this is a floor plan showing rooms, false if not
- direction_confidence: "high" if compass rose or north arrow visible, "medium" if inferred from labels, "low" if no orientation markers
- direction_clarity_note: null if high confidence, explanation string otherwise
- compass_zone: one of N,NE,E,SE,S,SW,W,NW
- Include all rooms you can identify
- If not a floor plan: {"plan_identified":false,"error":"not_a_floorplan"}
- If image is unclear: {"plan_identified":false,"error":"image_unclear"}

Respond with ONLY the JSON, nothing else.`;

const CHAT_SYSTEM = `You are Griha's AI interior design assistant for Indian homes. 
Answer questions about Vastu compliance, wall colours, paint finishes, surface materials, and room design.
Keep responses to 3-4 sentences. Be specific with paint codes (Asian Paints, Berger) when relevant.
Be warm, helpful, and conversational.`;

// ── Main handler ─────────────────────────────────────────────────────────────
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
      // Health check
      if (url.pathname === '/health') {
        return json({ status:'ok', model:AI_MODEL, ai_binding:!!(env.AI), version:'v4' }, 200, cors);
      }

      // Quick AI binding test — GET, no CORS preflight needed
      if (url.pathname === '/test-render' && request.method === 'GET') {
        if (!env.AI) return json({ ok:false, error:'AI binding missing — add Workers AI binding named "AI"' }, 503, cors);
        try {
          const r = await env.AI.run(IMAGE_MODEL_TXT2IMG, {
            prompt:'a plain white empty room interior, walls and floor only, no furniture',
            num_steps:4, width:256, height:256
          });
          const buf = await new Response(r).arrayBuffer();
          return new Response(new Uint8Array(buf), { headers:{ ...corsHeaders, 'Content-Type':'image/png' } });
        } catch(e) { return json({ ok:false, error:e.message }, 500, cors); }
      }

      if (request.method !== 'POST') return json({ error:'Use POST for analysis endpoints' }, 405, cors);

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

// ── /validate-photo ───────────────────────────────────────────────────────────
async function validatePhoto(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);
  try {
    const { imageBase64, mimeType } = await request.json();
    if (!imageBase64) return json({ is_valid_room:true, _skipped:true }, 200, cors);
    const ai = await callClaude({ env, messages:[{
      role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text', text:VALIDATE_PROMPT }
      ]
    }], max_tokens:150 });
    if (!ai.ok) return json({ is_valid_room:true, _skipped:true }, 200, cors);
    const parsed = safeJSON(ai.text);
    // If parsing fails for any reason, default to accepting the photo
    if (typeof parsed.is_valid_room !== 'boolean') return json({ is_valid_room:true, _skipped:true }, 200, cors);
    return json(parsed, 200, cors);
  } catch(e) {
    return json({ is_valid_room:true, _skipped:true }, 200, cors);
  }
}

// ── /analyze-room ─────────────────────────────────────────────────────────────
async function analyzeRoom(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);
  const { imageBase64, mimeType, roomLabel } = await request.json();
  if (!imageBase64) return json({ error:'imageBase64 required' }, 400, cors);
  const prompt = roomLabel ? `Room type: "${roomLabel}"\n\n${ROOM_ANALYSIS_PROMPT}` : ROOM_ANALYSIS_PROMPT;
  const ai = await callClaude({ env, messages:[{ role:'user', content:[
    { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
    { type:'text', text:prompt }
  ]}] });
  if (!ai.ok) return json({ error:ai.error }, 502, cors);
  return json(safeJSON(ai.text), 200, cors);
}

// ── /analyze-masterplan ───────────────────────────────────────────────────────
async function analyzeMasterplan(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);
  const { imageBase64, mimeType } = await request.json();
  if (!imageBase64) return json({ error:'imageBase64 required' }, 400, cors);
  const ai = await callClaude({ env, messages:[{ role:'user', content:[
    { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
    { type:'text', text:MASTERPLAN_PROMPT }
  ]}] });
  if (!ai.ok) return json({ error:ai.error }, 502, cors);
  const parsed = safeJSON(ai.text);
  // Always return what we have — let the client decide what to do with low confidence
  return json(parsed, 200, cors);
}

// ── /generate-render ──────────────────────────────────────────────────────────
async function generateRender(request, env, cors) {
  if (!env.AI) {
    return json({ ok:false, error:'Workers AI binding missing. Go to: Cloudflare → griha-worker → Settings → Bindings → Add → Workers AI → name it "AI" → Save and Deploy.' }, 503, cors);
  }
  let body;
  try { body = await request.json(); } catch(e) { return json({ ok:false, error:'Invalid JSON body' }, 400, cors); }

  const { room_type, design_style_id, compass_zone, palette_id, roomImageBase64 } = body;
  const stylePrompt = RENDER_STYLE_PROMPTS[design_style_id] || RENDER_STYLE_PROMPTS.contemporary_indian;
  const palDesc     = PALETTE_RENDER_DESCS[palette_id] || '';
  const roomLabel   = (room_type||'room').replace(/_/g,' ');
  const palCtx      = palDesc ? ` Colour scheme: ${palDesc}.` : '';

  try {
    let result;

    if (roomImageBase64) {
      // IMG2IMG — transforms the actual uploaded room photo
      // Input image should be 512x512 for SD v1.5 (resized client-side)
      const prompt = `Professional interior design photo of a ${roomLabel}. ${stylePrompt}.${palCtx} Photorealistic. High quality surfaces. Natural lighting. No people. Architectural photography.`;
      const negPrompt = 'people, text, watermark, cartoon, anime, blurry, distorted, low quality, furniture moved, new furniture';

      const binaryStr  = atob(roomImageBase64);
      const imageBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) imageBytes[i] = binaryStr.charCodeAt(i);

      result = await env.AI.run(IMAGE_MODEL_IMG2IMG, {
        prompt,
        negative_prompt: negPrompt,
        image:    [...imageBytes],
        strength: 0.72,   // strong enough to see changes, preserves room structure
        num_steps: 20,
        guidance:  8.0,
      });

    } else {
      // TXT2IMG fallback — no photo uploaded
      const prompt = `${roomLabel} interior design. ${stylePrompt}.${palCtx} Empty room showing walls, ceiling and floor only. No furniture. Professional interior photography. Ultra realistic.`;
      result = await env.AI.run(IMAGE_MODEL_TXT2IMG, {
        prompt,
        negative_prompt: 'people, furniture, text, watermark, cartoon, blurry, distorted',
        num_steps: 20,
        guidance:  7.5,
        width:     512,
        height:    512,
      });
    }

    // Convert stream to base64
    const arrayBuffer = await new Response(result).arrayBuffer();
    const uint8Array  = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize));
    }

    return json({
      ok: true,
      image_base64: btoa(binary),
      mime_type:    'image/png',
      mode:         roomImageBase64 ? 'img2img' : 'txt2img'
    }, 200, cors);

  } catch(err) {
    const msg = err.message || String(err);
    const detail =
      msg.includes('timeout')  ? 'Timed out — try a smaller photo (under 500KB). Use the resize in Settings.' :
      msg.includes('binding')  ? 'AI binding error — ensure Workers AI binding is named exactly "AI".' :
                                  msg;
    return json({ ok:false, error:`Render failed: ${detail}` }, 500, cors);
  }
}

// ── /suggest-changes (chat) ───────────────────────────────────────────────────
async function suggestChanges(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);

  let userMessage, currentAnalysis, conversationHistory;
  try {
    const body = await request.json();
    userMessage         = body.userMessage;
    currentAnalysis     = body.currentAnalysis;
    conversationHistory = body.conversationHistory || [];
  } catch(e) {
    return json({ error:'Invalid request body' }, 400, cors);
  }

  if (!userMessage) return json({ error:'userMessage required' }, 400, cors);

  // Build a compact context string — avoids sending large vastu objects
  let ctx = userMessage;
  if (currentAnalysis) {
    const parts = [];
    if (currentAnalysis.room_type)    parts.push(`Room: ${currentAnalysis.room_type}`);
    if (currentAnalysis.zone && currentAnalysis.zone !== 'unknown') parts.push(`Vastu zone: ${currentAnalysis.zone}`);
    if (currentAnalysis.vastu_score)  parts.push(`Vastu score: ${currentAnalysis.vastu_score}/100`);
    if (currentAnalysis.selected_style) parts.push(`Style: ${currentAnalysis.selected_style}`);
    if (currentAnalysis.sqft)         parts.push(`Room size: ${currentAnalysis.sqft} sqft`);
    if (parts.length) ctx = `[${parts.join(' | ')}]\n\nUser question: ${userMessage}`;
  }

  // Keep history short — just last 6 exchanges
  const history = (conversationHistory || []).slice(-6);

  const ai = await callClaude({
    env,
    system:     CHAT_SYSTEM,
    messages:   [...history, { role:'user', content:ctx }],
    max_tokens: 500
  });

  if (!ai.ok) return json({ ok:false, error:ai.error }, 502, cors);
  return json({ ok:true, reply:ai.text }, 200, cors);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function callClaude({ env, messages, system=null, max_tokens=1024 }) {
  const body = { model:AI_MODEL, max_tokens, messages };
  if (system) body.system = system;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      body:    JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({}));
      return { ok:false, error: err.error?.message || `Anthropic API error ${res.status}` };
    }
    const data = await res.json();
    return { ok:true, text: data.content?.[0]?.text || '' };
  } catch(e) {
    return { ok:false, error:`Network error reaching Anthropic: ${e.message}` };
  }
}

function safeJSON(text) {
  if (!text) return { error:'empty_response' };
  // Strip markdown code fences
  const clean = text.replace(/```(?:json)?\s*/gi,'').replace(/```/g,'').trim();
  // Try direct parse
  try { return JSON.parse(clean); } catch {}
  // Extract first JSON object
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  // Last resort — original text
  try { return JSON.parse(text); } catch {}
  return { error:'parse_failed', raw: text.slice(0,200) };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

function missingKey(cors) {
  return json({ error:'ANTHROPIC_API_KEY not configured. Go to Worker Settings → Variables and Secrets → add ANTHROPIC_API_KEY' }, 503, cors);
}
