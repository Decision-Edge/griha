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
// Uses img2img (SD v1.5) when the user uploads a photo — their actual room is
// the pixel-level base of the output. Strength 0.55 preserves room structure
// (walls, windows, proportions) while applying the style and palette on top.
// Falls back to SDXL txt2img if no photo is provided.
async function handleRender(req, env) {
  if (!env.AI) {
    return jsonRes({ ok:false, error:'Workers AI binding missing. Cloudflare → Settings → Bindings → Add → Workers AI → name "AI" → Save and Deploy.' }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const { design_style_id, palette_id, room_type, roomImageBase64, roomMimeType } = body;

  // ── Surface-change prompts for img2img ───────────────────────────────────────
  // Focus on SURFACES ONLY (walls, ceiling, floor) — not furniture.
  // Furniture is already in the photo; we want to restyle the shell.
  const SURFACE_PROMPTS = {
    contemporary_indian:
      'repaint walls warm terracotta and kaolin white, smooth plaster ceiling in warm white, polished natural stone floor in beige, warm ambient lighting, Indian contemporary style, high quality interior photography',
    minimalist_modern:
      'repaint walls pure linen white, smooth white ceiling, large-format light grey porcelain floor, soft natural light, minimalist style, high quality interior photography',
    traditional_heritage:
      'repaint walls deep ochre and burgundy, ornate plaster ceiling with gold border, dark teak herringbone floor, warm chandelier light, traditional Indian heritage style, high quality interior photography',
    boho_chic:
      'repaint walls sage green with raw plaster texture, terracotta encaustic cement floor tiles, warm Edison bulb lighting, bohemian chic style, high quality interior photography',
    industrial_modern:
      'exposed concrete walls, polished sealed concrete floor, anthracite ceiling, warm industrial Edison lighting, industrial modern style, high quality interior photography',
    art_deco_indian:
      'deep teal walls with gold geometric border stencil, ornate cream ceiling with cornice, black and gold geometric marble floor, antique brass sconce lighting, Art Deco Indian style',
    japandi:
      'warm greige washi-texture walls, pale oak ceiling detail, wide-plank light ash wood floor, soft diffused natural light, Japandi minimalist style, high quality interior photography',
    coastal_indian:
      'aquamarine limewash walls, whitewashed ceiling, pale weathered teak floor, natural rope texture, soft coastal light, coastal Indian style, high quality interior photography',
  };

  const PALETTE_PROMPTS = {
    warm_earthen:     'colour palette: warm terracotta #C47040 walls, kaolin cream #EAE1D5 ceiling, beige stone floor',
    sage_serenity:    'colour palette: sage green #779971 walls, pale moss #B5CDAC accent, white ceiling',
    terracotta_dawn:  'colour palette: burnt terracotta #9A4820 accent wall, peach #F5ECE1 main walls, warm floor',
    cloud_white:      'colour palette: pure white walls and ceiling, warm greige #C8BC9F floor tiles',
    monsoon_blue:     'colour palette: cerulean blue #5B8FAE accent wall, white walls, light grey floor',
    golden_hour:      'colour palette: warm gold #B07D20 accent, champagne cream walls, warm amber floor',
    forest_deep:      'colour palette: deep forest green #2B4D25 accent wall, pale sage #E8EEE6 walls, natural floor',
    blush_rose:       'colour palette: dusty rose #D4927B accent, warm cream #FAF0EA walls, warm floor',
    midnight_charcoal:'colour palette: warm charcoal #2C2C2A accent wall, warm grey walls, dark floor',
    coastal_sand:     'colour palette: aquamarine walls, coastal sand #DED3B8 floor, white ceiling',
  };

  const surfaces = SURFACE_PROMPTS[design_style_id] || SURFACE_PROMPTS.contemporary_indian;
  const colours  = PALETTE_PROMPTS[palette_id]      || PALETTE_PROMPTS.warm_earthen;
  const room     = (room_type || 'room').replace(/_/g, ' ');

  try {
    let imageBase64, mode;

    if (roomImageBase64) {
      // ── IMG2IMG: transform the user's actual uploaded room photo ──────────────
      // The user's photo is decoded and sent as the base image.
      // strength 0.55 = AI keeps 45% of original pixel structure (preserves room layout),
      //                  changes 55% (applies new surfaces, style, colours)
      const prompt = [
        `Interior design restyling of this ${room}.`,
        surfaces + '.',
        colours + '.',
        'Keep the same room layout, same furniture positions, same windows and doors.',
        'Only change wall colours, ceiling finish, and floor material.',
        'Ultra realistic interior photography. No people.',
      ].join(' ');

      const negPrompt = 'new furniture, moved furniture, different room layout, cartoon, blurry, distorted, watermark, text, people, low quality';

      const bin   = atob(roomImageBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      const result = await env.AI.run(IMG_MODEL_IMG2IMG, {
        prompt,
        negative_prompt: negPrompt,
        image:     [...bytes],
        strength:  0.55,   // low = preserves room structure; raise to 0.7 for more dramatic style change
        num_steps: 20,
        guidance:  9.0,    // high = strictly follows the prompt
      });

      const buf    = await new Response(result).arrayBuffer();
      const arr    = new Uint8Array(buf);
      let binary   = '';
      for (let i = 0; i < arr.length; i += 8192) {
        binary += String.fromCharCode(...arr.subarray(i, i + 8192));
      }
      imageBase64 = btoa(binary);
      mode = 'img2img';

    } else {
      // ── TXT2IMG fallback: no photo uploaded ───────────────────────────────────
      const prompt = [
        `Photorealistic professional interior design photograph of an Indian ${room}.`,
        surfaces + '.',
        colours + '.',
        'Soft natural lighting. Ultra realistic. Wide angle view. No people.',
      ].join(' ');

      const result = await env.AI.run(IMG_MODEL_XL, {
        prompt,
        negative_prompt: 'cartoon, blurry, distorted, text, watermark, people, low quality',
        num_steps: 20,
        guidance:  7.5,
        width:     1024,
        height:    768,
      });

      const buf    = await new Response(result).arrayBuffer();
      const arr    = new Uint8Array(buf);
      let binary   = '';
      for (let i = 0; i < arr.length; i += 8192) {
        binary += String.fromCharCode(...arr.subarray(i, i + 8192));
      }
      imageBase64 = btoa(binary);
      mode = 'txt2img';
    }

    return jsonRes({ ok:true, image_base64:imageBase64, mime_type:'image/png', mode });

  } catch(e) {
    console.error('Render error:', e.message);
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
