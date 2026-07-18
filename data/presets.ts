
import { StylePreset, NicheIdea } from '../types';

export const STYLE_PRESETS: StylePreset[] = [
  // NEW AUTO OPTION
  { id: 'auto', name: '✨ Auto-Detect (Use Niche Style)', prompt: 'AUTO_DETECT_FROM_NICHE' },

  // NEW 2025-2026 MACRO TRENDS
  { id: 'y2k_cybercore', name: 'Y2K Cybercore', prompt: '"Y2K cybercore aesthetic"; chrome textures; tribal tattoo motifs; metallic typography; futuristic optimism; pixelated interfaces; cyan and magenta palette; holographic finish; high-gloss 3D look' },
  { id: 'indie_sleaze', name: 'Indie Sleaze (2025 Remix)', prompt: '"Indie Sleaze aesthetic"; gritty flash-photography style; messy and raw; grainy Polaroid texture; photocopy zine effects; hand-scrawled sharpie text; ironic detachment vibe' },
  { id: 'frutiger_aero', name: 'Frutiger Aero', prompt: '"Frutiger Aero aesthetic"; skeuomorphism; water droplets; grassy fields; bubbles; glossy glass textures; corporate utopianism; clear vinyl appearance; bright optimistic digital past' },
  { id: 'micro_industrial', name: 'Micro-Industrial', prompt: '"Micro-industrial aesthetic"; logistics and manufacturing visuals; barcodes; QR codes; shipping label motifs; technical specs; "inspected by" stamps; utilitarian streetwear vibe' },
  { id: 'chaos_maximalism', name: 'Chaos Maximalism', prompt: '"Chaos packaging maximalist"; clashing colors; distorted typography; dense collage; ransom note style; fever dream visuals; chronically online humor; high-energy noise' },
  { id: 'tactile_craft', name: 'Tactile Craft', prompt: '"Tactile craft aesthetic"; faux-embroidery; patches; felt textures; paper cutouts; washi tape edges; dried flower illustrations; 3D depth illusion on flat surface' },
  { id: 'anti_toxic', name: 'Anti-Toxic Positivity', prompt: '"Depression Barbie" humor; "Sad Hamster" aesthetic; validating negative emotions; "bed rotting" cozy characters; sleepy or dissociated mascots; ironic clinical mental health representation' },
  
  // NEW "COOL" STYLES ADDED
  { id: 'risograph_retro', name: 'Risograph Print (Retro)', prompt: '"Risograph print style"; grainy texture; misaligned overlay effects; vibrant neon ink; limited color palette; speckled gradient; retro zine aesthetic; high contrast; rough paper feel' },
  { id: 'clay_3d', name: '3D Clay (Plasticine)', prompt: '"3D clay render"; plasticine texture; soft rounded edges; blender 3d style; isometric view; glossy finish; bright dopamine colors; playful and chunky; stop-motion look' },
  { id: 'airbrush_y2k', name: 'Airbrush Graffiti', prompt: '"Airbrush graffiti style"; soft fuzzy edges; glowing neon centers; street art vibe; bubble letters; early 2000s mall kiosk aesthetic; starry sparkles; pastel gradients' },
  { id: 'vintage_science', name: 'Vintage Scientific', prompt: '"Vintage scientific illustration"; botanical plate style; fine ink stippling; aged paper texture; anatomical precision; muted earth tones; biology textbook aesthetic; etching lines' },
  { id: 'pixel_high_bit', name: 'Pixel Art (High-Bit)', prompt: '"High-bit pixel art"; 32-bit game asset; vibrant color palette; crisp pixel edges; SNES rpg style; isometric perspective; nostalgic gaming vibe; dithering shading' },
  { id: 'stained_glass', name: 'Stained Glass Outline', prompt: '"Stained glass style"; thick black lead lines; translucent vibrant color fills; geometric segmentation; glowing light effect; spiritual and mystical vibe' },
  { id: 'paper_collage', name: 'Cut-Paper Collage', prompt: '"Cut-paper collage"; visible scissor edges; layered paper shadows; mixed media texture; magazine cutouts; dadaist composition; raw and handmade look' },
  { id: 'vaporwave_grid', name: 'Vaporwave Grid', prompt: '"Vaporwave aesthetic"; neon grid background; retro computer graphics; greek statues; palm trees; pink and purple gradient; vhs glitch effect; lo-fi mood' },

  // NEW REPORT ADDITIONS (2025-2026 MASS MARKET AESTHETICS)
  { id: 'dopamine_design', name: 'Dopamine Design', prompt: '"Dopamine Design aesthetic"; high-saturation electric colors; neon blues and hot pinks; glitter texture effect; holographic overlay; visual vibration; loud and unapologetic; maximalist; gamified visuals' },
  { id: 'human_premium', name: 'Human Premium (Hand-Drawn)', prompt: '"Human Premium aesthetic"; hand-drawn imperfection; wobbly lines; visible brushstrokes; watercolor texture; sketch marks; naive art style; authentic and grounded; not vectorized; perfectly imperfect' },
  { id: 'modern_natural', name: 'Modern Natural (Calm-First)', prompt: '"Modern Natural aesthetic"; calm-first design; plenty of white space; soothing serif fonts; sage green and terracotta palette; organic abstract shapes; botanical line art; mindfulness vibe' },

  // CLASSIC HIGH-CONVERSION STYLES
  { id: 'kawaii', name: 'Clean Kawaii Vector', prompt: '"clean kawaii vector"; smooth flat colors; subtle 2-tone shading; cute facial features; crisp edges; white die-cut outline; sRGB' },
  { id: 'minimal', name: 'Minimalist Line Art', prompt: '"minimal line art"; thin clean outline; muted accent colors only; premium modern look; white die-cut outline' },
  { id: 'gothic', name: 'Dark Academia Gothic', prompt: '"dark academia gothic"; vintage books; Greek busts; coffee stains; tweed textures; muted browns and deep blacks; white die-cut outline' }
];

export const NICHE_IDEAS: NicheIdea[] = [
  // Cluster A: Professional Identity & Workplace Coping
  { id: 101, name: "ICU Nurses (High-Stress Humor)", category: "Professional Identity" },
  { id: 102, name: "Night Shift Workers (Vampire/Caffeine Motifs)", category: "Professional Identity" },
  { id: 103, name: "Medical Coders (ICD-10 Jargon)", category: "Professional Identity" },
  { id: 104, name: "Speech-Language Pathologists (IPA/Anatomy)", category: "Professional Identity" },
  { id: 105, name: "Software Developers (Spaghetti Code/Rust/Python)", category: "Professional Identity" },
  { id: 106, name: "Cybersecurity Analysts (White Hat/Incognito)", category: "Professional Identity" },
  { id: 107, name: "Welding & Trades (Union Pride/Safety Warnings)", category: "Professional Identity" },
  { id: 108, name: "Dental Hygienists (Tooth Anatomy/Flossing Guilt)", category: "Professional Identity" },
  { id: 109, name: "Special Education Teachers (Neurodiversity Symbols)", category: "Professional Identity" },
  { id: 110, name: "Paralegals (Legal Jargon/Lawyer's Work)", category: "Professional Identity" },
  { id: 111, name: "Baristas (Latte Art/Death Before Decaf)", category: "Professional Identity" },
  { id: 112, name: "Linemen/Electricians (Danger/High Voltage)", category: "Professional Identity" },
  { id: 113, name: "Social Workers (Burnout Prevention/Case File)", category: "Professional Identity" },
  { id: 114, name: "Phlebotomists (Vampire Jokes/Vein Anatomy)", category: "Professional Identity" },
  { id: 115, name: "Veterinary Techs (Restraining Animals/Fur Everywhere)", category: "Professional Identity" },
  { id: 116, name: "Truck Drivers (Mileage Bragging/Diesel)", category: "Professional Identity" },
  { id: 117, name: "Hair Stylists (Hair Therapist/Bleach)", category: "Professional Identity" },
  { id: 118, name: "HVAC Technicians (I fix what you broke)", category: "Professional Identity" },
  { id: 119, name: "Court Reporters (Steno/Silence)", category: "Professional Identity" },
  { id: 120, name: "Forensic Scientists (DNA/Fingerprint)", category: "Professional Identity" },
  
  // Cluster B: Mental Health & Neurodiversity
  { id: 201, name: "Late-Diagnosed ADHD Women (Dopamine Menu)", category: "Neurodiversity" },
  { id: 202, name: "Autism Unmasking (Special Interests/Infinity Symbol)", category: "Neurodiversity" },
  { id: 203, name: "Sensory Processing Disorder (No Loud Noises)", category: "Neurodiversity" },
  { id: 204, name: "Dissociative Humor (Opossums/Raccoons)", category: "Neurodiversity" },
  { id: 205, name: "Therapy Veterans (Inner Child Healing)", category: "Neurodiversity" },
  { id: 206, name: "Anxiety Visualization (Brain Bees)", category: "Neurodiversity" },
  { id: 207, name: "Depression 'Rotting' (Cozy Beds/Skeletons)", category: "Neurodiversity" },
  { id: 208, name: "Bipolar Awareness (Weather Metaphors)", category: "Neurodiversity" },
  { id: 209, name: "OCD Actual (Intrusive Thoughts Advocacy)", category: "Neurodiversity" },
  { id: 210, name: "Sobriety/Recovery (One Day at a Time)", category: "Neurodiversity" },

  // Cluster C: Hyper-Specific Hobbies & Fandoms
  { id: 301, name: "Mechanical Keyboard Enthusiasts (Thock/Switches)", category: "Hyper-Specific Hobbies" },
  { id: 302, name: "Dungeon Masters (TPK/Dice Towers)", category: "Hyper-Specific Hobbies" },
  { id: 303, name: "Cozy Gamers (Farming Sims/Steam Deck)", category: "Hyper-Specific Hobbies" },
  { id: 304, name: "BookTok/Romantasy (Spice Ratings/Dragons)", category: "Hyper-Specific Hobbies" },
  { id: 305, name: "Urban Gardening (Propagation Stations)", category: "Hyper-Specific Hobbies" },
  { id: 306, name: "Knitting/Crochet (Yarn Chicken/Hook Sizes)", category: "Hyper-Specific Hobbies" },
  { id: 307, name: "Film Photography (35mm/Grain is Good)", category: "Hyper-Specific Hobbies" },
  { id: 308, name: "Birdwatching (Life List/Specific Species)", category: "Hyper-Specific Hobbies" },
  { id: 309, name: "Formula 1 Fans (Track Layouts/Radio Quotes)", category: "Hyper-Specific Hobbies" },
  { id: 310, name: "True Crime Junkies (SSDGM/Red String)", category: "Hyper-Specific Hobbies" },
  { id: 311, name: "Pickleball Players (Dink Jokes)", category: "Hyper-Specific Hobbies" },
  { id: 312, name: "Mechanical Watch Collectors (Movement Diagrams)", category: "Hyper-Specific Hobbies" },
  { id: 313, name: "Pottery/Ceramics (Mud Witch/Kiln)", category: "Hyper-Specific Hobbies" },
  { id: 314, name: "Rock Climbing (V-Scale/Chalk)", category: "Hyper-Specific Hobbies" },
  { id: 315, name: "Journaling/Planners (Functional/Mood Pixels)", category: "Hyper-Specific Hobbies" },
  { id: 316, name: "Mycology (Spore Prints/Foraging)", category: "Hyper-Specific Hobbies" },
  { id: 317, name: "Aquascaping (Betta Fish/Underwater Zen)", category: "Hyper-Specific Hobbies" },
  { id: 318, name: "Cosplay Makers (Heat Gun/Con Crunch)", category: "Hyper-Specific Hobbies" },
  { id: 319, name: "Disc Golf (Flight Numbers/Basket Chains)", category: "Hyper-Specific Hobbies" },
  { id: 320, name: "Pole Fitness (Strength Poses/Not Stripping)", category: "Hyper-Specific Hobbies" },

  // Cluster D: Lifestyle & Identity Subcultures
  { id: 401, name: "Van Life/Nomads (Solar Panels/Rust)", category: "Lifestyle Subcultures" },
  { id: 402, name: "Granola Girls (Hiking Boots/Topography)", category: "Lifestyle Subcultures" },
  { id: 403, name: "Cottagecore (Frogs playing Banjos)", category: "Lifestyle Subcultures" },
  { id: 404, name: "Goblincore (Shinies/Moss/Mud/Frogs)", category: "Lifestyle Subcultures" },
  { id: 405, name: "Dark Academia (Greek Busts/Latin Phrases)", category: "Lifestyle Subcultures" },
  { id: 406, name: "Pastel Goth (Creepy Pinks/Baby Coffins)", category: "Lifestyle Subcultures" },
  { id: 407, name: "Zero Waste Eco-Warriors (Compost Everything)", category: "Lifestyle Subcultures" },
  { id: 408, name: "Child-Free by Choice (DINK Lifestyle)", category: "Lifestyle Subcultures" },
  { id: 409, name: "Homeschool Moms (Not Socialized Irony)", category: "Lifestyle Subcultures" },
  { id: 410, name: "Trad Goth (80s Batcave/Bauhaus)", category: "Lifestyle Subcultures" },

  // Cluster E: Pets (Breed Specific)
  { id: 501, name: "Reactive/Anxious Dogs (Give Me Space)", category: "Pets" },
  { id: 502, name: "Greyhounds/Sighthounds (Noodle Horse)", category: "Pets" },
  { id: 503, name: "Orange Cat Energy (One Brain Cell)", category: "Pets" },
  { id: 504, name: "Reptile Keepers (Bearded Dragons/Crickets)", category: "Pets" },
  { id: 505, name: "Chicken Keepers (Backyard Dinosaur/Chicken Math)", category: "Pets" },
  { id: 506, name: "Pitbull Advocacy (Velvet Hippo)", category: "Pets" },
  { id: 507, name: "Senior Pet Love (Old Dogs Rule)", category: "Pets" },
  { id: 508, name: "Rabbit/Bunny Owners (Spicy Hay/Binkying)", category: "Pets" },
  { id: 509, name: "Rat Dads/Moms (Pocket Puppy)", category: "Pets" },
  { id: 510, name: "Working Dogs (Malinois/Do Not Pet)", category: "Pets" },

  // Cluster F: Automotive & Functional
  { id: 601, name: "Manual Transmission (Save the Manuals)", category: "Automotive" },
  { id: 602, name: "Slow Vehicle Warnings (0 to 60 in 3-5 Business Days)", category: "Automotive" },
  { id: 603, name: "New Driver/Student (Screaming Opossum)", category: "Automotive" },
  { id: 604, name: "JDM (Hiragana/Drift Charms)", category: "Automotive" },
  { id: 605, name: "Overlanding (4x4 Engaging/Mud Splatter)", category: "Automotive" },
  { id: 606, name: "Dash Cam Warnings (Smile You're On Camera)", category: "Automotive" },
  { id: 607, name: "EV Owners (Powered by the Sun)", category: "Automotive" },
  { id: 608, name: "Gas Guzzlers (MPG LOL/Prius Repellent)", category: "Automotive" },
  { id: 609, name: "Motorcycle Helmet Decals (Blood Type/Look Twice)", category: "Automotive" },
  { id: 610, name: "Bumper Strip Family (Zombie/Star Wars Families)", category: "Automotive" },

  // Cluster G: LGBTQ+ & Social Identity
  { id: 701, name: "Subtle Pride (Landscape Flag Palettes)", category: "Social Identity" },
  { id: 702, name: "Trans Joy (Estrogen Burger/T-Boy Swag)", category: "Social Identity" },
  { id: 703, name: "Non-Binary/Enby (Gender is a Construct)", category: "Social Identity" },
  { id: 704, name: "Sapphic Culture (Carabiners/Lavender)", category: "Social Identity" },
  { id: 705, name: "Asexual/Ace (Garlic Bread Jokes)", category: "Social Identity" },
  { id: 706, name: "Intersectional Feminism (Smash the Patriarchy)", category: "Social Identity" },
  { id: 707, name: "Body Neutrality (My Body is a Vessel)", category: "Social Identity" },
  { id: 708, name: "Pronoun Sets (Simple/Readable)", category: "Social Identity" },
  { id: 709, name: "Drag Culture (Shantay You Stay/Queens)", category: "Social Identity" },
  { id: 710, name: "Polyamory (Infinity Heart/Calendar Jokes)", category: "Social Identity" },

  // Cluster H: Regional & Local Pride
  { id: 801, name: "National Parks (Badge Style Specific Parks)", category: "Regional" },
  { id: 802, name: "Midwest Emo/Culture (Ope/Ranch Dressing)", category: "Regional" },
  { id: 803, name: "PNW (Sasquatch/Rain/Ferns)", category: "Regional" },
  { id: 804, name: "Southern Gothic (Spanish Moss/Bless Your Heart)", category: "Regional" },
  { id: 805, name: "NYC/City Rat (Pizza Rat/Bodega Cats)", category: "Regional" },
  { id: 806, name: "Desert Dwellers (Dry Heat Irony)", category: "Regional" },
  { id: 807, name: "Appalachian Folklore (Mothman/Banjo)", category: "Regional" },
  { id: 808, name: "Texas Pride (Everything Shaped like Texas)", category: "Regional" },
  { id: 809, name: "Lake Life (Pontoon/Freshwater)", category: "Regional" },
  { id: 810, name: "Surf/Coastal (Locals Only/Shaka)", category: "Regional" },

  // Cluster I: Winning Concepts (2026)
  { id: 901, name: "Dissociating Animal (Possum/Juice Box)", category: "🔥 Winning Concepts 2026" },
  { id: 902, name: "Retro Windows Error (Anxiety.exe)", category: "🔥 Winning Concepts 2026" },
  { id: 903, name: "Holographic Tarot (Modern Archetypes)", category: "🔥 Winning Concepts 2026" },
  { id: 904, name: "Ghost Reading Book (Spooky BookTok)", category: "🔥 Winning Concepts 2026" },
  { id: 905, name: "Floral Uterus (Reproductive Rights)", category: "🔥 Winning Concepts 2026" },
  { id: 906, name: "Neurospicy Ingredients Label (100% Chaos)", category: "🔥 Winning Concepts 2026" },
  { id: 907, name: "Screaming Opossum (Internal Screaming)", category: "🔥 Winning Concepts 2026" },
  { id: 908, name: "Fragile Handle With Care (Unprocessed Trauma)", category: "🔥 Winning Concepts 2026" },
  { id: 909, name: "Cozy Gamer Tamagotchi (90s Nostalgia)", category: "🔥 Winning Concepts 2026" },
  { id: 910, name: "Biblically Accurate Angel (Be Not Afraid)", category: "🔥 Winning Concepts 2026" },
  { id: 911, name: "Library Due Date Card (Dark Academia)", category: "🔥 Winning Concepts 2026" },
  { id: 912, name: "\"I Brake For...\" (Mothman/Goth Girls)", category: "🔥 Winning Concepts 2026" },
  { id: 913, name: "Crystal Grid (Sacred Geometry)", category: "🔥 Winning Concepts 2026" },
  { id: 914, name: "Gradient Aura (Angel Numbers)", category: "🔥 Winning Concepts 2026" },
  { id: 915, name: "Kodak Portra Border (Film Aesthetic)", category: "🔥 Winning Concepts 2026" },
  { id: 916, name: "Loading Bar (Patience/Caffeine)", category: "🔥 Winning Concepts 2026" },
  { id: 917, name: "Forklift Operator Badge (Ironic Masculinity)", category: "🔥 Winning Concepts 2026" },
  { id: 918, name: "Periodic Table Spell-Out (S-Ar-Ca-Sm)", category: "🔥 Winning Concepts 2026" },
  { id: 919, name: "Hydration Tracker Bottle Wrap (Functional)", category: "🔥 Winning Concepts 2026" },

  // Cluster J: Mass Market Shift 2026 (The "Big Five")
  { id: 1001, name: "Granola Girl (Mushrooms/Ferns/Topographic)", category: "Mass Market 2026" },
  { id: 1002, name: "Cozy Gamer Lofi (Pastel/Pixel Hearts)", category: "Mass Market 2026" },
  { id: 1003, name: "Anti-Wellness (Dumpster Fire/Glitch Text)", category: "Mass Market 2026" },
  { id: 1004, name: "Romantasy BookTok (Dragons/Daggers)", category: "Mass Market 2026" },
  { id: 1005, name: "Y2K McBling (Flip Phones/Rhinestones)", category: "Mass Market 2026" },
  { id: 1006, name: "Capybara Zen (Opt-Out Era)", category: "Mass Market 2026" },
  { id: 1007, name: "Teacher Tired (Grade Specific Humor)", category: "Mass Market 2026" },
  { id: 1008, name: "Trash Animals (Raccoons/Pigeons Chaos)", category: "Mass Market 2026" },
  { id: 1009, name: "Cyber Sigilism (Tribal Tattoos/Chrome)", category: "Mass Market 2026" },
  { id: 1010, name: "Hydration Vessel Stickers (Collage Style)", category: "Mass Market 2026" },
];
