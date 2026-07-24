import { NicheIdea, StylePreset } from '../types';

export const PRESET_LIBRARY_VERSION = '2026.07-popular-v2';

const STICKER_STYLE_GUARD = [
  'Apply this as the locked rendering treatment for the artwork only',
  'keep one clear isolated subject with a strong thumbnail-readable silhouette',
  'do not add a scene, room, landscape, card, frame, grid, interface, repeating pattern or background',
  'do not add typography, labels, logos, watermarks or brand marks',
  'keep surface texture controlled so the outer die-cut edge stays clean'
].join('; ');

const style = (
  id: string,
  name: string,
  visualDirection: string,
  isNew = false
): StylePreset => ({
  id,
  name,
  prompt: `${visualDirection}; ${STICKER_STYLE_GUARD}.`,
  isNew
});

/**
 * Style presets are deliberately medium-only. They describe how the artwork is
 * rendered, never a background layout. This prevents a fashionable preset from
 * fighting the sticker-isolation pipeline with grids, cards or fake backdrops.
 */
export const STYLE_PRESETS: StylePreset[] = [
  { id: 'auto', name: '✨ Auto-Detect Best Style', prompt: 'AUTO_DETECT_FROM_NICHE' },

  // Proven, high-utility commercial styles
  style('clean_kawaii_vector', 'Clean Kawaii Vector', 'Smooth flat vector color, friendly expressive features, rounded shapes, restrained two-tone shading, crisp polished edges'),
  style('soft_pastel_kawaii', 'Soft Pastel Kawaii', 'Powdery pastel palette, gentle rounded characters, subtle soft shading, sweet collectible charm, clean simplified forms'),
  style('bold_comic', 'Bold Comic Illustration', 'Confident dark ink contours, energetic poses, saturated spot colors, halftone accents used only inside the artwork, punchy readable contrast'),
  style('original_anime_chibi', 'Original Anime Chibi', 'Original non-franchise chibi character design, large expressive features, polished cel shading, dynamic but compact pose, bright controlled palette'),
  style('flat_vector_icons', 'Modern Flat Vector', 'Geometric flat vector construction, clean color blocking, minimal highlights, precise shapes, contemporary app-icon polish without interface elements'),
  style('minimal_line_art', 'Minimal Line Art', 'Elegant continuous linework, restrained neutral palette, one or two muted accents, generous internal breathing room, premium modern simplicity'),
  style('hand_drawn_doodle', 'Human Hand-Drawn Doodle', 'Wobbly confident ink lines, visible hand-made variation, simple color fills, honest playful imperfection, uncluttered composition'),
  style('editorial_gouache', 'Editorial Gouache', 'Opaque gouache paint, visible brush texture, sophisticated simplified forms, warm shadow shapes, art-magazine polish'),
  style('watercolor_ink', 'Watercolor & Ink', 'Transparent watercolor washes, delicate ink structure, soft pigment blooms contained within the subject, luminous handmade color'),
  style('colored_pencil_storybook', 'Colored Pencil Storybook', 'Layered colored-pencil texture, gentle expressive forms, warm storybook palette, hand-rendered detail with clear major shapes'),

  // Tactile and human styles supported by 2026 design and marketplace signals
  style('soft_stitch', 'Soft Stitch Embroidery', 'Visible embroidery thread, satin and chain stitches, felt appliqué pieces, warm fabric color, carefully simplified sewn detail', true),
  style('crochet_felt', 'Crochet & Felt Craft', 'Chunky crochet loops, soft felt construction, tiny stitched accents, cozy handmade tactility, rounded dimensional forms', true),
  style('clay_3d', '3D Clay Miniature', 'Hand-shaped polymer clay, soft rounded volume, subtle fingerprints, studio-quality material lighting contained on the subject, playful miniature scale'),
  style('paper_cut', 'Layered Paper Cut', 'Cut-paper layers, visible fibers, shallow dimensional overlap, clean scissor-cut shapes, controlled cast depth inside the artwork'),
  style('texture_check', 'Tactile Mixed Media', 'Embossed paper, woven fiber, raised paint and soft grain combined in one coherent material system, touchable but controlled detail', true),
  style('risograph', 'Retro Risograph Print', 'Limited spot-color palette, grainy ink, deliberate small registration shifts inside the subject, bold simple shapes, independent-zine character'),
  style('bold_linocut', 'Bold Linocut', 'Hand-carved black marks, rough ink character, dramatic negative space, limited spot colors, strong artisan-print silhouette'),
  style('folk_block_print', 'Modern Folk Block Print', 'Naive florals, birds, suns and geometric ornaments, carved shapes, warm earthy spot colors, decorative symmetry without copying a specific living tradition'),

  // Popular nostalgic and expressive directions
  style('retro_70s', 'Retro 70s Warm', 'Rounded seventies forms, warm orange mustard avocado and cream palette, simple groovy motifs, lightly printed vintage texture'),
  style('y2k_airbrush', 'Y2K Airbrush', 'Soft airbrushed gradients, chrome-like accents, tiny sparkles, playful early-digital optimism, compact high-gloss forms without screens or grids'),
  style('dopamine_bright', 'Dopamine Bright', 'Joyful high-saturation color, playful shape contrast, energetic maximal color within a simple readable composition, delightful collectible energy', true),
  style('surreal_whimsy', 'Surreal Whimsy', 'Familiar objects transformed with one clever impossible twist, playful scale, expressive character, dreamlike color while preserving a clear silhouette', true),
  style('clean_opt_out', 'Quiet Editorial Minimal', 'Structured calm composition, restrained palette, precise hierarchy of shapes, one expressive accent, premium anti-clutter finish', true),
  style('notes_app_chic', 'Analog Notes Chic', 'Loose pen doodles, imperfect highlighter color, paper-tab and tape-like material details contained within the subject, candid human notebook character', true),

  // Strong collectible aesthetics
  style('boho_botanical', 'Boho Botanical', 'Organic botanical forms, sage terracotta sand and muted floral colors, gentle ink texture, modern natural warmth'),
  style('vintage_scientific', 'Vintage Scientific', 'Fine engraved linework, natural-history precision, muted earth and mineral colors, stippled dimensional detail, archival illustration character'),
  style('dark_academia', 'Dark Academia', 'Moody ink and gouache, antique books and scholarly materials, deep brown charcoal burgundy and brass palette, refined literary atmosphere'),
  style('gothic_romance', 'Gothic Romance', 'Cathedral lace rhythms, stained-glass color, antique silver, wine black and jewel tones, elegant romantic drama rather than horror', true),
  style('celestial_luxe', 'Celestial Luxe', 'Deep night colors, antique-gold celestial geometry, opal glow, jewelry-like detail, elegant balanced mysticism'),
  style('stained_glass', 'Stained Glass', 'Thick clean lead lines, luminous translucent jewel colors, deliberate geometric segmentation, radiant handcrafted glass appearance'),
  style('pixel_high_bit', 'High-Bit Pixel Art', 'Crisp intentional pixel clusters, vibrant 32-bit palette, readable sprite proportions, controlled dithering, polished nostalgic game-asset finish'),
  style('enamel_pin', 'Enamel Pin', 'Hard enamel color cells, polished dark metal separators, compact badge-like form, tiny controlled highlights, premium collectible manufacturing look'),
  style('vintage_ephemera', 'Vintage Travel Ephemera', 'Screen-printed luggage-label character, imperfect rubber-stamp ink, aged but colorful paper texture contained inside the motif, adventurous nostalgic polish')
];

const COLLECTION_ARCHITECTURE = [
  'Treat this as a 100-design-capable commercial sticker universe, not one motif repeated',
  'cover at least 10 distinct subject families',
  'for a full pack target 60–70 hero subjects, 20–30 useful supporting subjects and no more than 10 simple fillers or labels',
  'vary silhouette, orientation, proportion, viewpoint, mass distribution and composition while locking one visual style',
  'make every concept clearly different at thumbnail size',
  'use original optional micro-copy only when essential',
  'exclude trademarks, brand names, recognizable product interfaces, official seals, copyrighted characters, franchise references and copied quotations'
].join('; ');

const niche = (
  id: number,
  name: string,
  category: string,
  themeUniverse: string,
  isNew = false
): NicheIdea => ({
  id,
  name,
  category,
  generationBrief: `${COLLECTION_ARCHITECTURE}. Theme universe: ${themeUniverse}.`,
  isNew
});

/**
 * A curated mix of evergreen demand, practical planner use cases, giftable
 * milestones and current aesthetic worlds. Entries are broad enough to sustain
 * a genuinely varied 100-sticker product instead of forcing filler.
 */
export const NICHE_IDEAS: NicheIdea[] = [
  // 1. Best first choices for broad buyer demand
  niche(2001, 'Digital Planner Essentials Mega Pack', '⭐ Popular Mega Packs', 'calendar moments, appointments, priorities, habits, routines, chores, errands, meals, weather, transport, work, home, goals, celebrations, dividers and status icons'),
  niche(2002, 'Everyday Life Mega Collection', '⭐ Popular Mega Packs', 'daily routines, food, home, work, study, errands, transport, hobbies, weather, moods, social plans, pets, rest and small celebrations'),
  niche(2003, 'Cute Animals Mega Collection', '⭐ Popular Mega Packs', 'pets, woodland, farm, ocean, jungle, desert and arctic animals, birds, reptiles, insects, activities, emotions, foods and seasonal moments'),
  niche(2004, 'Food & Drinks Mega Collection', '⭐ Popular Mega Packs', 'breakfast, bakery, produce, pantry, global comfort food, street food, desserts, coffee, tea, mocktails, cooking tools, groceries and celebrations'),
  niche(2005, 'Botanical Garden & Houseplants', '⭐ Popular Mega Packs', 'wildflowers, garden tools, houseplants, herbs, vegetables, greenhouse life, pollinators, watering, propagation, bouquets and seasonal growth'),
  niche(2006, 'Travel & Adventure Mega Pack', '⭐ Popular Mega Packs', 'trip planning, maps, luggage, road travel, flights, rail, camping, hiking, city breaks, beaches, food discoveries, photography, souvenirs and weather'),
  niche(2007, 'Books, Reading & Library Life', '⭐ Popular Mega Packs', 'bookshelves, broad genres, reading moods, libraries, bookmarks, book clubs, annotation tools, reading trackers, cozy reading places and writing objects'),
  niche(2008, 'Cozy Home & Everyday Comfort', '⭐ Popular Mega Packs', 'rooms, cooking, laundry, cleaning, pets, plants, rainy days, home office, organizing, candles, soft furnishings, rest and quiet rituals'),
  niche(2009, 'Self-Care & Everyday Wellness', '⭐ Popular Mega Packs', 'rest, hydration, movement, boundaries, reflection, sleep, gentle routines, emotional check-ins, small wins, comfort objects and supportive symbols'),
  niche(2010, 'Creative Hobbies & Maker Life', '⭐ Popular Mega Packs', 'drawing, painting, sewing, crochet, pottery, photography, scrapbooking, journaling, woodworking, baking, music, supplies and finished projects'),
  niche(2011, 'School, Study & Campus Life', '⭐ Popular Mega Packs', 'subjects, stationery, schedules, exams, assignments, labs, reading, group projects, campus places, study breaks, graduation and student emotions'),
  niche(2012, 'Small Business Owner Mega Pack', '⭐ Popular Mega Packs', 'orders, inventory, packing, shipping, bookkeeping, customer care, content creation, launches, markets, goals, breaks, tools and business wins'),
  niche(2013, 'Seasonal Celebrations All Year', '⭐ Popular Mega Packs', 'spring, summer, autumn, winter, birthdays, love, gratitude, new beginnings, school milestones, family gatherings, decorations, foods, gifts and weather'),
  niche(2014, 'Original Fantasy Worlds', '⭐ Popular Mega Packs', 'dragons, castles, potions, quests, enchanted forests, magical creatures, maps, relics, armor, libraries, portals and cozy fantasy daily life'),
  niche(2015, 'Ocean, Beach & Coastal Life', '⭐ Popular Mega Packs', 'marine life, shells, tide pools, boats, surf, lighthouses, beach gear, seafood, coastal weather, conservation, seaside towns and sunsets'),

  // 2. Functional products buyers can use every day
  niche(2101, 'Functional Planner Icons', '🗓️ Planner & Organization', 'dates, appointments, priorities, checklists, trackers, chores, meals, weather, transport, finance, work, home, wellness and status symbols'),
  niche(2102, 'Weekly & Monthly Planning', '🗓️ Planner & Organization', 'week and month views, goals, deadlines, review moments, recurring routines, project phases, focus blocks, reminders and decorative calendar accents'),
  niche(2103, 'Habit & Routine Tracker', '🗓️ Planner & Organization', 'morning and evening routines, hydration, sleep, movement, reading, cleaning, screen breaks, outdoors, reflection, streaks and gentle restarts'),
  niche(2104, 'Budget & Personal Finance Planner', '🗓️ Planner & Organization', 'income, bills, savings, spending, debt payoff, subscriptions, cash flow, taxes, shopping, emergency funds, goals and generic money symbols'),
  niche(2105, 'Meal Planning & Grocery System', '🗓️ Planner & Organization', 'weekly menus, breakfast, lunch, dinner, snacks, groceries, pantry, meal prep, leftovers, recipes, dining out, hydration and kitchen tasks'),
  niche(2106, 'Home Management & Cleaning', '🗓️ Planner & Organization', 'every room, daily and weekly cleaning, laundry, decluttering, repairs, groceries, recycling, garden, pets and seasonal maintenance'),
  niche(2107, 'Family Organizer', '🗓️ Planner & Organization', 'family schedules, school, appointments, chores, shopping, meals, bills, celebrations, transport, reminders, pet care and time together'),
  niche(2108, 'Student Study Toolkit', '🗓️ Planner & Organization', 'classes, assignments, exams, revision, labs, notes, reading, campus life, stationery, study breaks, sleep, deadlines and motivation'),
  niche(2109, 'Teacher Planning Toolkit', '🗓️ Planner & Organization', 'lesson planning, broad subjects, classroom supplies, grading, communication, routines, student celebrations, field trips, seasons and teacher rest'),
  niche(2110, 'Wedding Planning System', '🗓️ Planner & Organization', 'budget, venues, vendors, guest list, attire, flowers, invitations, timeline, ceremony, reception, gifts, travel and celebration'),
  niche(2111, 'Travel Planner Toolkit', '🗓️ Planner & Organization', 'inspiration, budget, generic documents, packing, flights, trains, drives, lodging, food, sightseeing, weather, photos and return-home tasks'),
  niche(2112, 'Reading Journal & Book Tracker', '🗓️ Planner & Organization', 'to-read lists, current reads, broad genres, ratings, reviews, library trips, book clubs, annotations, challenges, cozy moments and shelf goals'),
  niche(2113, 'Garden Journal & Plant Care', '🗓️ Planner & Organization', 'seeds, sowing, watering, feeding, pruning, propagation, harvest, weather, pests, pollinators, tools, produce, herbs and flowers'),
  niche(2114, 'Content Creator Workflow', '🗓️ Planner & Organization', 'ideas, scripting, photography, filming, editing, scheduling, publishing, analytics, community, collaborations, invoices, equipment and creative blocks'),
  niche(2115, 'Project Management & Focus', '🗓️ Planner & Organization', 'project stages, milestones, tasks, priorities, deep work, meetings, blockers, decisions, review, teamwork, deadlines, launches and completion'),

  // 3. High-volume food and hospitality themes
  niche(2201, 'Coffee Shop & Cafe Culture', '🍜 Food & Drink', 'espresso drinks, iced coffee, brewing tools, cafe pastries, mugs, takeaway cups, beans, barista moments, cozy tables and coffee moods'),
  niche(2202, 'Tea, Matcha & Slow Mornings', '🍜 Food & Drink', 'black green and herbal tea, matcha, kettles, teapots, cups, strainers, tea foods, quiet mornings, garden ingredients and tea rituals'),
  niche(2203, 'Baking, Bread & Desserts', '🍜 Food & Drink', 'bread, cakes, cookies, pies, pastries, dough, ovens, baking tools, ingredients, decorating, bakery displays and celebration desserts'),
  niche(2204, 'Breakfast & Brunch Club', '🍜 Food & Drink', 'eggs, toast, pancakes, waffles, fruit, cereal, pastries, coffee, tea, brunch plates, table settings, cooking and weekend moods'),
  niche(2205, 'Fresh Produce & Farmers Market', '🍜 Food & Drink', 'seasonal fruit, vegetables, herbs, baskets, market stands, scales, reusable bags, flowers, preserves, farm tools and harvest moments'),
  niche(2206, 'Pasta, Pizza & Italian Kitchen', '🍜 Food & Drink', 'pasta shapes, sauces, pizza, tomatoes, herbs, cheese, kitchen tools, table settings, market ingredients and family-style meals'),
  niche(2207, 'Global Street Food', '🍜 Food & Drink', 'distinct street-food dishes and serving objects from multiple regions represented respectfully, stalls, utensils, ingredients, condiments and shared eating moments'),
  niche(2208, 'Sushi, Noodles & Asian Comfort Food', '🍜 Food & Drink', 'generic sushi varieties, noodle bowls, dumplings, rice dishes, tea, sauces, chopsticks, steamers, ingredients and restaurant moments without branding'),
  niche(2209, 'Tacos, Salsa & Fiesta Food', '🍜 Food & Drink', 'tacos, tortillas, salsa, peppers, corn, beans, citrus, street-food plates, cooking tools, drinks and colorful shared meals'),
  niche(2210, 'Cocktails, Mocktails & Happy Hour', '🍜 Food & Drink', 'classic drink forms without brand labels, zero-proof drinks, glassware, garnishes, shakers, ice, bar tools, menus without text and social hosting'),
  niche(2211, 'Healthy Meals & Meal Prep', '🍜 Food & Drink', 'balanced plates, grains, produce, proteins, containers, preparation tools, smoothies, snacks, groceries, hydration and flexible everyday eating'),
  niche(2212, 'Picnic & Park Snacks', '🍜 Food & Drink', 'baskets, blankets, sandwiches, fruit, drinks, pastries, reusable containers, games, flowers, sunny weather, friends and park wildlife'),
  niche(2213, 'Retro Diner & Soda Shop', '🍜 Food & Drink', 'burgers, fries, shakes, pies, soda glasses, stools, jukebox-inspired generic objects, checkered accents and cheerful mid-century service'),
  niche(2214, 'Home Chef & Kitchen Life', '🍜 Food & Drink', 'cookware, knives, utensils, ingredients, preparation methods, recipes without readable text, pantry objects, tasting, plating and cleanup'),
  niche(2215, 'Dinner Party & Supper Club', '🍜 Food & Drink', 'tablescapes, candles, glassware, serving dishes, appetizers, main dishes, desserts, flowers, invitations without text, hosting and guest moments'),

  // 4. Evergreen animal buyers
  niche(2301, 'Cute Cats & Cat Parent Life', '🐾 Animals & Pets', 'many cat colors and body types, play, sleep, grooming, food, toys, boxes, windows, plants, vet care and human-cat routines'),
  niche(2302, 'Cute Dogs & Dog Parent Life', '🐾 Animals & Pets', 'varied generic dog forms, walks, play, sleep, training, food, toys, parks, grooming, vet care and human-dog routines'),
  niche(2303, 'Woodland Animals', '🐾 Animals & Pets', 'foxes, deer, rabbits, bears, squirrels, hedgehogs, badgers, owls, forest birds, insects, seasonal activities and woodland objects'),
  niche(2304, 'Farm Animals & Country Life', '🐾 Animals & Pets', 'cows, pigs, sheep, goats, chickens, ducks, horses, barn cats, farm tools, feed, fields, weather and daily care'),
  niche(2305, 'Ocean Animals & Tide Pools', '🐾 Animals & Pets', 'whales, dolphins, seals, turtles, octopus, fish, rays, crabs, starfish, shells, coral, seaweed and conservation moments'),
  niche(2306, 'Birds & Backyard Birdwatching', '🐾 Animals & Pets', 'songbirds, water birds, raptors, owls, feathers, nests, eggs, feeders, binoculars, field notes, habitats and seasonal behavior'),
  niche(2307, 'Butterflies, Moths & Tiny Insects', '🐾 Animals & Pets', 'butterflies, moths, bees, beetles, ladybirds, dragonflies, caterpillars, cocoons, flowers, leaves, pollination and specimen-like views'),
  niche(2308, 'Dinosaurs & Prehistoric Life', '🐾 Animals & Pets', 'diverse dinosaurs, marine reptiles, flying reptiles, fossils, eggs, footprints, plants, field tools, museum objects and playful paleontology'),
  niche(2309, 'Safari & Jungle Animals', '🐾 Animals & Pets', 'elephants, giraffes, lions, big cats, zebras, rhinos, hippos, monkeys, tropical birds, reptiles, vegetation and watering holes'),
  niche(2310, 'Arctic & Antarctic Animals', '🐾 Animals & Pets', 'polar bears, penguins, seals, whales, arctic foxes, snowy owls, walruses, ice, ocean, research tools and cold-weather behavior'),
  niche(2311, 'Reptiles & Amphibians', '🐾 Animals & Pets', 'geckos, bearded dragons, snakes, turtles, frogs, toads, salamanders, habitats, safe care objects, food, plants and basking moments'),
  niche(2312, 'Rabbits & Small Pets', '🐾 Animals & Pets', 'rabbits, guinea pigs, hamsters, rats, mice, chinchillas, hideouts, hay, vegetables, toys, bedding, play and gentle care'),
  niche(2313, 'Aquarium & Freshwater Life', '🐾 Animals & Pets', 'generic aquarium fish, shrimp, snails, aquatic plants, stones, wood, filters, feeding, bubbles, tank tools and peaceful underwater compositions'),
  niche(2314, 'Horse & Stable Life', '🐾 Animals & Pets', 'varied horses, grooming, tack without logos, stable tools, feed, riding safety, pasture, transport, competitions without official marks and horse-human bonds'),
  niche(2315, 'Funny Urban Wildlife', '🐾 Animals & Pets', 'raccoons, pigeons, opossums, squirrels, crows, foxes and other adaptable city animals interacting with ordinary objects in playful original situations'),

  // 5. Nature and outdoor lifestyles
  niche(2401, 'Wildflowers & Meadow Life', '🌿 Nature & Outdoors', 'wildflower species, grasses, bouquets, seeds, garden tools, meadow insects, birds, weather, picnics and seasonal growth'),
  niche(2402, 'Mushrooms, Moss & Forest Floor', '🌿 Nature & Outdoors', 'diverse mushrooms, moss, lichens, ferns, logs, stones, tiny forest creatures, baskets, field tools and seasonal woodland scenes'),
  niche(2403, 'Houseplants & Indoor Jungle', '🌿 Nature & Outdoors', 'many plant forms, pots, shelves, watering, propagation, pruning, repotting, light, plant-care tools, rooms and pet-safe arrangements'),
  niche(2404, 'Herb & Vegetable Garden', '🌿 Nature & Outdoors', 'culinary herbs, vegetables, seeds, beds, tools, watering, compost, pollinators, harvest baskets, pests and seasonal garden work'),
  niche(2405, 'Camping, Campfires & Cabins', '🌿 Nature & Outdoors', 'tents, cabins, campfires, cookware, sleeping gear, backpacks, maps, weather, forest wildlife, stargazing, safety objects and camp routines'),
  niche(2406, 'Hiking, Trails & Mountains', '🌿 Nature & Outdoors', 'boots, packs, trail markers without official logos, maps, peaks, forests, waterfalls, snacks, weather, wildlife, rest and summit moments'),
  niche(2407, 'National Parks & Conservation', '🌿 Nature & Outdoors', 'generic protected landscapes, wildlife, ranger tools without official marks, trail care, leave-no-trace objects, maps, camping and conservation actions'),
  niche(2408, 'Desert Landscapes & Cacti', '🌿 Nature & Outdoors', 'cacti, succulents, desert flowers, rocks, dunes, canyons, wildlife, sun, moon, hiking gear, water and desert-home details'),
  niche(2409, 'Lake, River & Freshwater Life', '🌿 Nature & Outdoors', 'lakes, rivers, canoes, kayaks, docks, freshwater fish, water birds, reeds, swimming, fishing gear, cabins and changing weather'),
  niche(2410, 'Surf, Beach & Summer Coast', '🌿 Nature & Outdoors', 'surfboards without logos, waves, beach gear, lifeguard objects without official marks, shells, snacks, sunsets, coastal plants and summer activities'),
  niche(2411, 'Weather, Clouds & Seasons', '🌿 Nature & Outdoors', 'cloud types, rain, storms, sun, wind, snow, fog, rainbows, thermometers, umbrellas, seasonal clothing and expressive weather characters'),
  niche(2412, 'Astronomy & Stargazing', '🌿 Nature & Outdoors', 'planets, moons, stars, constellations without copied charts, telescopes, observatories, astronauts, rockets, night landscapes and astronomy tools'),
  niche(2413, 'Rocks, Crystals & Geology', '🌿 Nature & Outdoors', 'rocks, minerals, crystals, fossils, strata, volcanoes, field hammers, magnifiers, maps, collections, museums and geological processes'),
  niche(2414, 'Eco Living & Sustainability', '🌿 Nature & Outdoors', 'reusables, repair, recycling, compost, gardening, clean transport, energy saving, water care, secondhand objects, community swaps and nature protection'),
  niche(2415, 'Adventure Field Journal', '🌿 Nature & Outdoors', 'maps, compasses, field notebooks, specimen containers, binoculars, trail objects, weather tools, tickets without text, discoveries and travel keepsakes'),

  // 6. Creative identity and hobby communities
  niche(2501, 'Crochet, Knitting & Yarn Craft', '🎨 Hobbies & Creativity', 'yarn types, hooks, needles, stitches, patterns without readable text, works in progress, finished garments, storage, gifts and cozy crafting moments'),
  niche(2502, 'Sewing, Quilting & Embroidery', '🎨 Hobbies & Creativity', 'fabric, thread, needles, hoops, machines without logos, scissors, pins, patterns without text, quilts, garments, mending and studio organization'),
  niche(2503, 'Painting & Illustration Studio', '🎨 Hobbies & Creativity', 'paint media, brushes, palettes, papers, easels, sketchbooks, color mixing, studio storage, works in progress, creative blocks and finished art'),
  niche(2504, 'Pottery & Ceramics', '🎨 Hobbies & Creativity', 'clay, wheels, hand-building tools, glazes, kilns, studio shelves, mugs, bowls, sculptural forms, works in progress and firing results'),
  niche(2505, 'Journaling & Scrapbooking', '🎨 Hobbies & Creativity', 'journals, pens, tapes, tabs, stamps, photos without faces, paper scraps, charms, memory objects, layouts without readable text and desk scenes'),
  niche(2506, 'Photography & Film Cameras', '🎨 Hobbies & Creativity', 'generic cameras, lenses, film rolls, contact sheets without brands, darkroom tools, tripods, bags, lighting, photo walks and editing objects'),
  niche(2507, 'Music Lover & Home Studio', '🎨 Hobbies & Creativity', 'generic instruments, headphones, microphones, speakers, records, cables, sheet-music symbols without copied songs, practice and recording moments'),
  niche(2508, 'Dance & Movement', '🎨 Hobbies & Creativity', 'multiple dance genres, shoes, rehearsal clothes, music objects, warmups, stage lights, expressive poses, classes, practice and performance moments'),
  niche(2509, 'Board Games, Cards & Puzzles', '🎨 Hobbies & Creativity', 'generic dice, pawns, cards, boards, tiles, puzzles, score objects without readable text, snacks, game night, strategy and celebration'),
  niche(2510, 'Cozy Gaming & Streaming', '🎨 Hobbies & Creativity', 'generic controllers, keyboards, headsets, handheld devices, cozy setups, fantasy and sci-fi genre symbols, co-op play, snacks, wins, losses and breaks'),
  niche(2511, 'Running, Walking & Race Day', '🎨 Hobbies & Creativity', 'shoes without logos, routes, watches without interfaces, water, warmups, varied runners, weather, training, rest, finish moments and supportive spectators'),
  niche(2512, 'Cycling & Bike Life', '🎨 Hobbies & Creativity', 'road city and mountain bicycles without brands, helmets, tools, routes, lights, bags, repair, weather, group rides, commuting and rest stops'),
  niche(2513, 'Yoga, Pilates & Stretching', '🎨 Hobbies & Creativity', 'inclusive movement poses, mats, blocks, straps, clothing, breath symbols, studio objects, home practice, water, recovery and calm moments'),
  niche(2514, 'Fishing & Waterside Hobbies', '🎨 Hobbies & Creativity', 'generic rods, reels, lures, tackle, freshwater and coastal fish, boats, docks, clothing, weather, catch-and-release and quiet waterside moments'),
  niche(2515, 'Woodworking & DIY Maker', '🎨 Hobbies & Creativity', 'hand tools, safe power tools without brands, wood species, measuring, joints, sanding, finishing, workshop storage, repairs and completed projects'),

  // 7. Home, gifting and social connection
  niche(2601, 'Homebody Cozy Weekend', '🏠 Home, Family & Social', 'sleeping in, breakfast, reading, gaming, crafts, movies without titles, baking, pets, plants, blankets, baths, naps and rainy windows'),
  niche(2602, 'Cleaning, Laundry & Chore Humor', '🏠 Home, Family & Social', 'cleaning tools, laundry stages, rooms, clutter, recycling, repairs, schedules without text, tired reactions, small wins and rest after chores'),
  niche(2603, 'New Home & Housewarming', '🏠 Home, Family & Social', 'keys without branding, boxes, rooms, tools, plants, gifts, paint, furniture, first meal, utilities, neighbors and settling-in moments'),
  niche(2604, 'Friendship & Besties', '🏠 Home, Family & Social', 'shared food, messages without interfaces, hobbies, trips, support, inside-joke energy without copied phrases, gifts, celebrations and everyday connection'),
  niche(2605, 'Love, Dating & Anniversaries', '🏠 Home, Family & Social', 'dates, flowers, food, gifts, shared hobbies, travel, home moments, affection, milestones, inclusive couples and original romantic symbols'),
  niche(2606, 'Family Time & Traditions', '🏠 Home, Family & Social', 'shared meals, games, trips, photos, recipes without text, celebrations, stories, crafts, outdoor time, inclusive generations and everyday care'),
  niche(2607, 'New Baby & Parent Life', '🏠 Home, Family & Social', 'baby essentials, feeding, sleep, clothing, toys, transport, bath time, parent rest, family support, milestones and gentle everyday moments'),
  niche(2608, 'Kids Activities & Playtime', '🏠 Home, Family & Social', 'building, drawing, reading, outdoor play, pretend play, puzzles, science activities, music, sports, snacks, cleanup and quiet time'),
  niche(2609, 'Pet-Friendly Home', '🏠 Home, Family & Social', 'pet beds, bowls, toys, gates, cleaning, feeding, grooming, storage, plants, furniture protection, play, rest and shared home routines'),
  niche(2610, 'Dinner Party Host', '🏠 Home, Family & Social', 'planning, groceries, cooking, tablescapes, candles, flowers, serving, drinks, guests, conversation symbols, cleanup and thank-you gifts'),
  niche(2611, 'Craft Night With Friends', '🏠 Home, Family & Social', 'painting, crochet, collage, clay, beads, papers, snacks, drinks, shared supplies, works in progress, laughter and completed keepsakes'),
  niche(2612, 'Community & Neighborhood Life', '🏠 Home, Family & Social', 'neighbors, local shops without brands, parks, libraries, gardens, markets, volunteering, shared meals, noticeboards without text and mutual help'),
  niche(2613, 'Little Treats & Small Wins', '🏠 Home, Family & Social', 'tiny gifts, favorite drinks, pastries, flowers, naps, books, hobbies, completed chores, celebration objects and joyful everyday rewards', true),
  niche(2614, 'Positive Emotions & Encouragement', '🏠 Home, Family & Social', 'confidence, calm, joy, courage, patience, boundaries, friendship, gratitude, difficult days, recovery and visual mood symbols with minimal original words'),
  niche(2615, 'Party, Gifts & Celebration', '🏠 Home, Family & Social', 'balloons, cakes, candles, wrapping, bows, invitations without text, party food, music objects, decorations, guests, photos and cleanup'),

  // 8. Practical identity packs with broad occupational coverage
  niche(2701, 'Work, Office & Productivity', '💼 Work, School & Professions', 'focus, meetings, email without interfaces, projects, deadlines, remote work, office tools, teamwork, breaks, time blocking, admin and achievements'),
  niche(2702, 'Remote Work & Home Office', '💼 Work, School & Professions', 'desks, generic computers, calls without logos, focus, pets, snacks, posture, breaks, lighting, schedules, household interruptions and work-life boundaries'),
  niche(2703, 'Nurses & Everyday Medical Work', '💼 Work, School & Professions', 'generic clinical tools, shift routines, patient-care symbols, scrubs, documentation, teamwork, breaks, hand care, hydration and professional pride without medical claims'),
  niche(2704, 'Doctors, Clinics & Healthcare Teams', '💼 Work, School & Professions', 'generic diagnostic tools, appointments, teamwork, rooms, records without private data, hygiene, patient support, rounds, rest and broad medical symbols'),
  niche(2705, 'Teachers & Classroom Life', '💼 Work, School & Professions', 'broad subjects, classroom supplies, lessons, grading, communication, routines, celebrations, field trips, seasons, student support and teacher rest'),
  niche(2706, 'Software Developers & Coding Life', '💼 Work, School & Professions', 'generic code symbols without copied interfaces, laptops, keyboards, debugging, planning, testing, deployment, teamwork, coffee, errors, breaks and launches'),
  niche(2707, 'Designers & Creative Professionals', '💼 Work, School & Professions', 'sketching, typography tools without readable fonts, color, layout, photography, prototypes, feedback, files without interfaces, presentations and studio work'),
  niche(2708, 'Scientists & Laboratory Life', '💼 Work, School & Professions', 'generic lab tools, samples, safety gear, microscopes, field notes, experiments, data symbols without claims, teamwork, cleanup and discovery'),
  niche(2709, 'Trades, Tools & Workshop Life', '💼 Work, School & Professions', 'carpentry, electrical, plumbing, welding and repair tools, safety gear, measuring, vehicles without logos, job sites, breaks and completed work'),
  niche(2710, 'Beauty, Hair & Nail Professionals', '💼 Work, School & Professions', 'generic salon tools, hair care, nail care, color mixing, appointments without text, hygiene, client comfort, storage, creativity and business routines'),
  niche(2711, 'Hospitality, Cafe & Restaurant Teams', '💼 Work, School & Professions', 'front and back of house, menus without text, coffee, cooking, serving, cleaning, reservations, teamwork, uniforms without logos, rushes and breaks'),
  niche(2712, 'Veterinary & Animal Care Teams', '💼 Work, School & Professions', 'generic animal-care tools, varied patients, appointments, grooming, feeding, records without data, teamwork, comfort, cleaning and professional pride'),
  niche(2713, 'First Responders & Emergency Teams', '💼 Work, School & Professions', 'generic emergency tools and vehicles without official marks, communication, safety gear, teamwork, readiness, training, rest and community support'),
  niche(2714, 'Office Admin & Customer Support', '💼 Work, School & Professions', 'schedules, calls without interfaces, messages, filing, documents without data, problem solving, teamwork, breaks, supplies and completed requests'),
  niche(2715, 'Entrepreneur & Market Seller Life', '💼 Work, School & Professions', 'product creation, inventory, displays, markets, packaging, shipping, bookkeeping, customer care, content, rest and business milestones without platform logos'),

  // 9. Supportive, non-clinical lifestyle bundles
  niche(2801, 'Gentle Productivity', '🧘 Wellness & Lifestyle', 'realistic planning, energy-aware tasks, focus, breaks, rest, small steps, flexible routines, rewards, unfinished work and compassionate restarts'),
  niche(2802, 'Mindfulness & Calm Moments', '🧘 Wellness & Lifestyle', 'breathing, meditation, tea, candles, nature, journaling, stretching, quiet rooms, sensory comfort, pauses and reflective symbols without health claims'),
  niche(2803, 'Sleep, Rest & Cozy Evenings', '🧘 Wellness & Lifestyle', 'bedtime routines, pajamas, books, tea, baths, soft lights, blankets, pillows, night skies, pets, alarms without interfaces and slow mornings'),
  niche(2804, 'Movement & Active Life', '🧘 Wellness & Lifestyle', 'walking, running, strength, yoga, cycling, swimming, dance, hiking, stretching, sports gear, progress, recovery and rest days'),
  niche(2805, 'Hydration & Healthy Routines', '🧘 Wellness & Lifestyle', 'water vessels without logos, refill reminders without text, fruit, meals, movement, sleep, outdoors, self-care tools, progress and flexible routines'),
  niche(2806, 'Mood & Emotion Check-In', '🧘 Wellness & Lifestyle', 'many emotions, expressive weather, color symbols, journaling, support, boundaries, rest, connection, coping objects and small wins without clinical claims'),
  niche(2807, 'Therapy & Reflection Tools', '🧘 Wellness & Lifestyle', 'journals, feelings, boundaries, communication, grounding objects, support networks, rest, growth, difficult days and progress without diagnosis or treatment claims'),
  niche(2808, 'Neurodivergent-Friendly Planning', '🧘 Wellness & Lifestyle', 'visual schedules, timers without interfaces, sensory supports, focus, transitions, breaks, interest-led motivation, flexible routines, recovery and self-advocacy'),
  niche(2809, 'Body Neutrality & Inclusive Self-Care', '🧘 Wellness & Lifestyle', 'inclusive bodies and abilities, comfortable clothes, movement, food, rest, hygiene, adaptive tools, boundaries, confidence and everyday care without appearance promises'),
  niche(2810, 'Digital Balance & Screen Breaks', '🧘 Wellness & Lifestyle', 'generic devices, focus modes without interfaces, outdoors, books, hobbies, meals, friends, sleep, charging away, notifications off and mindful technology use'),
  niche(2811, 'Morning Routine & Fresh Start', '🧘 Wellness & Lifestyle', 'waking, light, water, breakfast, hygiene, dressing, planning, movement, commuting, pets and varied realistic morning moods'),
  niche(2812, 'Evening Routine & Wind Down', '🧘 Wellness & Lifestyle', 'dinner, cleanup, bath, skincare without brands, tea, reading, reflection, device rest, family, pets, sleep preparation and quiet lights'),
  niche(2813, 'Personal Growth & Small Steps', '🧘 Wellness & Lifestyle', 'goals, practice, mistakes, learning, courage, boundaries, support, reflection, progress paths, milestones, celebration and restarting'),
  niche(2814, 'Spiritual Reflection & Gentle Rituals', '🧘 Wellness & Lifestyle', 'candles, journals, celestial symbols, seasonal cycles, nature, meditation, symbolic hands, decorative crystals and quiet ritual objects without fortune claims'),
  niche(2815, 'Pride, Belonging & Chosen Family', '🧘 Wellness & Lifestyle', 'inclusive identity color, friendship, community, chosen family, celebration, support, home, hobbies, everyday joy and original affirming symbols without slogans copied from campaigns'),

  // 10. Giftable occasions and reliable annual demand
  niche(2901, 'Birthday Celebration', '🎉 Seasons & Milestones', 'cakes, candles, balloons, gifts, party food, invitations without text, music, games, guests, photos and birthday wishes with optional original micro-copy'),
  niche(2902, 'Wedding & Engagement', '🎉 Seasons & Milestones', 'rings, flowers, venues, attire, invitations without text, ceremony, reception, food, gifts, travel and inclusive couples'),
  niche(2903, 'Baby Shower & New Baby', '🎉 Seasons & Milestones', 'gifts, decorations, baby essentials, food, games without text, family, preparation, nursery objects and inclusive welcoming symbols'),
  niche(2904, 'Graduation & School Milestones', '🎉 Seasons & Milestones', 'caps, gowns, diplomas without seals, school supplies, study, celebration, gifts, family, new paths and broad academic symbols'),
  niche(2905, 'Retirement & New Chapter', '🎉 Seasons & Milestones', 'farewell gifts, hobbies, travel, gardening, family, relaxation, calendars without text, celebration, memories and new daily routines'),
  niche(2906, 'Valentine & Love Season', '🎉 Seasons & Milestones', 'hearts, flowers, sweets, cards without text, dates, friendship, self-kindness, gifts, decorations and inclusive love'),
  niche(2907, 'Spring Garden Celebration', '🎉 Seasons & Milestones', 'new growth, rain, flowers, gardening, birds, insects, picnics, fresh food, spring cleaning, light clothing and seasonal decor'),
  niche(2908, 'Summer Vacation & Pool Days', '🎉 Seasons & Milestones', 'sun, pools, beach, travel, cold drinks, fruit, games, picnics, camping, summer clothing, evening gatherings and warm-weather pets'),
  niche(2909, 'Autumn Harvest & Cozy Season', '🎉 Seasons & Milestones', 'leaves, pumpkins, apples, harvest food, baking, warm drinks, sweaters, woodland animals, rain, candles and autumn gatherings'),
  niche(2910, 'Halloween & Spooky Season', '🎉 Seasons & Milestones', 'friendly ghosts, pumpkins, bats, black cats, costumes, candy, haunted objects, potions, autumn weather and playful original spooky characters'),
  niche(2911, 'Winter Holidays & Cozy Celebration', '🎉 Seasons & Milestones', 'snow, lights, gifts, food, evergreen plants, warm drinks, winter clothing, family and friend gatherings, travel and inclusive seasonal decor'),
  niche(2912, 'New Year & Fresh Start', '🎉 Seasons & Milestones', 'countdown symbols without dates, celebration, planners, cleaning, goals, routines, healthful habits, work, travel and hopeful beginnings'),
  niche(2913, 'Back to School', '🎉 Seasons & Milestones', 'supplies, backpacks without logos, classrooms, subjects, schedules, lunch, transport, friends, teachers, study spaces and first-day emotions'),
  niche(2914, 'Thank You & Appreciation', '🎉 Seasons & Milestones', 'flowers, notes without copied phrases, gifts, food, helping hands, teachers, caregivers, friends, colleagues, neighbors and gratitude symbols'),
  niche(2915, 'Vacation, Road Trip & Getaway', '🎉 Seasons & Milestones', 'packing, maps, generic vehicles, lodging, food, sightseeing, photos, nature, city moments, beaches, souvenirs and returning home'),

  // 11. Current aesthetic worlds translated into sticker-safe subjects
  niche(3001, 'Soft Stitch Handmade World', '🌟 Popular Aesthetic Worlds', 'embroidery, crochet, needlepoint, felt objects, mending, sewing tools, home decor, flowers, animals, food and cozy handmade keepsakes', true),
  niche(3002, 'World of Whimsy', '🌟 Popular Aesthetic Worlds', 'quirky ordinary objects, playful scale, polka dots, cheerful animals, funny food, tiny surprises, hobbies, home and joyful collectible characters', true),
  niche(3003, 'Dear Diary Analog Life', '🌟 Popular Aesthetic Worlds', 'journals, fountain pens, tabs, charms, library cards without text, memory objects, stationery, small photos, desks and everyday keepsakes', true),
  niche(3004, 'Everyday Exhibit Collections', '🌟 Popular Aesthetic Worlds', 'curated personal objects, colorful frames as objects, childhood keepsakes, early-digital nostalgia, hobby collections, shelves and mini museum-like arrangements', true),
  niche(3005, 'Botanical Romance', '🌟 Popular Aesthetic Worlds', 'pressed wildflowers, garden ceremony details, blooms, vines, natural fabrics, letters without text, romantic gifts, jewelry-like objects and sunlit garden moments', true),
  niche(3006, 'Gothic Romance', '🌟 Popular Aesthetic Worlds', 'lace, stained glass, antique silver, wine-dark flowers, candles, books, architecture fragments, jewelry, ravens and elegant romantic mystery', true),
  niche(3007, 'Nonna Kitchen Nostalgia', '🌟 Popular Aesthetic Worlds', 'tomatoes, gingham, embroidered linens, pantry objects, warm ceramics, pasta, garden produce, family-table details and heirloom kitchen charm', true),
  niche(3008, 'Retro Supper Club', '🌟 Popular Aesthetic Worlds', 'jewel-tone glassware, candles, appetizers, serving pieces, table settings, retro hosting objects, music, invitations without text and polished celebration', true),
  niche(3009, 'Dopamine Play House', '🌟 Popular Aesthetic Worlds', 'candy color, oversized bows, playful geometric objects, circus-like shapes without trademarks, cheerful surrealism, home objects and collectible characters', true),
  niche(3010, 'Notes App Chic', '🌟 Popular Aesthetic Worlds', 'paper notes without readable text, doodles, highlights, tape, tabs, desk objects, creative mess, reminders as symbols, small photos and honest daily moments', true),
  niche(3011, 'Tactile Texture World', '🌟 Popular Aesthetic Worlds', 'embossed paper, woven fiber, raised paint, ceramics, wood, fabric, handcrafted food, plants, animals and ordinary objects defined by touchable material', true),
  niche(3012, 'Opt-Out Quiet Life', '🌟 Popular Aesthetic Worlds', 'simple routines, uncluttered rooms, nature, books, analog hobbies, calm food, comfortable clothing, slow travel, rest and intentional everyday objects', true),
  niche(3013, 'Surreal Silliness', '🌟 Popular Aesthetic Worlds', 'ordinary objects with one funny impossible transformation, playful animals, strange food, altered scale, unexpected combinations and original absurd characters', true),
  niche(3014, 'Coquette Bows & Sweet Details', '🌟 Popular Aesthetic Worlds', 'bows, ribbons, lace, cherries, hearts, cakes, perfume-like generic bottles, shoes, flowers, jewelry, letters without text and sweet nostalgic objects'),
  niche(3015, 'Retro 70s Everyday', '🌟 Popular Aesthetic Worlds', 'warm groovy home objects, flowers, music equipment without brands, fashion accessories, food, travel, vehicles, hobbies and optimistic rounded motifs'),

  // 12. Imaginative, tech and adventure markets
  niche(3101, 'Cozy Fantasy Daily Life', '✨ Fantasy, Tech & Adventure', 'original magical homes, potion kitchens, enchanted gardens, creature care, markets, libraries, travel, food, crafts and gentle quests'),
  niche(3102, 'Dragons, Castles & Quests', '✨ Fantasy, Tech & Adventure', 'original dragons, castles, armor, maps, treasure, landscapes, tools, companions, camps, relics, travel and adventure milestones'),
  niche(3103, 'Witches, Potions & Familiar Magic', '✨ Fantasy, Tech & Adventure', 'original witches, potion ingredients, cauldrons, books without copied symbols, brooms, candles, celestial objects, magical pets and cottage routines'),
  niche(3104, 'Fairy Garden & Enchanted Forest', '✨ Fantasy, Tech & Adventure', 'original fairies, tiny homes, flowers, mushrooms, insects, woodland creatures, bridges, lanterns, tools, food and miniature forest life'),
  niche(3105, 'Celestial Magic & Moon Phases', '✨ Fantasy, Tech & Adventure', 'moons, stars, suns, planets, constellations without copied charts, jewelry-like symbols, candles, hands, observatory tools and night creatures'),
  niche(3106, 'Mermaids, Tides & Sea Magic', '✨ Fantasy, Tech & Adventure', 'original merfolk, shells, pearls, sea creatures, underwater plants, treasure, boats, moonlit tides, coastal magic and ocean homes'),
  niche(3107, 'Spooky Cute Creatures', '✨ Fantasy, Tech & Adventure', 'friendly original ghosts, bats, skeletons, black cats, monsters, haunted household objects, treats, costumes, autumn plants and playful nighttime scenes'),
  niche(3108, 'Medieval Cozy Life', '✨ Fantasy, Tech & Adventure', 'cottages, castles, markets, bakers, gardens, animals, crafts, books, kitchens, clothing, tools and travel in an original gentle medieval world'),
  niche(3109, 'Retro Technology & Internet Life', '✨ Fantasy, Tech & Adventure', 'generic desktop computers, folders, disks, handheld devices, cables, loading symbols, chat-like objects without interfaces, digital pets and online-life reactions'),
  niche(3110, 'Robots & Friendly Future', '✨ Fantasy, Tech & Adventure', 'original robots, tools, home help, gardening, cooking, pets, learning, travel, repair, charging, friendship and optimistic future objects'),
  niche(3111, 'Space Travel & Astronaut Life', '✨ Fantasy, Tech & Adventure', 'original rockets, astronauts, stations, planets, tools, food, exercise, communication without interfaces, experiments, exploration and homeward moments'),
  niche(3112, 'Science, Experiments & Discovery', '✨ Fantasy, Tech & Adventure', 'biology, chemistry, physics, geology, astronomy, generic lab and field tools, safe experiments, specimens, museums and curious discovery'),
  niche(3113, 'Mystery, Detective & Clue Hunting', '✨ Fantasy, Tech & Adventure', 'magnifiers, footprints, notebooks without readable text, maps, keys, locks, disguises, evidence objects without violence, puzzles and original mystery characters'),
  niche(3114, 'Pirates, Treasure & Ocean Adventure', '✨ Fantasy, Tech & Adventure', 'original pirates, ships, maps without text, treasure, islands, sea creatures, tools, food, weather, camps and adventurous companions'),
  niche(3115, 'Mythical Creatures Mega Pack', '✨ Fantasy, Tech & Adventure', 'original unicorns, griffins, phoenixes, dragons, sea creatures, forest spirits, celestial animals, eggs, habitats, magical food and creature-care objects')
];
