/**
 * GRIHA AI WORKER — v7
 * Endpoints: /health /debug /validate-photo /analyze-room /analyze-masterplan /generate-render /suggest-changes
 * Secrets:   ANTHROPIC_API_KEY, STABILITY_API_KEY (optional fallback)
 * Bindings:  AI (Workers AI), RATE_KV (KV namespace)
 */

const MODEL = 'claude-opus-4-6';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonRes(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers:{...CORS,'Content-Type':'application/json'} });
}
function addCors(r) {
  const res = new Response(r.body, r);
  Object.entries(CORS).forEach(([k,v])=>res.headers.set(k,v));
  return res;
}
function getClientIP(req) {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

// ── Rate limiting (disabled during development) ──────────────────────────────
async function checkRateLimit(env, ip, type) {
  // TODO: re-enable before launch
  return { allowed: true };
}
async function consumeCredit(env, ip, type) {
  // TODO: re-enable before launch
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:CORS });
    try {
      return addCors(await route(req, env));
    } catch(e) {
      console.error('Worker error:', e.message);
      return jsonRes({ error:e.message }, 500);
    }
  }
};

async function route(req, env) {
  const path = new URL(req.url).pathname;

  if (path === '/health') return jsonRes({
    status:'ok', version:'v7',
    has_anthropic_key: !!(env.ANTHROPIC_API_KEY),
    has_stability_key: !!(env.STABILITY_API_KEY),
    has_rate_kv:       !!(env.RATE_KV),
    has_ai:            !!(env.AI),
  });

  if (path === '/debug') return jsonRes({
    has_anthropic_key: !!(env.ANTHROPIC_API_KEY),
    has_stability_key: !!(env.STABILITY_API_KEY),
    has_rate_kv:       !!(env.RATE_KV),
    has_ai_binding:    !!(env.AI),
    version: 'v7',
    notes: {
      fix_500:  !env.ANTHROPIC_API_KEY ? 'Add ANTHROPIC_API_KEY in Worker Settings → Variables and Secrets' : 'OK',
      fix_503:  !env.AI ? 'Add Workers AI binding: Settings → Bindings → Add → Workers AI → name "AI"' : 'OK',
    }
  });

  // Test Segmind connection — GET this in browser to see exact error
  if (path === '/test-segmind') {
    if (!env.SEGMIND_API_KEY) return jsonRes({ error:'SEGMIND_API_KEY not set' });
    // Call with a minimal 1x1 pixel image to test auth and endpoint
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const r = await fetch('https://api.segmind.com/v1/sdxl-controlnet', {
      method: 'POST',
      headers: { 'x-api-key': env.SEGMIND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: pixel, prompt: 'test', samples: 1,
        scheduler: 'DPM++ 2M Karras', num_inference_steps: 10,
        guidance_scale: 1, strength: 0.1, seed: 1,
        img_width: 512, img_height: 512, base64: false,
      }),
    });
    const text = await r.text();
    const isFormatOk = r.status === 406 || r.status === 200;
    return jsonRes({
      status:         r.status,
      format_accepted: isFormatOk,
      needs_credits:  r.status === 406,
      body:           text.slice(0, 300),
      verdict:        r.status === 200 ? 'WORKING - ready to render' :
                      r.status === 406 ? 'FORMAT OK - just add credits at cloud.segmind.com/billing' :
                      r.status === 401 ? 'INVALID API KEY' :
                      'UNEXPECTED ERROR - check body above'
    });
  }

  if (req.method !== 'POST') return jsonRes({ error:'POST required' }, 405);

  if (path === '/validate-photo')     return handleValidate(req, env);
  if (path === '/analyze-room')       return handleAnalyze(req, env);
  if (path === '/analyze-masterplan') return handleMasterplan(req, env);
  if (path === '/generate-render')    return handleRender(req, env);
  if (path === '/suggest-changes')    return handleChat(req, env);

  return jsonRes({ error:'Not found' }, 404);
}

// ── /validate-photo ──────────────────────────────────────────────────────────
async function handleValidate(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ is_valid_room:true, _skipped:true });
  try {
    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) return jsonRes({ is_valid_room:true, _skipped:true });
    const reply = await callClaude(env, [{
      role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text',  text:'Is this an interior room photo? Reply ONLY with JSON: {"is_valid_room":true} or {"is_valid_room":false,"reason":"..."}. No markdown.' }
      ]
    }], null, 80);
    const d = parseJSON(reply);
    if (typeof d.is_valid_room !== 'boolean') return jsonRes({ is_valid_room:true, _skipped:true });
    return jsonRes(d);
  } catch(e) { return jsonRes({ is_valid_room:true, _skipped:true }); }
}

// ── /analyze-room ─────────────────────────────────────────────────────────────
async function handleAnalyze(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set in Worker Settings → Variables and Secrets.' });

  const ip = getClientIP(req);
  try {
    const rc = await checkRateLimit(env, ip, 'analysis');
    if (!rc.allowed) return jsonRes({
      ok:false, limit_reached:true, type:'analysis',
      message:"You've used your free room analysis. Buy a credit pack to analyse more rooms.",
      packs:[
        { name:'Starter',   price:299, includes:'3 rooms + 5 renders',      tag:'starter'   },
        { name:'Full Home', price:799, includes:'Unlimited rooms + renders', tag:'full_home' }
      ]
    }, 429);
  } catch(e) {}

  try {
    const { imageBase64, mimeType, roomLabel } = await req.json();
    if (!imageBase64) return jsonRes({ ok:false, error:'No image received.' }, 400);
    if (imageBase64.length > 6_800_000) return jsonRes({ ok:false, error:'Photo too large. Please use under 3MB.' }, 413);

    const reply = await callClaude(env, [{
      role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text',  text:`Analyse this ${roomLabel||'room'} photo. Return ONLY valid JSON, no markdown:\n{"room_identified":true,"confidence":"high","observations":{"estimated_sqft":160,"ceiling_height":"standard","ceiling_type":"flat","window_count":1,"light_direction":"east","light_quality":"bright","natural_light_assessment":"Good natural light","overhead_beams_detected":false,"beam_count":0,"electrical_points_visible":2,"electrical_point_positions":["near_door","opposite_wall"],"existing_furniture":["bed","wardrobe"],"wall_colours_existing":["white"],"flooring_type":"vitrified_tile","flooring_colour":"beige","ceiling_colour":"white","wall_condition":"good","style_detected":["contemporary_indian"],"vastu_observations":{"sleeping_head_direction_visible":"unknown","mirror_facing_bed":false}}}\nReplace all values with what you actually observe.` }
      ]
    }]);

    const parsed = parseJSON(reply);
    if (!parsed.observations) return jsonRes(fallback('Parse failed'));
    try { await consumeCredit(env, ip, 'analysis'); } catch(e) {}
    return jsonRes(parsed);
  } catch(e) {
    console.error('analyzeRoom error:', e.message);
    return jsonRes(fallback(e.message));
  }
}

// ── /analyze-masterplan ───────────────────────────────────────────────────────
async function handleMasterplan(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set.' });
  try {
    const { imageBase64, mimeType } = await req.json();
    const reply = await callClaude(env, [{
      role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text',  text:'Analyse this floor plan. Return ONLY JSON:\n{"plan_identified":true,"direction_confidence":"high","direction_clarity_note":null,"building":{"total_sqft":1200,"bhk_type":"2BHK"},"orientation":{"north_direction":"top","north_source":"compass_rose","main_entrance_direction":"east"},"rooms":[{"name":"master bedroom","compass_zone":"SW","approximate_sqft":180}]}\nIf not a floor plan: {"plan_identified":false,"error":"not_a_floorplan"}\ndirection_confidence: high=compass visible, medium=inferred, low=unknown' }
      ]
    }], 'You are an expert architect. Reply only with valid JSON.', 500);
    return jsonRes({ ok:true, ...parseJSON(reply) });
  } catch(e) { return jsonRes({ ok:false, error:e.message }, 500); }
}

// ── /generate-render — Segmind SDXL img2img ─────────────────────────────────
// Segmind API: pure JSON, base64 in/out, no multipart, fast (<15s)
// Endpoint: api.segmind.com/v1/sdxl-controlnet — ControlNet with edge detection
// Requires: SEGMIND_API_KEY in Worker Settings → Variables and Secrets
// Get key at: segmind.com → Sign up → Dashboard → API Key
async function handleRender(req, env) {
  if (!env.SEGMIND_API_KEY) {
    return jsonRes({ ok:false, error:'SEGMIND_API_KEY not set. Sign up at segmind.com → Dashboard → API Key → add as secret SEGMIND_API_KEY in Cloudflare Worker settings.' }, 503);
  }

  const { design_style_id, palette_id, room_type, roomImageBase64 } = await req.json().catch(()=>({}));

  if (!roomImageBase64) {
    return jsonRes({ ok:false, error:'No room photo provided. Please upload a room photo first.' }, 400);
  }

  const STYLES = {
    contemporary_indian:  'warm terracotta orange walls, polished beige stone floor, white ceiling, Indian contemporary interior',
    minimalist_modern:    'pure white walls, large light grey porcelain floor tiles, white ceiling, minimalist Scandinavian interior',
    traditional_heritage: 'deep ochre yellow walls with burgundy dado panel, dark teak herringbone wood floor, cream ceiling with gold cornice, traditional Indian interior',
    boho_chic:            'sage green walls, terracotta patterned cement floor tiles, white ceiling, bohemian chic interior',
    industrial_modern:    'raw grey concrete walls, dark polished concrete floor, dark anthracite ceiling, industrial modern interior',
    art_deco_indian:      'deep teal walls with gold geometric border, black and gold marble floor, cream ceiling with gold cornice, Art Deco Indian interior',
    japandi:              'warm greige walls, pale ash wood floor, white ceiling with natural wood beam, Japandi interior',
    coastal_indian:       'aquamarine limewash walls, pale teak wood floor, white ceiling, coastal Indian interior',
  };

  const PALETTES = {
    warm_earthen:     'terracotta #C47040 and cream #EAE1D5',
    sage_serenity:    'sage green #779971 and mist white #E8EEE6',
    terracotta_dawn:  'burnt terracotta #9A4820 and peach #F5ECE1',
    cloud_white:      'pure white #F5F0E8 and greige #C8BC9F',
    monsoon_blue:     'cerulean blue #5B8FAE and arctic white #EBF0F5',
    golden_hour:      'warm gold #B07D20 and champagne #F4EAD5',
    forest_deep:      'forest green #2B4D25 and pale sage #E8EEE6',
    blush_rose:       'dusty rose #D4927B and warm cream #FAF0EA',
    midnight_charcoal:'charcoal #2C2C2A and warm grey #8C8C8A',
    coastal_sand:     'coastal sand #DED3B8 and seafoam #E8EDE6',
  };

  const style   = STYLES[design_style_id]  || STYLES.contemporary_indian;
  const palette = PALETTES[palette_id]     || PALETTES.warm_earthen;
  const room    = (room_type || 'room').replace(/_/g, ' ');

  const prompt = `Same ${room} with restyled surfaces only. ${style}. Colour palette: ${palette}. Keep all furniture, windows, doors and room layout exactly identical. Only walls, floor and ceiling are changed. Photorealistic interior photography. No people.`;

  const negPrompt = 'different room, moved furniture, new furniture, different windows, different layout, cartoon, blurry, distorted, watermark, text, people, low quality, painting, sketch';

  try {
    // sdxl-controlnet: locks your room's exact structure via edge detection
    // then applies style/colour changes. Better than img2img for room relevance.
    const response = await fetch('https://api.segmind.com/v1/sdxl-controlnet', {
      method:  'POST',
      headers: { 'x-api-key': env.SEGMIND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image:               roomImageBase64,
        prompt,
        negative_prompt:     negPrompt,
        samples:             1,
        scheduler:           'DPM++ 2M Karras',
        num_inference_steps: 30,
        guidance_scale:      8,
        controlnet_scale:    0.8,
        seed:                12345,
        base64:              false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let errMsg = errText.slice(0, 300);
      try { errMsg = JSON.parse(errText).error || errMsg; } catch {}
      console.error('Segmind error', response.status, errMsg);
      if (response.status === 401 || response.status === 403) return jsonRes({ ok:false, error:'Invalid SEGMIND_API_KEY.' });
      if (response.status === 402 || response.status === 406) return jsonRes({ ok:false, error:'No Segmind credits. Top up at cloud.segmind.com/billing?type=TOPUP' });
      if (response.status === 429) return jsonRes({ ok:false, error:'Segmind rate limit. Wait a moment.' });
      return jsonRes({ ok:false, error:'Segmind ' + response.status + ': ' + errMsg }, 502);
    }

    // base64:false → Segmind returns raw image bytes (image/jpeg)
    const imgBuf  = await response.arrayBuffer();
    const imgArr  = new Uint8Array(imgBuf);
    let binary    = '';
    for (let i = 0; i < imgArr.length; i += 8192) {
      binary += String.fromCharCode(...imgArr.subarray(i, i + 8192));
    }
    const b64 = btoa(binary);
    if (!b64) return jsonRes({ ok:false, error:'No image returned from Segmind.' }, 502);

    return jsonRes({ ok:true, image_base64:b64, mime_type:'image/jpeg', mode:'img2img' });

  } catch(e) {
    console.error('Render error:', e.message);
    return jsonRes({ ok:false, error:'Render failed: ' + e.message }, 500);
  }
}


// ── /suggest-changes (chat) ───────────────────────────────────────────────────
async function handleChat(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set.' });
  try {
    const { userMessage, currentAnalysis, conversationHistory=[] } = await req.json();
    if (!userMessage) return jsonRes({ ok:false, error:'userMessage required' }, 400);

    const ctx = currentAnalysis
      ? `[Room: ${currentAnalysis.room_type||'?'} | Zone: ${currentAnalysis.zone||'?'} | Vastu: ${currentAnalysis.vastu_score||'?'}/100 | Style: ${currentAnalysis.selected_style||'?'}]\n\n${userMessage}`
      : userMessage;

    const reply = await callClaude(env,
      [...conversationHistory.slice(-8), { role:'user', content:ctx }],
      'You are Griha, an AI interior design assistant for Indian homes. Give specific, helpful advice about Vastu compliance, wall colours, surfaces, and room design. Mention Asian Paints or Berger paint codes where relevant. Keep responses to 3-4 sentences.',
      400
    );
    return jsonRes({ ok:true, reply });
  } catch(e) {
    return jsonRes({ ok:false, error:e.message }, 500);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function callClaude(env, messages, system=null, max_tokens=1024) {
  const body = { model:MODEL, max_tokens, messages };
  if (system) body.system = system;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
    body:JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(()=>({}));
    throw new Error(e.error?.message || `Anthropic ${r.status}`);
  }
  const d = await r.json();
  return d.content?.[0]?.text || '';
}

function parseJSON(text) {
  if (!text) return { error:'empty' };
  const c = text.replace(/```(?:json)?\s*/gi,'').replace(/```/g,'').trim();
  try { return JSON.parse(c); } catch {}
  const m = c.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return { error:'parse_failed', raw:text.slice(0,100) };
}

function fallback(reason) {
  return {
    room_identified:true, confidence:'low', _fallback:true, _reason:reason,
    observations:{
      estimated_sqft:150, ceiling_height:'standard', ceiling_type:'flat',
      window_count:1, light_direction:'east', light_quality:'moderate',
      natural_light_assessment:'Moderate natural light',
      overhead_beams_detected:false, beam_count:0,
      electrical_points_visible:2, electrical_point_positions:['near_door'],
      existing_furniture:[], wall_colours_existing:['white'],
      flooring_type:'tile', flooring_colour:'beige', ceiling_colour:'white',
      wall_condition:'good', style_detected:['contemporary_indian'],
      vastu_observations:{ sleeping_head_direction_visible:'unknown', mirror_facing_bed:false }
    }
  };
}
