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

  const prompt = `Analyse this floor plan image. Return ONLY this JSON (no markdown, no text before/after):
{"plan_identified":true,"confidence":"high","direction_confidence":"high","direction_clarity_note":null,"building":{"total_sqft":1200,"bhk_type":"2BHK"},"orientation":{"north_direction":"top","north_source":"compass_rose","main_entrance_direction":"east"},"rooms":[{"name":"master bedroom","compass_zone":"SW","approximate_sqft":180},{"name":"kitchen","compass_zone":"SE","approximate_sqft":90}]}

If NOT a floor plan: {"plan_identified":false,"error":"not_a_floorplan"}
direction_confidence: "high" if compass/north arrow visible, "medium" if inferred, "low" if unknown
direction_clarity_note: null if high, brief explanation if medium/low
Return ONLY the JSON.`;

  const reply = await claude(env, [{
    role:'user',
    content:[
      { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
      { type:'text', text:prompt }
    ]
  }]);

  const parsed = parseJSON(reply);
  return jsonRes({ ok:true, ...parsed });
}

// ── GENERATE RENDER ──────────────────────────────────────────────────────────
async function handleRender(req, env) {
  if (!env.AI) return jsonRes({ ok:false, error:'Workers AI binding missing. Go to Worker Settings → Bindings → Add → Workers AI → name it "AI" → Save and Deploy.' }, 503);

  const { design_style_id, palette_id, room_type, roomImageBase64 } = await req.json();

  const STYLES = {
    contemporary_indian:  'contemporary Indian interior, warm terracotta walls, kaolin clay ceiling, polished stone floors, brass accents, handloom textiles, indoor plants',
    minimalist_modern:    'minimalist modern interior, pure white walls, smooth white ceiling, large-format grey porcelain floor, clean architectural lines, recessed lighting',
    traditional_heritage: 'traditional Indian heritage interior, deep ochre and burgundy walls, ornate plaster ceiling, dark teak herringbone floor, antique brass fixtures',
    boho_chic:            'bohemian chic interior, sage green walls, raw plaster feature wall, terracotta tile floor, macrame wall hanging, natural rattan',
    industrial_modern:    'industrial modern interior, exposed concrete walls and ceiling, polished concrete floor, raw brick feature wall, steel accents',
    art_deco_indian:      'Art Deco Indian interior, deep teal walls with gold geometric borders, ornate cream ceiling, black and gold marble floor',
    japandi:              'Japandi interior, warm greige walls, pale oak ceiling beams, wide plank light wood floor, wabi-sabi plaster texture',
    coastal_indian:       'coastal Indian interior, aquamarine limewash walls, whitewashed ceiling, pale teak floor, natural rope texture',
  };
  const PALETTES = {
    warm_earthen:    'terracotta, warm brown, kaolin cream',
    sage_serenity:   'sage green, pale moss, morning white',
    terracotta_dawn: 'burnt terracotta, brick red, peach',
    cloud_white:     'pure white, warm ivory, soft greige',
    monsoon_blue:    'cerulean blue, deep navy, arctic white',
    golden_hour:     'warm gold, amber, champagne',
    forest_deep:     'forest green, dark fern, pale sage',
    blush_rose:      'dusty rose, muted blush, warm cream',
    midnight_charcoal:'charcoal, dark slate, warm grey',
    coastal_sand:    'coastal sand, driftwood, seafoam',
  };

  const style   = STYLES[design_style_id]   || STYLES.contemporary_indian;
  const palette = PALETTES[palette_id]       || PALETTES.warm_earthen;
  const room    = (room_type||'bedroom').replace(/_/g,' ');

  try {
    let result;

    if (roomImageBase64) {
      // IMG2IMG — applies style to uploaded photo
      const bin = atob(roomImageBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);

      result = await env.AI.run(IMG_MODEL_IMG2IMG, {
        prompt: `${style}, colour palette: ${palette}, professional interior photography, ultra realistic, no people`,
        negative_prompt: 'people, person, cartoon, blurry, distorted, text, watermark, low quality',
        image: [...bytes],
        strength: 0.75,
        num_steps: 20,
        guidance: 8,
      });
    } else {
      // TXT2IMG fallback — higher quality output
      result = await env.AI.run(IMG_MODEL_XL, {
        prompt: `Photorealistic ${room} with ${style}. Colour palette: ${palette}. Professional interior photography. No people. 8K quality.`,
        negative_prompt: 'people, cartoon, blurry, text, watermark, low quality, distorted',
        num_steps: 20,
        guidance: 7.5,
        width: 1024,
        height: 768,
      });
    }

    // Convert stream → base64
    const buf   = await new Response(result).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary  = '';
    for (let i=0; i<bytes.length; i+=8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i+8192));
    }

    return jsonRes({ ok:true, image_base64:btoa(binary), mime_type:'image/png', mode:roomImageBase64?'img2img':'txt2img' });

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
