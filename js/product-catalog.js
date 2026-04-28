/**
 * GRIHA PRODUCT CATALOG
 * =====================
 * Fetches and filters product recommendations with affiliate links.
 *
 * TO IMPROVE THIS MODULE:
 *   — Connect Airtable: fill in AIRTABLE_CONFIG below.
 *   — Swap to a different data source (Notion, Google Sheets, custom API)
 *     by implementing a new DataSource class and passing it in config.
 *   — Add new filter fields (price range, material, dimensions) by
 *     adding them to the filter() method below.
 *   — NEVER hardcode affiliate tags here — keep them in Airtable or
 *     the SAMPLE_PRODUCTS array so they can be updated without code changes.
 *
 * DATA SOURCE PRIORITY:
 *   1. Airtable (if configured) — live, your real catalog
 *   2. Static JSON fallback — sample data for testing/demo
 */

// ─── CONFIGURE THIS ───────────────────────────────────────────────────────────
const AIRTABLE_CONFIG = {
  enabled:   false,                  // Set to true when you have your base set up
  apiKey:    'YOUR_AIRTABLE_TOKEN',  // Personal Access Token from airtable.com/account
  baseId:    'appXXXXXXXXXXXXXX',   // From your Airtable base URL
  tableId:   'tblXXXXXXXXXXXXXX',  // Table name or ID for Products table
};

// Your affiliate tracking tags — update here whenever they change
const AFFILIATE_TAGS = {
  amazon:      'griha-21',    // Format: ?tag=griha-21
  pepperfry:   'griha_pf',   // Admitad tracking param
  urban_ladder:'griha_ul',
  ikea:        'griha_ik',
};
// ─────────────────────────────────────────────────────────────────────────────

export class ProductCatalog {
  constructor() {
    this._cache = null;
    this._cacheTime = null;
    this._cacheTTL  = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get product recommendations for a room analysis result.
   *
   * @param {object} filters
   * @param {string}   filters.room_type    - e.g. "master_bedroom"
   * @param {string}   filters.vastu_zone   - e.g. "SW"
   * @param {string[]} filters.style_tags   - e.g. ["modern", "minimalist"]
   * @param {number}   [filters.max_price]  - optional price ceiling in INR
   * @param {number}   [filters.max_results]- default 6
   * @returns {Promise<Product[]>}
   */
  async getRecommendations(filters = {}) {
    const { room_type, vastu_zone, style_tags = [], max_price, max_results = 6, category_filter } = filters;

    const all = await this._loadProducts();

    let filtered = all.filter(product => {
      // Match category if specified
      if (category_filter && product.category_type !== category_filter) return false;

      // Match room type
      const roomMatch = product.room_types.includes('ALL') || product.room_types.includes(room_type);
      if (!roomMatch) return false;

      // Match Vastu zone (optional — if product has zone tags)
      if (vastu_zone && product.vastu_zones && product.vastu_zones.length > 0) {
        const zoneMatch = product.vastu_zones.includes('ALL') || product.vastu_zones.includes(vastu_zone);
        if (!zoneMatch) return false;
      }

      // Price filter
      if (max_price && product.price_inr > max_price) return false;

      // In stock
      if (product.in_stock === false) return false;

      return true;
    });

    // Score by style tag match
    filtered = filtered.map(p => ({
      ...p,
      _relevance_score: this._scoreProduct(p, style_tags, vastu_zone)
    })).sort((a, b) => b._relevance_score - a._relevance_score);

    // Inject affiliate links
    const results = filtered.slice(0, max_results).map(p => {
      const { _relevance_score, ...clean } = p;
      return { ...clean, affiliate_url: this._buildAffiliateUrl(clean) };
    });

    return results;
  }

  /**
   * Get a specific product by ID.
   */
  async getById(id) {
    const all = await this._loadProducts();
    const product = all.find(p => p.id === id);
    return product ? { ...product, affiliate_url: this._buildAffiliateUrl(product) } : null;
  }

  // ─── Private: Data loading ─────────────────────────────────────────────────

  async _loadProducts() {
    // Return cached if fresh
    if (this._cache && (Date.now() - this._cacheTime) < this._cacheTTL) {
      return this._cache;
    }

    let products;

    if (AIRTABLE_CONFIG.enabled) {
      try {
        products = await this._fetchFromAirtable();
      } catch (err) {
        console.warn('Airtable fetch failed, falling back to sample data:', err.message);
        products = SAMPLE_PRODUCTS;
      }
    } else {
      products = SAMPLE_PRODUCTS;
    }

    this._cache     = products;
    this._cacheTime = Date.now();
    return products;
  }

  async _fetchFromAirtable() {
    // Airtable REST API — maps field names from your Airtable schema
    // IMPORTANT: Field names here must match your Airtable column names exactly
    const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableId}`;
    const res = await fetch(`${url}?filterByFormula={In Stock}=TRUE()`, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_CONFIG.apiKey}` }
    });

    if (!res.ok) throw new Error(`Airtable returned ${res.status}`);
    const data = await res.json();

    // Map Airtable record format → our Product format
    return data.records.map(r => ({
      id:          r.id,
      name:        r.fields['Product name']    || '',
      brand:       r.fields['Brand']           || '',
      category:    r.fields['Sub-category']    || '',
      room_types:  r.fields['Room type']       || [],
      vastu_zones: r.fields['Vastu direction'] || [],
      style_tags:  r.fields['Style tags']      || [],
      price_inr:   r.fields['Price (INR)']     || 0,
      platform:    r.fields['Affiliate platform'] || '',
      base_url:    r.fields['Affiliate link']  || '',
      vastu_note:  r.fields['Vastu notes']     || '',
      description: r.fields['AI description'] || '',
      rating:      r.fields['Rating']          || null,
      in_stock:    r.fields['In stock'] !== false,
      emoji:       '🛋', // Default
    }));
  }

  // ─── Private: Scoring ──────────────────────────────────────────────────────

  _scoreProduct(product, style_tags, zone) {
    let score = 0;
    if (zone && product.vastu_zones?.includes(zone)) score += 5;
    style_tags.forEach(tag => { if (product.style_tags?.includes(tag)) score += 2; });
    if (product.rating) score += product.rating * 0.5;
    return score;
  }

  // ─── Private: Affiliate URL builder ───────────────────────────────────────

  /**
   * Builds the tracked affiliate URL from the base product URL.
   * GUARDRAIL: If no base_url exists, returns empty string — never fabricates a URL.
   */
  _buildAffiliateUrl(product) {
    if (!product.base_url) return '';
    const url = product.base_url.trim();

    switch ((product.platform || '').toLowerCase()) {
      case 'amazon':
      case 'amazon india':
        return url.includes('?')
          ? `${url}&tag=${AFFILIATE_TAGS.amazon}`
          : `${url}?tag=${AFFILIATE_TAGS.amazon}`;

      case 'pepperfry':
        return `${url}${url.includes('?') ? '&' : '?'}utm_source=${AFFILIATE_TAGS.pepperfry}`;

      case 'urban ladder':
        return `${url}${url.includes('?') ? '&' : '?'}utm_source=${AFFILIATE_TAGS.urban_ladder}`;

      case 'ikea':
      case 'ikea india':
        return `${url}${url.includes('?') ? '&' : '?'}ref=${AFFILIATE_TAGS.ikea}`;

      default:
        return url;
    }
  }
}

// ─── SAMPLE PRODUCTS ──────────────────────────────────────────────────────────
// 50 products across: furniture, lighting, wall_decor, wallpaper, accessories, rugs
// category_type field enables filtering by design section tab
// To add products: copy a block, change the id, fill in real affiliate URL

const SAMPLE_PRODUCTS = [

  // ══════════════════════════════════════════
  // FURNITURE — BEDROOM
  // ══════════════════════════════════════════
  {
    id:'SP-001', name:'Sheesham Solid Wood Queen Bed', brand:'Woodsworth',
    category:'Bed', category_type:'furniture', emoji:'🛏',
    room_types:['master_bedroom','bedroom'],
    vastu_zones:['SW','S'],
    style_tags:['contemporary_indian','wooden','traditional'],
    price_inr:28500, platform:'Pepperfry',
    base_url:'https://www.pepperfry.com/site/woodsworth-sheesham-queen-bed.html',
    vastu_note:'Sheesham grounds SW zone earth energy. Position with head pointing south per Manasara Ch.42.',
    description:'Crafted from solid sheesham (Indian rosewood). Rich warm grain. Queen size 5×6.5ft.',
    rating:4.5, in_stock:true
  },
  {
    id:'SP-002', name:'HEMNES Bed Frame, White Stain', brand:'IKEA',
    category:'Bed', category_type:'furniture', emoji:'🛏',
    room_types:['master_bedroom','bedroom','guest_bedroom'],
    vastu_zones:['ALL'],
    style_tags:['minimalist','modern','scandinavian'],
    price_inr:22990, platform:'Amazon India',
    base_url:'https://www.amazon.in/dp/HEMNES-BED-IKEA',
    vastu_note:'Light finish suits all zones. Place in SW corner for best Vastu alignment.',
    description:'Durable pine, light stain. Includes slatted bed base.',
    rating:4.3, in_stock:true
  },
  {
    id:'SP-003', name:'Carved Teak King Bed with Storage', brand:'Rajwada Crafts',
    category:'Bed', category_type:'furniture', emoji:'🛏',
    room_types:['master_bedroom'],
    vastu_zones:['SW'],
    style_tags:['traditional','traditional_heritage','rajasthani'],
    price_inr:68000, platform:'Pepperfry',
    base_url:'https://www.pepperfry.com/carved-teak-king-bed.html',
    vastu_note:'Solid teak with hydraulic storage — grounding for the SW Nairutya zone.',
    description:'Hand-carved teak with traditional Rajasthani motifs. Hydraulic lift storage base.',
    rating:4.6, in_stock:true
  },
  {
    id:'SP-004', name:'Rattan Cane Bed Frame, Queen', brand:'Elista',
    category:'Bed', category_type:'furniture', emoji:'🛏',
    room_types:['bedroom','guest_bedroom'],
    vastu_zones:['N','NE','E'],
    style_tags:['boho_chic','contemporary_indian','handcrafted'],
    price_inr:18500, platform:'Urban Ladder',
    base_url:'https://www.urbanladder.com/rattan-cane-queen-bed',
    vastu_note:'Natural rattan aligns with N and NE zone air element.',
    description:'Natural rattan cane headboard and frame. Lightweight, warm, artisanal.',
    rating:4.2, in_stock:true
  },
  {
    id:'SP-005', name:'PAX Wardrobe, White 200cm', brand:'IKEA',
    category:'Wardrobe', category_type:'furniture', emoji:'🚪',
    room_types:['master_bedroom','bedroom'],
    vastu_zones:['SW','S','W'],
    style_tags:['minimalist','modern','scandinavian'],
    price_inr:35990, platform:'Amazon India',
    base_url:'https://www.amazon.in/dp/PAX-WARDROBE-IKEA',
    vastu_note:'Place along south or west wall — never NE corner.',
    description:'Modular wardrobe with soft-close hinges. White finish.',
    rating:4.5, in_stock:true
  },

  // ══════════════════════════════════════════
  // FURNITURE — LIVING ROOM
  // ══════════════════════════════════════════
  {
    id:'SP-006', name:'KIVIK 3-Seat Sofa, Beige Cotton', brand:'IKEA',
    category:'Sofa', category_type:'furniture', emoji:'🛋',
    room_types:['living_room','drawing_room'],
    vastu_zones:['SW','S','W'],
    style_tags:['minimalist','modern','scandinavian','minimalist_modern'],
    price_inr:42990, platform:'Amazon India',
    base_url:'https://www.amazon.in/dp/KIVIK-SOFA-IKEA',
    vastu_note:'Position along south or west wall. Heavy furniture in SW grounds the space.',
    description:'Generous 3-seater. Easy-clean removable cover. Pine frame.',
    rating:4.5, in_stock:true
  },
  {
    id:'SP-007', name:'Chesterfield 3-Seater Tufted Sofa', brand:'Woodsworth',
    category:'Sofa', category_type:'furniture', emoji:'🛋',
    room_types:['living_room','drawing_room'],
    vastu_zones:['SW','S'],
    style_tags:['traditional','traditional_heritage','contemporary_indian'],
    price_inr:54000, platform:'Pepperfry',
    base_url:'https://www.pepperfry.com/chesterfield-tufted-sofa.html',
    vastu_note:'Deep-tufted heritage design suits SW zone grounding energy.',
    description:'Button-tufted velvet in deep burgundy or teal. Solid sheesham legs.',
    rating:4.4, in_stock:true
  },
  {
    id:'SP-008', name:'Mango Wood Coffee Table, Natural', brand:'Furncraft',
    category:'Coffee Table', category_type:'furniture', emoji:'🪵',
    room_types:['living_room','drawing_room'],
    vastu_zones:['ALL'],
    style_tags:['contemporary_indian','traditional','wooden'],
    price_inr:12500, platform:'Pepperfry',
    base_url:'https://www.pepperfry.com/mango-wood-coffee-table.html',
    vastu_note:'Solid mango wood grounds the centre of the living room.',
    description:'Solid mango wood, natural finish. 120×60cm. Handcrafted in Rajasthan.',
    rating:4.3, in_stock:true
  },
  {
    id:'SP-009', name:'LISABO Dining Table, Ash Veneer', brand:'IKEA',
    category:'Dining Table', category_type:'furniture', emoji:'🍽',
    room_types:['dining_room','kitchen'],
    vastu_zones:['SE','E','W'],
    style_tags:['minimalist','modern','scandinavian'],
    price_inr:18990, platform:'Amazon India',
    base_url:'https://www.amazon.in/dp/LISABO-TABLE-IKEA',
    vastu_note:'Place in SE or E zone. Family should face east while eating per Vastu.',
    description:'Ash veneer. 140×78cm. Seats 4. Easy assembly.',
    rating:4.2, in_stock:true
  },
  {
    id:'SP-010', name:'Boston Fabric 3-Seater Sofa, Grey', brand:'Urban Ladder',
    category:'Sofa', category_type:'furniture', emoji:'🛋',
    room_types:['living_room'],
    vastu_zones:['SW','S'],
    style_tags:['modern','contemporary','minimalist_modern'],
    price_inr:38999, platform:'Urban Ladder',
    base_url:'https://www.urbanladder.com/boston-3-seater-sofa',
    vastu_note:'Kiln-dried solid wood frame. South wall placement ideal.',
    description:'High-density foam. Stain-resistant polyester. 10-year frame warranty.',
    rating:4.6, in_stock:true
  },

  // ══════════════════════════════════════════
  // LIGHTING
  // ══════════════════════════════════════════
  {
    id:'LT-001', name:'Antique Brass Pendant Light, E27', brand:'Jainsons Emporio',
    category:'Pendant Light', category_type:'lighting', emoji:'💡',
    room_types:['living_room','dining_room','master_bedroom','kitchen'],
    vastu_zones:['SE','E','SW'],
    style_tags:['contemporary_indian','traditional','traditional_heritage'],
    price_inr:3500, platform:'Amazon India',
    base_url:'https://www.amazon.in/jainsons-brass-pendant-light',
    vastu_note:'Warm brass amplifies SE Agni zone fire energy. Hang centrally or slightly west.',
    description:'Antique brass finish. E27 socket. 25cm diameter. Suitable for 2700K warm bulb.',
    rating:4.4, in_stock:true
  },
  {
    id:'LT-002', name:'Rattan Woven Pendant Shade', brand:'The Decor Kart',
    category:'Pendant Light', category_type:'lighting', emoji:'💡',
    room_types:['living_room','bedroom','dining_room'],
    vastu_zones:['N','NE','E','NW'],
    style_tags:['boho_chic','contemporary_indian','handcrafted'],
    price_inr:2800, platform:'Amazon India',
    base_url:'https://www.amazon.in/rattan-woven-pendant-shade',
    vastu_note:'Natural rattan aligns with air element zones N and NW.',
    description:'Hand-woven rattan shade. E27 fitting. 35cm diameter. Warm diffused light.',
    rating:4.3, in_stock:true
  },
  {
    id:'LT-003', name:'Slim Black Stem Pendant, E27', brand:'Fos Lighting',
    category:'Pendant Light', category_type:'lighting', emoji:'💡',
    room_types:['living_room','kitchen','study'],
    vastu_zones:['N','NE','W'],
    style_tags:['minimalist_modern','modern','minimalist'],
    price_inr:2200, platform:'Amazon India',
    base_url:'https://www.amazon.in/slim-stem-pendant-black',
    vastu_note:'Clean geometry. Neutral colour suits N and NE water/air zones.',
    description:'Matte black metal. 150cm adjustable cord. Takes E27 up to 60W.',
    rating:4.2, in_stock:true
  },
  {
    id:'LT-004', name:'Sheesham Tripod Floor Lamp, E27', brand:'Woodsworth',
    category:'Floor Lamp', category_type:'lighting', emoji:'🕯',
    room_types:['living_room','master_bedroom','bedroom'],
    vastu_zones:['SE','SW'],
    style_tags:['contemporary_indian','wooden','traditional'],
    price_inr:4500, platform:'Pepperfry',
    base_url:'https://www.pepperfry.com/sheesham-tripod-floor-lamp.html',
    vastu_note:'Place in SE corner of bedroom or living room. Warm sheesham supports earth element.',
    description:'Solid sheesham tripod base. 155cm height. E27 drum shade included.',
    rating:4.5, in_stock:true
  },
  {
    id:'LT-005', name:'Arc Floor Lamp, Rattan Shade', brand:'Elista',
    category:'Floor Lamp', category_type:'lighting', emoji:'🕯',
    room_types:['living_room','bedroom'],
    vastu_zones:['N','NE'],
    style_tags:['boho_chic','contemporary_indian'],
    price_inr:3200, platform:'Urban Ladder',
    base_url:'https://www.urbanladder.com/arc-floor-lamp-rattan',
    vastu_note:'Natural materials in NE or N corner — ideal for prosperity zone lighting.',
    description:'180cm arc floor lamp with handwoven rattan shade. Warm ambient glow.',
    rating:4.3, in_stock:true
  },
  {
    id:'LT-006', name:'Bedside Table Lamp Set (2), Cream Linen', brand:'Jainsons',
    category:'Table Lamp', category_type:'lighting', emoji:'🏮',
    room_types:['master_bedroom','bedroom','guest_bedroom'],
    vastu_zones:['ALL'],
    style_tags:['contemporary_indian','minimalist','traditional'],
    price_inr:3600, platform:'Amazon India',
    base_url:'https://www.amazon.in/bedside-table-lamp-linen-set',
    vastu_note:'Warm bedside lighting supports restful sleep. Place on both sides for balance.',
    description:'Set of 2. Cream linen shade, brass base. E27 socket. 40cm height.',
    rating:4.4, in_stock:true
  },
  {
    id:'LT-007', name:'Electric Diya LED Set, Copper (set of 2)', brand:'Craftsvilla',
    category:'Devotional Lighting', category_type:'lighting', emoji:'🪔',
    room_types:['pooja_room','ALL'],
    vastu_zones:['NE'],
    style_tags:['traditional','traditional_heritage','contemporary_indian'],
    price_inr:550, platform:'Amazon India',
    base_url:'https://www.amazon.in/electric-copper-diya-led',
    vastu_note:'Warm diya lighting in NE (Ishanya) zone amplifies sacred energy per Manasara.',
    description:'Copper-finish electric diyas. Flame-flicker LED. Set of 2. Safe and maintenance-free.',
    rating:4.1, in_stock:true
  },
  {
    id:'LT-008', name:'Under-Cabinet LED Strip Light, 1m Warm White', brand:'Philips',
    category:'LED Strip', category_type:'lighting', emoji:'💡',
    room_types:['kitchen','study'],
    vastu_zones:['ALL'],
    style_tags:['minimalist','modern','minimalist_modern'],
    price_inr:850, platform:'Amazon India',
    base_url:'https://www.amazon.in/philips-led-strip-warm-white',
    vastu_note:'Task lighting under kitchen cabinets. Ensures well-lit cooking surface facing east.',
    description:'Self-adhesive. IP20. 3000K warm white. 300 lumens/m. Plug-and-play.',
    rating:4.5, in_stock:true
  },

  // ══════════════════════════════════════════
  // WALL DECOR & WALLPAPER
  // ══════════════════════════════════════════
  {
    id:'WD-001', name:'Handloom Cotton Macramé Wall Hanging', brand:'Cocobolo Décor',
    category:'Wall Decor', category_type:'wall_decor', emoji:'🎨',
    room_types:['master_bedroom','bedroom','living_room'],
    vastu_zones:['N','NE','E'],
    style_tags:['boho_chic','contemporary_indian','handcrafted'],
    price_inr:1299, platform:'Amazon India',
    base_url:'https://www.amazon.in/macrame-wall-hanging-handloom',
    vastu_note:'Hang on north or east wall. Natural cotton aligns with air element zones.',
    description:'Handwoven cotton macramé. 60×90cm. Natural undyed cotton.',
    rating:4.2, in_stock:true
  },
  {
    id:'WD-002', name:'Madhubani Art Print, Framed', brand:'The Art House',
    category:'Wall Art', category_type:'wall_decor', emoji:'🖼',
    room_types:['living_room','master_bedroom','drawing_room'],
    vastu_zones:['N','NE','E'],
    style_tags:['traditional','traditional_heritage','contemporary_indian'],
    price_inr:2800, platform:'Amazon India',
    base_url:'https://www.amazon.in/madhubani-art-print-framed',
    vastu_note:'Traditional Indian art on north or east walls invites prosperity energy.',
    description:'Authentic Madhubani art reproduction. Teak frame. 60×45cm. Ready to hang.',
    rating:4.4, in_stock:true
  },
  {
    id:'WD-003', name:'Geometric Metal Wall Art, Gold', brand:'Artcrush',
    category:'Wall Art', category_type:'wall_decor', emoji:'🟡',
    room_types:['living_room','drawing_room'],
    vastu_zones:['N','NE','SW'],
    style_tags:['contemporary_indian','minimalist_modern','modern'],
    price_inr:3500, platform:'Urban Ladder',
    base_url:'https://www.urbanladder.com/geometric-metal-wall-art-gold',
    vastu_note:'Gold-tone metal on north wall supports Kubera zone wealth energy.',
    description:'Laser-cut geometric pattern. Antique gold finish. 75cm diameter.',
    rating:4.3, in_stock:true
  },
  {
    id:'WP-001', name:'Asian Paints Royale Play Metallico — Terracotta Kit', brand:'Asian Paints',
    category:'Wallpaper / Wall Finish', category_type:'wall_decor', emoji:'🪣',
    room_types:['master_bedroom','living_room','dining_room'],
    vastu_zones:['SW','SE','S'],
    style_tags:['contemporary_indian','traditional','boho_chic'],
    price_inr:4200, platform:'Asian Paints',
    base_url:'https://www.asianpaints.com/royale-play-metallico',
    vastu_note:'Warm terracotta Metallico finish amplifies SW zone earth element.',
    description:'DIY textured wall finish kit. Covers 20–25 sqft. Rich metallic depth.',
    rating:4.4, in_stock:true
  },
  {
    id:'WP-002', name:'Nilaya Botanical Leaf Wallpaper Roll', brand:'Asian Paints',
    category:'Wallpaper', category_type:'wall_decor', emoji:'🌿',
    room_types:['living_room','bedroom','study'],
    vastu_zones:['N','NE','E'],
    style_tags:['boho_chic','contemporary_indian','botanical'],
    price_inr:3800, platform:'Asian Paints',
    base_url:'https://www.asianpaints.com/nilaya-botanical-wallpaper',
    vastu_note:'Botanical green prints support NE prosperity zone energy.',
    description:'Non-woven wallpaper. 10m roll covers ~50sqft. Paste-the-wall application.',
    rating:4.3, in_stock:true
  },
  {
    id:'WP-003', name:'Geometric Block Print Wallpaper, Ochre', brand:'D\'Décor',
    category:'Wallpaper', category_type:'wall_decor', emoji:'🟫',
    room_types:['living_room','dining_room','master_bedroom'],
    vastu_zones:['SE','SW','S'],
    style_tags:['traditional_heritage','contemporary_indian','traditional'],
    price_inr:4500, platform:'Amazon India',
    base_url:'https://www.amazon.in/geometric-block-print-wallpaper-ochre',
    vastu_note:'Traditional ochre and rust tones honour SE fire zone.',
    description:'Traditional Indian block-print motif. Water-resistant. 10m roll.',
    rating:4.2, in_stock:true
  },
  {
    id:'WP-004', name:'Grasscloth Texture Wallpaper, Natural', brand:'Nilaya',
    category:'Wallpaper', category_type:'wall_decor', emoji:'🌾',
    room_types:['ALL'],
    vastu_zones:['ALL'],
    style_tags:['minimalist_modern','contemporary_indian','boho_chic'],
    price_inr:3200, platform:'Amazon India',
    base_url:'https://www.amazon.in/grasscloth-texture-wallpaper-natural',
    vastu_note:'Natural grasscloth texture is compatible with all Vastu zones.',
    description:'Natural grasscloth weave look. PVC-free. 10m roll. Smooth paste application.',
    rating:4.1, in_stock:true
  },
  {
    id:'WP-005', name:'Royale Play Crinkle Textured Wall Finish', brand:'Asian Paints',
    category:'Wallpaper / Wall Finish', category_type:'wall_decor', emoji:'🪣',
    room_types:['ALL'],
    vastu_zones:['ALL'],
    style_tags:['minimalist_modern','minimalist'],
    price_inr:3600, platform:'Asian Paints',
    base_url:'https://www.asianpaints.com/royale-play-crinkle',
    vastu_note:'Subtle crinkle texture works in all zones — adds depth without colour.',
    description:'DIY crinkle texture kit. Covers 20sqft. White/off-white base.',
    rating:4.3, in_stock:true
  },

  // ══════════════════════════════════════════
  // ACCESSORIES & DECOR
  // ══════════════════════════════════════════
  {
    id:'AC-001', name:'Macramé Planter with Stand, 5ft', brand:'Elista',
    category:'Planter', category_type:'accessories', emoji:'🪴',
    room_types:['ALL'],
    vastu_zones:['NE','N','E'],
    style_tags:['boho_chic','contemporary_indian','handcrafted'],
    price_inr:1800, platform:'Urban Ladder',
    base_url:'https://www.urbanladder.com/macrame-planter-stand',
    vastu_note:'Plants in NE corner attract positive energy per Vastu.',
    description:'Handwoven macramé. 5ft bamboo stand. Holds pots up to 6 inches.',
    rating:4.4, in_stock:true
  },
  {
    id:'AC-002', name:'Handloom Cotton Dhurrie Rug, 5×8ft', brand:'Fabindia',
    category:'Rug', category_type:'accessories', emoji:'🔲',
    room_types:['living_room','master_bedroom','dining_room'],
    vastu_zones:['ALL'],
    style_tags:['traditional','contemporary_indian','handcrafted'],
    price_inr:4500, platform:'Amazon India',
    base_url:'https://www.amazon.in/fabindia-dhurrie-rug-5x8',
    vastu_note:'Handloom dhurrie — place centrally, avoid blocking doorways.',
    description:'Flat-weave dhurrie. Traditional geometric patterns. Machine-washable cotton.',
    rating:4.3, in_stock:true
  },
  {
    id:'AC-003', name:'Jute Braided Oval Rug, 4×6ft', brand:'The Decor Kart',
    category:'Rug', category_type:'accessories', emoji:'🔲',
    room_types:['living_room','bedroom','balcony'],
    vastu_zones:['ALL'],
    style_tags:['boho_chic','contemporary_indian','handcrafted'],
    price_inr:2200, platform:'Amazon India',
    base_url:'https://www.amazon.in/jute-braided-oval-rug',
    vastu_note:'Natural jute supports earth element. Ideal for SW or S facing rooms.',
    description:'Hand-braided natural jute. Reversible. 4×6ft. Natural undyed.',
    rating:4.2, in_stock:true
  },
  {
    id:'AC-004', name:'Brass Ganesh Statue, Table Décor', brand:'Aakrati',
    category:'Decor', category_type:'accessories', emoji:'🙏',
    room_types:['living_room','pooja_room','drawing_room'],
    vastu_zones:['NE','N','E'],
    style_tags:['traditional','traditional_heritage','contemporary_indian'],
    price_inr:1850, platform:'Amazon India',
    base_url:'https://www.amazon.in/brass-ganesh-statue-decor',
    vastu_note:'Ganesh idol in NE (Ishanya) zone is auspicious per Vastu. Face idol towards west or south.',
    description:'Solid brass. 15cm height. Hand-finished. Traditional Ganesha posture.',
    rating:4.6, in_stock:true
  },
  {
    id:'AC-005', name:'Artificial Monstera in Ceramic Pot', brand:'IKEA',
    category:'Plant', category_type:'accessories', emoji:'🌿',
    room_types:['ALL'],
    vastu_zones:['NE','N','E'],
    style_tags:['minimalist','modern','minimalist_modern'],
    price_inr:699, platform:'Amazon India',
    base_url:'https://www.amazon.in/dp/FEJKA-PLANT-IKEA',
    vastu_note:'Place in NE corner. Zero maintenance — ideal for low-light Indian apartments.',
    description:'Lifelike monstera. Off-white ceramic pot. 30cm height. No watering.',
    rating:4.0, in_stock:true
  },
  {
    id:'AC-006', name:'Block Print Cushion Cover Set (5)', brand:'Fabindia',
    category:'Textiles', category_type:'accessories', emoji:'🛋',
    room_types:['living_room','master_bedroom','drawing_room'],
    vastu_zones:['ALL'],
    style_tags:['contemporary_indian','traditional','handcrafted'],
    price_inr:2200, platform:'Amazon India',
    base_url:'https://www.amazon.in/fabindia-block-print-cushion-covers',
    vastu_note:'Indian block-print textiles bring warmth and cultural grounding to any zone.',
    description:'100% cotton. Hand block-printed in Jaipur. Set of 5. 45×45cm. Removable.',
    rating:4.4, in_stock:true
  },
  {
    id:'AC-007', name:'Copper Water Vessel with Lid', brand:'Craftsvilla',
    category:'Kitchen Decor', category_type:'accessories', emoji:'🏺',
    room_types:['kitchen','dining_room'],
    vastu_zones:['SE','E'],
    style_tags:['traditional','traditional_heritage','contemporary_indian'],
    price_inr:850, platform:'Amazon India',
    base_url:'https://www.amazon.in/copper-water-vessel-lid',
    vastu_note:'Copper in the SE kitchen zone aligns with Agni fire element principles.',
    description:'Pure copper vessel. 2L capacity. Antimicrobial properties. Handmade.',
    rating:4.5, in_stock:true
  },
  {
    id:'AC-008', name:'Cane Storage Basket Set (3)', brand:'Elista',
    category:'Storage', category_type:'accessories', emoji:'🧺',
    room_types:['ALL'],
    vastu_zones:['ALL'],
    style_tags:['boho_chic','contemporary_indian','handcrafted'],
    price_inr:1650, platform:'Amazon India',
    base_url:'https://www.amazon.in/cane-storage-basket-set-3',
    vastu_note:'Natural cane reduces visual clutter — important for positive energy flow.',
    description:'Handwoven cane baskets. Set of 3 nested sizes. Lid included.',
    rating:4.3, in_stock:true
  },
  {
    id:'AC-009', name:'Handmade Ceramic Vase Set (2)', brand:'Gaya Ceramics',
    category:'Vase', category_type:'accessories', emoji:'🏺',
    room_types:['living_room','dining_room','bedroom'],
    vastu_zones:['N','NE','E'],
    style_tags:['minimalist_modern','contemporary_indian','boho_chic'],
    price_inr:2100, platform:'Amazon India',
    base_url:'https://www.amazon.in/handmade-ceramic-vase-set',
    vastu_note:'Round forms in N/NE zone support water element flow and prosperity.',
    description:'Handthrown ceramic. Organic form. Matte glaze in warm white/terracotta.',
    rating:4.4, in_stock:true
  },
  {
    id:'AC-010', name:'RÅSKOG Trolley for Storage', brand:'IKEA',
    category:'Storage', category_type:'accessories', emoji:'🛒',
    room_types:['kitchen','bedroom','study'],
    vastu_zones:['ALL'],
    style_tags:['minimalist','modern','minimalist_modern'],
    price_inr:2999, platform:'Amazon India',
    base_url:'https://www.amazon.in/dp/RASKOG-TROLLEY-IKEA',
    vastu_note:'Mobile storage reduces fixed clutter — good for rooms requiring flexibility.',
    description:'Steel trolley. 3 shelves. 35×45cm base. On castors. Multiple colours.',
    rating:4.3, in_stock:true
  },

  // ══════════════════════════════════════════
  // RUGS (as separate section for design linking)
  // ══════════════════════════════════════════
  {
    id:'RG-001', name:'Persian-Style Wool Rug, 6×9ft', brand:'Houzzcraft',
    category:'Rug', category_type:'accessories', emoji:'🔲',
    room_types:['living_room','drawing_room','master_bedroom'],
    vastu_zones:['SW','S','W'],
    style_tags:['traditional_heritage','traditional'],
    price_inr:12500, platform:'Amazon India',
    base_url:'https://www.amazon.in/persian-style-wool-rug',
    vastu_note:'Rich-toned Persian rugs ground SW zone earth element. Central placement is ideal.',
    description:'Hand-tufted wool. Traditional medallion pattern. 6×9ft. Rich jewel tones.',
    rating:4.5, in_stock:true
  },
  {
    id:'RG-002', name:'Abstract Geometric Rug, Grey-Cream 5×8ft', brand:'Saaya Rug',
    category:'Rug', category_type:'accessories', emoji:'🔲',
    room_types:['living_room','bedroom'],
    vastu_zones:['ALL'],
    style_tags:['minimalist_modern','minimalist','modern'],
    price_inr:6800, platform:'Pepperfry',
    base_url:'https://www.pepperfry.com/abstract-geometric-rug-grey',
    vastu_note:'Neutral geometric rug compatible with all zones — does not conflict with any directional energy.',
    description:'Machine-made. 80% polyester, 20% cotton. Non-slip backing.',
    rating:4.2, in_stock:true
  }
];
