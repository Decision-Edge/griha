/**
 * GRIHA AI WORKER — v5
 * Endpoints: /health /validate-photo /analyze-room /analyze-masterplan /generate-render /suggest-changes
 * Secrets:   ANTHROPIC_API_KEY
 * Bindings:  AI (Workers AI)
 */
const ANTHROPIC_MODEL   = 'claude-opus-4-6';
const IMG_MODEL_XL      = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const IMG_MODEL_IMG2IMG = '@cf/runwayml/stable-diffusion-v1-5-img2img';

// Always added to every response — including error responses from the platform
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function addCors(response) {
  const r = new Response(response.body, response);
  Object.entries(CORS_HEADERS).forEach(([k,v]) => r.headers.set(k,v));
  return r;
}

function jsonRes(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type':'application/json' }
  });
}

export default {
  async fetch(req, env) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status:204, headers:CORS_HEADERS });
    }

    try {
      const response = await handleRequest(req, env);
      return addCors(response);
    } catch(e) {
      console.error('Unhandled worker error:', e);
      return jsonRes({ error: e.message || 'Internal server error' }, 500);
    }
  }
};

async function handleRequest(req, env) {
  const path = new URL(req.url).pathname;
  const res  = jsonRes; // alias

  if (path === '/health') return jsonRes({
    status:'ok', version:'v5',
    has_key: !!(env.ANTHROPIC_API_KEY),
    has_ai:  !!(env.AI)
  });

  if (req.method !== 'POST') return jsonRes({ error:'POST required' }, 405);

  if (path === '/validate-photo')     return handleValidate(req, env);
  if (path === '/analyze-room')       return handleAnalyze(req, env);
  if (path === '/analyze-masterplan') return handleMasterplan(req, env);
  if (path === '/generate-render')    return handleRender(req, env);
  if (path === '/suggest-changes')    return handleChat(req, env);

  return jsonRes({ error:'Unknown endpoint' }, 404);
}

// ── VALIDATE PHOTO ──────────────────────────────────────────────────────────
async function handleValidate(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ is_valid_room:true, _skipped:true, reason:'No API key' });
  try {
    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) return jsonRes({ is_valid_room:true, _skipped:true });

    const reply = await claude(env, [{
      role: 'user',
      content: [
        { type:'image', source:{ type:'base64', media_type: mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text', text:'Is this image an interior room of a building? Reply ONLY with valid JSON: {"is_valid_room":true} or {"is_valid_room":false,"reason":"brief reason"}. No markdown.' }
      ]
    }], null, 80);

    const parsed = parseJSON(reply);
    if (typeof parsed.is_valid_room !== 'boolean') return jsonRes({ is_valid_room:true, _skipped:true });
    return jsonRes(parsed);
  } catch(e) {
    return jsonRes({ is_valid_room:true, _skipped:true });
  }
}

// ── ANALYZE ROOM ─────────────────────────────────────────────────────────────
async function handleAnalyze(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set' });
  const { imageBase64, mimeType, roomLabel } = await req.json();
  if (!imageBase64) return jsonRes({ ok:false, error:'imageBase64 required' }, 400);

  const prompt = `You are an expert interior design analyst for Indian homes.
Analyse this ${roomLabel||'room'} photo and return ONLY this JSON (no markdown, no text before or after):
{"room_identified":true,"confidence":"high","observations":{"estimated_sqft":160,"ceiling_height":"standard","ceiling_type":"flat","window_count":1,"light_direction":"east","light_quality":"bright","natural_light_assessment":"Good natural light","overhead_beams_detected":false,"beam_count":0,"electrical_points_visible":2,"electrical_point_positions":["near_door","opposite_wall"],"existing_furniture":["bed","wardrobe"],"wall_colours_existing":["white"],"flooring_type":"vitrified_tile","flooring_colour":"beige","ceiling_colour":"white","wall_condition":"good","style_detected":["contemporary_indian"],"vastu_observations":{"sleeping_head_direction_visible":"unknown","mirror_facing_bed":false}}}

Replace all values with what you actually observe in the photo. Return ONLY the JSON.`;

  const reply = await claude(env, [{
    role:'user',
    content:[
      { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
      { type:'text', text:prompt }
    ]
  }]);

  return jsonRes(parseJSON(reply));
}

// ── ANALYZE MASTERPLAN ───────────────────────────────────────────────────────
async function handleMasterplan(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set' });

  const { imageBase64, mimeType } = await req.json();
  if (!imageBase64) return jsonRes({ ok:false, error:'imageBase64 required' }, 400);

  // Validate the base64 isn't empty
  if (imageBase64.length < 100) return jsonRes({ plan_identified:false, error:'image_too_small' });

  const system = 'You are an expert architect. You ONLY respond with valid JSON. Never use markdown. Never add explanation. Only output the JSON object.';

  const prompt = `Look at this floor plan image carefully.

If it IS a floor plan showing rooms, return this JSON with actual values observed:
{"plan_identified":true,"direction_confidence":"high","direction_clarity_note":null,"building":{"total_sqft":1200,"bhk_type":"2BHK"},"orientation":{"north_direction":"top","north_source":"compass_rose","main_entrance_direction":"east"},"rooms":[{"name":"master bedroom","compass_zone":"SW","approximate_sqft":180},{"name":"kitchen","compass_zone":"SE","approximate_sqft":90},{"name":"living room","compass_zone":"N","approximate_sqft":220}]}

If it is NOT a floor plan, return:
{"plan_identified":false,"error":"not_a_floorplan"}

Rules:
- direction_confidence: "high" only if you can see a compass rose or north arrow. "medium" if you can infer from labels. "low" if completely unknown.
- direction_clarity_note: null if high confidence. A one-sentence explanation if medium or low.
- north_source: one of "compass_rose", "north_arrow", "label_inference", "unknown"
- compass_zone: one of N, NE, E, SE, S, SW, W, NW
- List every room you can identify in the rooms array
- Replace all example values with what you actually see in this image

Output ONLY the JSON. Nothing else.`;

  try {
    const reply = await claude(env, [{
      role:'user',
      content:[
        { type:'image', source:{ type:'base64', media_type: mimeType || 'image/jpeg', data:imageBase64 } },
        { type:'text', text:prompt }
      ]
    }], system, 1000);

    if (!reply) return jsonRes({ plan_identified:false, error:'empty_response' });

    const parsed = parseJSON(reply);

    // If parsing failed, return a useful error
    if (parsed.error === 'parse_failed') {
      return jsonRes({
        plan_identified: false,
        error: 'could_not_parse',
        raw: parsed.raw
      });
    }

    return jsonRes({ ok:true, ...parsed });

  } catch(e) {
    console.error('Masterplan error:', e.message);
    return jsonRes({
      ok: false,
      plan_identified: false,
      error: e.message.includes('image') || e.message.includes('size') || e.message.includes('large')
        ? 'image_too_large — please use a smaller floor plan image (under 2MB)'
        : e.message
    }, 500);
  }
}

// ── GENERATE RENDER ──────────────────────────────────────────────────────────
// Step 1: Claude Vision reads the user's room photo → extracts architectural features
// Step 2: SDXL generates a 1024×768 image that matches THAT SPECIFIC room's layout
async function handleRender(req, env) {
  if (!env.AI) {
    return jsonRes({ ok:false, error:'Workers AI binding missing. Cloudflare → griha-worker → Settings → Bindings → Add → Workers AI → name it "AI" → Save and Deploy.' }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const { design_style_id, palette_id, room_type, roomImageBase64, roomMimeType } = body;

  const STYLES = {
    contemporary_indian:  'contemporary Indian interior, warm terracotta accent wall, kaolin clay white walls, sheesham wood furniture, brass pendant light, handloom textiles, indoor plants, warm amber lighting',
    minimalist_modern:    'minimalist modern interior, pure linen white walls, smooth white ceiling, large-format light grey porcelain floor, clean-lined furniture, recessed LED lighting, Scandinavian simplicity',
    traditional_heritage: 'traditional Indian heritage interior, deep ochre and burgundy walls, ornate plaster ceiling with gold, dark teak herringbone floor, antique brass chandelier, carved wooden furniture, rich brocade',
    boho_chic:            'boho chic interior, sage green walls, raw plaster accent wall, terracotta cement tiles, macrame wall hanging, rattan furniture, layered dhurrie rug, Edison bulb lighting, tropical plants',
    industrial_modern:    'industrial modern interior, exposed raw concrete walls, polished concrete floor, anthracite ceiling, exposed brick feature wall, minimal steel furniture',
    art_deco_indian:      'Art Deco Indian interior, deep teal walls with gold geometric border, ornate cream ceiling with cornice, black and gold marble floor, antique brass accents',
    japandi:              'Japandi interior, warm greige washi walls, pale oak ceiling beams, wide-plank ash wood floor, minimal furniture, wabi-sabi plaster, soft diffused light',
    coastal_indian:       'coastal Indian interior, aquamarine limewash walls, whitewashed wooden ceiling, pale weathered teak floor, natural rope texture, light linen curtains',
  };
  const PALETTES = {
    warm_earthen:     'colour scheme: warm terracotta, tawny brown, kaolin cream',
    sage_serenity:    'colour scheme: sage green, pale moss, crisp white',
    terracotta_dawn:  'colour scheme: burnt terracotta, brick red, warm peach',
    cloud_white:      'colour scheme: pure white, warm ivory, soft greige',
    monsoon_blue:     'colour scheme: cerulean blue, deep navy, arctic white',
    golden_hour:      'colour scheme: warm gold, amber, champagne cream',
    forest_deep:      'colour scheme: forest green, dark fern, pale sage',
    blush_rose:       'colour scheme: dusty rose, muted blush, warm cream',
    midnight_charcoal:'colour scheme: warm charcoal, dark slate, warm grey',
    coastal_sand:     'colour scheme: coastal sand, bleached driftwood, sea foam',
  };

  const style   = STYLES[design_style_id]  || STYLES.contemporary_indian;
  const palette = PALETTES[palette_id]     || PALETTES.warm_earthen;
  const room    = (room_type || 'room').replace(/_/g, ' ');

  // ── Step 1: Claude Vision reads the room photo ──
  let roomDescription = '';
  if (roomImageBase64 && env.ANTHROPIC_API_KEY) {
    try {
      const desc = await claude(env, [{
        role: 'user',
        content: [
          { type:'image', source:{ type:'base64', media_type: roomMimeType||'image/jpeg', data: roomImageBase64 } },
          { type:'text',  text: 'Describe the fixed architectural features of this room in one short sentence. Include: window count and positions, door positions, ceiling height, ceiling type, floor type, any built-in features. Do not mention furniture, colours, or decor. Be specific and concise. Example: "One large window on east wall, one door on north, standard 9-foot flat ceiling, vitrified tile floor, built-in wardrobe on west wall."' }
        ]
      }], null, 150);
      if (desc && desc.length > 15) roomDescription = desc.trim();
    } catch(e) {
      // Non-fatal — continue without room-specific details
      console.warn('Vision step failed:', e.message);
    }
  }

  // ── Step 2: Build prompt incorporating the actual room's architecture ──
  const roomContext = roomDescription
    ? `The room has this specific layout and architecture: ${roomDescription}.`
    : `A typical Indian ${room}.`;

  const prompt = [
    `Photorealistic professional interior design photograph of an Indian ${room}.`,
    roomContext,
    `Redesigned in ${style}.`,
    `${palette}.`,
    'Soft natural lighting. Ultra realistic. High detail. Wide angle view showing full room. No people.',
  ].join(' ');

  const negPrompt = 'cartoon, anime, sketch, watermark, text, blurry, distorted, low quality, people, person, human, unrealistic proportions';

  // ── Step 3: Generate with SDXL ──
  try {
    const result = await env.AI.run(IMG_MODEL_XL, {
      prompt,
      negative_prompt: negPrompt,
      num_steps: 20,
      guidance:  7.5,
      width:     1024,
      height:    768,
    });

    const buf   = await new Response(result).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary  = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }

    return jsonRes({
      ok:               true,
      image_base64:     btoa(binary),
      mime_type:        'image/png',
      mode:             roomImageBase64 ? 'vision_guided' : 'style_only',
      room_description: roomDescription || null,
    });

  } catch(e) {
    return jsonRes({ ok:false, error:`Render failed: ${e.message}` }, 500);
  }
}


// ── CHAT ─────────────────────────────────────────────────────────────────────
async function handleChat(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set in Worker secrets.' });

  let body;
  try { body = await req.json(); } catch(e) { return jsonRes({ ok:false, error:'Invalid JSON body' }, 400); }

  const { userMessage, currentAnalysis, conversationHistory=[] } = body;
  if (!userMessage) return jsonRes({ ok:false, error:'userMessage required' }, 400);

  const system = `You are Griha, an AI interior design assistant specialising in Vastu-compliant Indian homes.
Help users with surface design (walls, paint, ceiling, flooring), Vastu compliance, and colour recommendations.
Be specific — mention Asian Paints or Berger paint codes when relevant. Keep responses to 3-4 sentences.`;

  // Compact context string
  const context = currentAnalysis
    ? `[Room: ${currentAnalysis.room_type||'unknown'} | Zone: ${currentAnalysis.zone||'unknown'} | Vastu score: ${currentAnalysis.vastu_score||'?'}/100 | Style: ${currentAnalysis.selected_style||'not set'}]`
    : '';

  const messages = [
    ...conversationHistory.slice(-8),
    { role:'user', content: context ? `${context}\n\nQuestion: ${userMessage}` : userMessage }
  ];

  const reply = await claude(env, messages, system, 400);
  if (!reply) return jsonRes({ ok:false, error:'Empty response from AI. Try again.' });

  return jsonRes({ ok:true, reply });
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function claude(env, messages, system=null, max_tokens=1024) {
  const body = { model:ANTHROPIC_MODEL, max_tokens, messages };
  if (system) body.system = system;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const err = await r.json().catch(()=>({error:{message:`HTTP ${r.status}`}}));
    throw new Error(err.error?.message || `Anthropic returned ${r.status}`);
  }

  const d = await r.json();
  return d.content?.[0]?.text || '';
}

function parseJSON(text) {
  if (!text) return { error:'empty' };
  // Strip markdown fences
  const c = text.replace(/```(?:json)?\s*/gi,'').replace(/```/g,'').trim();
  try { return JSON.parse(c); } catch {}
  const m = c.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return { error:'parse_failed', raw:text.slice(0,100) };
}
