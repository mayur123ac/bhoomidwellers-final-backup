// lib/creative-studio/templates.ts — Banner template definitions for Mode C.
//
// Each template defines the campaign type, required/optional fields, and a
// prompt builder that generates the AI background image description.
// Text overlay (headline, price, CTA, etc.) is composed client-side via Canvas.

export interface BannerField {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  type?: "text" | "textarea" | "color";
}

export interface BannerTemplate {
  id: string;
  name: string;
  description: string;
  category: "apartment" | "campaign" | "branding" | "custom";
  /** Default aspect ratio for this template. */
  defaultSize: "1024x1024" | "1536x1024" | "1024x1536";
  fields: BannerField[];
  /** Builds the AI prompt for the background visual. Only user-provided values. */
  buildPrompt: (values: Record<string, string>) => string;
}

// ── Shared fields ────────────────────────────────────────────────────────────

const PROJECT_NAME: BannerField = { key: "projectName", label: "Project Name", placeholder: "e.g. Bhoomi Heights", required: true };
const HEADLINE: BannerField = { key: "headline", label: "Headline", placeholder: "e.g. Your Dream Home Awaits" };
const SUBHEADLINE: BannerField = { key: "subheadline", label: "Subheadline", placeholder: "e.g. Premium Living in the Heart of the City" };
const LOCATION: BannerField = { key: "location", label: "Location", placeholder: "e.g. Baner, Pune" };
const PRICE: BannerField = { key: "price", label: "Starting Price", placeholder: "e.g. 85 Lakhs onwards" };
const CTA: BannerField = { key: "cta", label: "Call to Action", placeholder: "e.g. Book Your Site Visit" };
const CONTACT: BannerField = { key: "contact", label: "Contact Number", placeholder: "e.g. +91 98765 43210" };
const AMENITIES: BannerField = { key: "amenities", label: "Key Amenities", placeholder: "e.g. Swimming Pool, Gym, Garden", type: "textarea" };
const RERA: BannerField = { key: "rera", label: "RERA Details / Disclaimer", placeholder: "e.g. MahaRERA Reg. No: P52100XXXXX", type: "textarea" };
const BRAND_COLOR: BannerField = { key: "brandColor", label: "Brand Color", placeholder: "#9E217B", type: "color" };
const WEBSITE: BannerField = { key: "website", label: "Website", placeholder: "e.g. www.bhoomidwellers.com" };

function bhkFields(config: string): BannerField[] {
  return [
    PROJECT_NAME,
    { key: "config", label: "Configuration", placeholder: config, required: true },
    HEADLINE,
    SUBHEADLINE,
    LOCATION,
    PRICE,
    AMENITIES,
    CTA,
    CONTACT,
    WEBSITE,
    RERA,
    BRAND_COLOR,
  ];
}

function bhkPrompt(config: string, values: Record<string, string>): string {
  const location = values.location ? ` in ${values.location}` : "";
  return (
    `Professional real estate marketing photograph for a ${config} apartment${location}. ` +
    `Modern residential building exterior or elegant interior showcase. ` +
    `Premium architectural photography, golden hour lighting, lush landscaping, ` +
    `blue sky with soft clouds. Clean, aspirational, luxurious atmosphere. ` +
    `Wide composition with generous space on the right side for marketing text overlay. ` +
    `No text, no watermarks, no logos in the image. Photorealistic, editorial quality.`
  );
}

// ── Templates ────────────────────────────────────────────────────────────────

export const BANNER_TEMPLATES: BannerTemplate[] = [
  {
    id: "1bhk",
    name: "1 BHK Apartment",
    description: "Compact luxury living promotion",
    category: "apartment",
    defaultSize: "1536x1024",
    fields: bhkFields("1 BHK"),
    buildPrompt: (v) => bhkPrompt("1 BHK", v),
  },
  {
    id: "2bhk",
    name: "2 BHK Apartment",
    description: "Family home promotion",
    category: "apartment",
    defaultSize: "1536x1024",
    fields: bhkFields("2 BHK"),
    buildPrompt: (v) => bhkPrompt("2 BHK", v),
  },
  {
    id: "3bhk",
    name: "3 BHK Apartment",
    description: "Premium spacious living",
    category: "apartment",
    defaultSize: "1536x1024",
    fields: bhkFields("3 BHK"),
    buildPrompt: (v) => bhkPrompt("3 BHK", v),
  },
  {
    id: "launch",
    name: "Property Launch",
    description: "New project launch announcement",
    category: "campaign",
    defaultSize: "1536x1024",
    fields: [PROJECT_NAME, HEADLINE, SUBHEADLINE, LOCATION, PRICE, AMENITIES, CTA, CONTACT, WEBSITE, RERA, BRAND_COLOR],
    buildPrompt: (v) => {
      const loc = v.location ? ` in ${v.location}` : "";
      return (
        `Grand property launch event visual${loc}. Stunning modern residential tower ` +
        `illuminated dramatically against twilight sky. Celebration atmosphere with ` +
        `elegant lighting. Premium architectural visualization, aerial perspective. ` +
        `Space on the lower third for text overlay. No text, no watermarks. Photorealistic.`
      );
    },
  },
  {
    id: "announcement",
    name: "New Project",
    description: "New project announcement",
    category: "campaign",
    defaultSize: "1536x1024",
    fields: [PROJECT_NAME, HEADLINE, SUBHEADLINE, LOCATION, AMENITIES, CTA, CONTACT, WEBSITE, BRAND_COLOR],
    buildPrompt: (v) => {
      const loc = v.location ? ` in ${v.location}` : "";
      return (
        `New residential project announcement visual${loc}. Pristine modern building ` +
        `with contemporary architecture, surrounded by manicured gardens and open spaces. ` +
        `Morning light, fresh and inviting atmosphere. Clean architectural rendering style. ` +
        `Wide layout with space for marketing copy on the right. No text, no logos. Photorealistic.`
      );
    },
  },
  {
    id: "site_visit",
    name: "Site Visit Invitation",
    description: "Invite prospects for a site visit",
    category: "campaign",
    defaultSize: "1536x1024",
    fields: [PROJECT_NAME, HEADLINE, SUBHEADLINE, LOCATION, { key: "visitDate", label: "Visit Date/Time", placeholder: "e.g. This Weekend, 10 AM - 6 PM" }, CTA, CONTACT, WEBSITE, BRAND_COLOR],
    buildPrompt: (v) => {
      return (
        `Welcoming residential project entrance with visitors being greeted. Modern sales gallery ` +
        `and model apartment showcase area. Professional, warm, inviting atmosphere. ` +
        `Well-maintained property with visible amenities. Daytime, clear weather. ` +
        `Space at the bottom for event details. No text, no watermarks. Photorealistic.`
      );
    },
  },
  {
    id: "limited_offer",
    name: "Limited-Period Offer",
    description: "Time-sensitive promotional offer",
    category: "campaign",
    defaultSize: "1536x1024",
    fields: [PROJECT_NAME, HEADLINE, SUBHEADLINE, { key: "offerDetails", label: "Offer Details", placeholder: "e.g. Special pre-launch pricing", type: "textarea" }, LOCATION, PRICE, CTA, CONTACT, WEBSITE, RERA, BRAND_COLOR],
    buildPrompt: (v) => {
      return (
        `Luxury residential property with dynamic, premium atmosphere. Modern building ` +
        `with elegant facade, shot from a dramatic low angle. Rich golden and deep blue ` +
        `colour palette suggesting exclusivity and urgency. High contrast, cinematic lighting. ` +
        `Bold composition with clear space for promotional text. No text, no logos. Photorealistic.`
      );
    },
  },
  {
    id: "investment",
    name: "Investment Opportunity",
    description: "Property investment promotion",
    category: "campaign",
    defaultSize: "1536x1024",
    fields: [PROJECT_NAME, HEADLINE, SUBHEADLINE, LOCATION, { key: "highlights", label: "Investment Highlights", placeholder: "e.g. High rental yield area, Metro connectivity", type: "textarea" }, CTA, CONTACT, WEBSITE, RERA, BRAND_COLOR],
    buildPrompt: (v) => {
      const loc = v.location ? ` in ${v.location}` : "";
      return (
        `Premium real estate investment visual${loc}. Upscale residential skyline ` +
        `representing growth and prosperity. Modern towers against a vibrant sunrise. ` +
        `Professional, corporate aesthetic with warm tones. ` +
        `Clean composition with space for investment details. No text, no logos. Photorealistic.`
      );
    },
  },
  {
    id: "project_branding",
    name: "Project Branding",
    description: "General project identity visual",
    category: "branding",
    defaultSize: "1536x1024",
    fields: [PROJECT_NAME, HEADLINE, SUBHEADLINE, LOCATION, AMENITIES, WEBSITE, BRAND_COLOR],
    buildPrompt: (v) => {
      const loc = v.location ? ` in ${v.location}` : "";
      return (
        `Hero branding image for a premium residential project${loc}. Grand architectural ` +
        `visualization of a modern residential complex. Aerial or elevated perspective showing ` +
        `the full campus with gardens, amenities, and surrounding neighbourhood. ` +
        `Golden hour, cinematic quality, editorial photography style. ` +
        `Wide panoramic composition. No text, no logos. Photorealistic, magazine quality.`
      );
    },
  },
  {
    id: "custom",
    name: "Custom Campaign",
    description: "Build a banner with your own prompt",
    category: "custom",
    defaultSize: "1536x1024",
    fields: [
      PROJECT_NAME,
      { key: "customPrompt", label: "Visual Description", placeholder: "Describe the background image you want...", required: true, type: "textarea" },
      HEADLINE,
      SUBHEADLINE,
      LOCATION,
      PRICE,
      AMENITIES,
      CTA,
      CONTACT,
      WEBSITE,
      RERA,
      BRAND_COLOR,
    ],
    buildPrompt: (v) => {
      const base = v.customPrompt || "Professional real estate marketing visual";
      return (
        `${base}. ` +
        `Ensure the composition has clear space for text overlay. ` +
        `No text, no watermarks, no logos in the image. Photorealistic, high quality.`
      );
    },
  },
];

export const TEMPLATE_MAP = new Map(BANNER_TEMPLATES.map((t) => [t.id, t]));

// ── Aspect ratio presets for export ──────────────────────────────────────────

export const EXPORT_PRESETS = [
  { id: "ig_post", label: "Instagram Post", width: 1080, height: 1080 },
  { id: "ig_story", label: "Instagram Story / WhatsApp Status", width: 1080, height: 1920 },
  { id: "whatsapp", label: "WhatsApp Share", width: 1200, height: 628 },
  { id: "landscape", label: "Landscape Ad", width: 1536, height: 1024 },
  { id: "hero", label: "Website Hero Banner", width: 1920, height: 800 },
] as const;
