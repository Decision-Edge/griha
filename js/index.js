/**
 * GRIHA CLOUDFLARE WORKER — v2
 * ============================
 * Handles: room photo analysis, masterplan analysis,
 * AI room renders (Stable Diffusion XL via CF AI binding),
 * and conversational chat (Claude).
 *
 * SECRETS NEEDED (Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  — from console.anthropic.com
 *
 * BINDINGS NEEDED (Settings → Bindings):
 *   AI  — Workers AI binding (for image generation, free)
 *
 * ENDPOINTS:
 *   GET  /health              — check all services are live
 *   POST /analyze-room        — analyse room photo with Claude vision
 *   POST /analyze-masterplan  — read floor plan for compass zones
 *   POST /generate-render     — generate AI room design image (SDXL)
 *   POST /suggest-changes     — conversational chat (Claude)
 */

const ALLOWED_ORIGIN = '*'; // Restrict to your domain before public launch
const AI_MODEL       = 'claude-opus-4-6';
const IMAGE_MODEL    = '@cf/stabilityai/stable-diffusion-xl-base-1.0';

// ── Design style prompts for room renders ──────────────────────────────────
// Edit these to change what each design style looks like in renders
const RENDER_STYLE_PROMPTS = {
  contemporary_indian:
    'contemporary Indian interior design, warm terracotta and earthy tones, solid sheesham wood furniture, brass accent lighting, handloom cotton textiles, block print cushions, indoor plants in northeast corner, warm ambient lighting, professional interior photography',
  minimalist_modern:
    'minimalist modern interior design, white and light grey tones, clean furniture lines, hidden storage, recessed LED lighting, linen textiles, uncluttered negative space, Scandinavian-influenced, professional interior photography',
  traditional_heritage:
    'traditional Indian heritage interior design, rich jewel tones, carved teak wood furniture, antique brass chandelier, silk and brocade textiles, traditional Indian motifs, Rajasthani jali screens, warm amber lighting, professional interior photography',
  boho_chic:
    'boho chic interior design, rattan and cane furniture, macramé wall hanging, indoor tropical plants, warm wheat and sage green tones, dhurrie rug, woven pendant light, layered global textiles, warm Edison bulb lighting, professional interior photography'
};

// ── Prompts ────────────────────────────────────────────────────────────────
const ROOM_ANALYSIS_PROMPT = `You are an expert interior design analyst specialising in Indian homes.
Analyse this room photo and return ONLY valid JSON — no text, no markdown, no code fences.

{
  "room_identified": true,
  "confidence": "high",
  "error": null,
  "observations": {
    "estimated_sqft": 160,
    "ceiling_height": "standard",
    "window_count": 1,
    "light_direction": "east",
    "light_quality": "bright",
    "overhead_beams_detected": false,
    "beam_positions": "not_applicable",
    "electrical_points_visible": 2,
    "electrical_point_positions": ["bedhead_wall", "opposite_wall"],
    "existing_furniture": ["bed", "wardrobe"],
    "wall_colours_existing": ["cream", "white"],
    "flooring_type": "tile",
    "style_detected": ["contemporary_indian"]
  }
}

Rules:
- confidence: "high" = clear photo, "medium" = slightly unclear, "low" = cannot analyse
- error: null OR "image_unclear" OR "not_a_room" OR "too_dark"
- ceiling_height: "low" (<8ft), "standard" (8-10ft), "high" (>10ft)
- light_direction: compass direction windows face — north/south/east/west/unknown
- light_quality: "bright", "moderate", "dim"
- beam_positions: "above_bed_zone", "above_seating", "central", "not_applicable"
- electrical_point_positions: array of "near_entrance","bedhead_wall","opposite_wall","side_wall","near_window","floor_level"
- style_detected: array of "minimalist","traditional","contemporary_indian","modern","boho_chic"
- If not a room or too dark: set room_identified false, error accordingly
Respond with ONLY the JSON.`;

const MASTERPLAN_PROMPT = `You are an expert architect reading an Indian builder floor plan.
Return ONLY valid JSON — no text, no markdown.

{
  "plan_identified": true,
  "confidence": "high",
  "error": null,
  "building": { "total_sqft": 1200, "bhk_type": "2BHK", "floors": 1 },
  "orientation": { "north_direction": "top", "main_entrance_direction": "east" },
  "rooms": [
    { "name": "master bedroom", "compass_zone": "SW", "approximate_sqft": 180, "has_window": true, "window_direction": "east" },
    { "name": "kitchen", "compass_zone": "SE", "approximate_sqft": 90, "has_window": true, "window_direction": "south" }
  ]
}

- compass_zone: one of NE,N,NW,E,W,SE,S,SW — dominant quadrant for each room
- If not a floor plan: plan_identified false, error "not_a_floorplan"
Respond with ONLY the JSON.`;

const CHAT_SYSTEM = `You are Griha's AI interior design assistant specialising in Vastu-compliant Indian interiors.
Help users refine their room designs. Keep responses concise (3-5 sentences max), specific, and actionable.
Always mention the Vastu rationale when making suggestions. 
When the user asks about colours, reference Asian Paints or Berger paint codes where possible.
When suggesting products, describe what to look for specifically (material, size range, price range in INR).
Never make up specific product names — describe what to look for instead.
Be warm and conversational — like a knowledgeable friend, not a formal consultant.`;

// ── Main handler ───────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type':                 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/health') {
        return json({
          status:     'ok',
          model:      AI_MODEL,
          ai_binding: !!(env.AI),
          version:    'v2'
        }, 200, cors);
      }

      if (request.method !== 'POST') {
        return json({ error: 'Use POST for analysis endpoints' }, 405, cors);
      }

      if (url.pathname === '/analyze-room')       return analyzeRoom(request, env, cors);
      if (url.pathname === '/analyze-masterplan') return analyzeMasterplan(request, env, cors);
      if (url.pathname === '/generate-render')    return generateRender(request, env, cors);
      if (url.pathname === '/suggest-changes')    return suggestChanges(request, env, cors);

      return json({ error: 'Not found', endpoints: ['/health','/analyze-room','/analyze-masterplan','/generate-render','/suggest-changes'] }, 404, cors);

    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: 'Internal error', detail: err.message }, 500, cors);
    }
  }
};

// ── /analyze-room ──────────────────────────────────────────────────────────
async function analyzeRoom(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);

  const { imageBase64, mimeType, roomLabel } = await request.json();
  if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400, cors);

  const prompt = roomLabel
    ? `Room label: "${roomLabel}"\n\n${ROOM_ANALYSIS_PROMPT}`
    : ROOM_ANALYSIS_PROMPT;

  const ai = await callClaude({
    env,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: prompt }
      ]
    }]
  });

  if (!ai.ok) return json({ error: ai.error }, 502, cors);
  return json(safeJSON(ai.text), 200, cors);
}

// ── /analyze-masterplan ────────────────────────────────────────────────────
async function analyzeMasterplan(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);

  const { imageBase64, mimeType } = await request.json();
  if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400, cors);

  const ai = await callClaude({
    env,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: MASTERPLAN_PROMPT }
      ]
    }]
  });

  if (!ai.ok) return json({ error: ai.error }, 502, cors);
  return json(safeJSON(ai.text), 200, cors);
}

// ── /generate-render ───────────────────────────────────────────────────────
// Uses Cloudflare Workers AI (Stable Diffusion XL) — free, no extra key needed
async function generateRender(request, env, cors) {
  if (!env.AI) {
    return json({
      ok: false,
      error: 'Workers AI binding missing. Go to: Cloudflare → griha-worker → Settings → Bindings → Add → Workers AI → name it exactly "AI" (capital letters) → Save and Deploy.'
    }, 503, cors);
  }

  let room_type, design_style_id, compass_zone, room_sqft, palette_desc;
  try {
    const body = await request.json();
    room_type       = body.room_type;
    design_style_id = body.design_style_id;
    compass_zone    = body.compass_zone;
    room_sqft       = body.room_sqft;
    palette_desc    = body.palette_desc || '';
  } catch(e) {
    return json({ ok: false, error: 'Invalid request body' }, 400, cors);
  }

  // Build a detailed prompt from the design style + room context + palette
  const stylePrompt  = RENDER_STYLE_PROMPTS[design_style_id] || RENDER_STYLE_PROMPTS.contemporary_indian;
  const roomContext  = `${room_sqft || 150} square foot ${(room_type || 'bedroom').replace(/_/g, ' ')}`;
  const zoneContext  = compass_zone && compass_zone !== 'unknown' ? `, ${compass_zone}-facing room` : '';
  const palContext   = palette_desc ? `, ${palette_desc}` : '';
  const fullPrompt   = `Photorealistic interior design render of a ${roomContext}${zoneContext}${palContext}, ${stylePrompt}, ultra realistic, 8K quality, professional interior photography, soft natural lighting, wide angle view showing full room, no people`;
  const negativePrompt = 'people, person, human, cartoon, anime, sketch, watermark, text, logo, blurry, low quality, distorted';

  try {
    const result = await env.AI.run(IMAGE_MODEL, {
      prompt:          fullPrompt,
      negative_prompt: negativePrompt,
      num_steps:       20,    // max on free plan
      guidance:        7.5,
      width:           768,   // smaller = faster, avoids timeout on free tier
      height:          512,
    });

    // CF Workers AI returns a ReadableStream — pipe through Response for reliable buffer
    const arrayBuffer = await new Response(result).arrayBuffer();
    const uint8Array  = new Uint8Array(arrayBuffer);

    // Convert to base64 in chunks to avoid stack overflow on large images
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);

    return json({
      ok:           true,
      image_base64: base64,
      mime_type:    'image/png',
      prompt_used:  fullPrompt,
      dimensions:   '768x512'
    }, 200, cors);

  } catch (err) {
    console.error('Image generation error:', err);
    // Common errors and their causes
    const msg = err.message || String(err);
    const detail =
      msg.includes('timeout')    ? 'Request timed out — try again. If this persists, the image dimensions may be too large for the free plan.' :
      msg.includes('model')       ? 'AI model error — check that the AI binding is correctly set up and named "AI".' :
      msg.includes('fetch')       ? 'Internal fetch error — the AI binding may not be properly connected.' :
                                    msg;
    return json({ ok: false, error: `Image generation failed: ${detail}` }, 500, cors);
  }
}

// ── /suggest-changes (chat) ────────────────────────────────────────────────
async function suggestChanges(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) return missingKey(cors);

  const { userMessage, currentAnalysis, conversationHistory = [] } = await request.json();
  if (!userMessage) return json({ error: 'userMessage is required' }, 400, cors);

  // Build context-aware user message
  let contextualMessage = userMessage;
  if (currentAnalysis) {
    const parts = [];
    if (currentAnalysis.room_type)  parts.push(`Room: ${currentAnalysis.room_type}`);
    if (currentAnalysis.zone)       parts.push(`Vastu zone: ${currentAnalysis.zone}`);
    if (currentAnalysis.vastu?.score !== undefined) parts.push(`Vastu score: ${currentAnalysis.vastu.score}/100`);
    if (currentAnalysis.selected_style) parts.push(`Selected design style: ${currentAnalysis.selected_style}`);
    if (parts.length) {
      contextualMessage = `[Context: ${parts.join(' | ')}]\n\nUser question: ${userMessage}`;
    }
  }

  // Keep conversation history bounded to last 10 turns
  const history = conversationHistory.slice(-10);

  const ai = await callClaude({
    env,
    system:   CHAT_SYSTEM,
    messages: [
      ...history,
      { role: 'user', content: contextualMessage }
    ],
    max_tokens: 600
  });

  if (!ai.ok) return json({ error: ai.error }, 502, cors);
  return json({ ok: true, reply: ai.text }, 200, cors);
}

// ── Claude API call ────────────────────────────────────────────────────────
async function callClaude({ env, messages, system = null, max_tokens = 1024 }) {
  const body = { model: AI_MODEL, max_tokens, messages };
  if (system) body.system = system;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error?.message || `Anthropic API error ${res.status}` };
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  return { ok: true, text };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function safeJSON(text) {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return { error: 'parse_failed', raw: text.slice(0, 200) };
  }
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}
function missingKey(cors) {
  return json({ error: 'ANTHROPIC_API_KEY not set. Go to Worker Settings → Variables and Secrets → Add → ANTHROPIC_API_KEY' }, 503, cors);
}
